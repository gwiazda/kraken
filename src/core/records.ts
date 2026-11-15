// A tab used as a table of records: row 1 holds the column names, every other row is one record.
// Kraken's data-safety rules (CLAUDE.md) are built in here once, so no feature can forget them:
// - columns are found by header name, never by position; columns Kraken does not know are kept as they are
// - every record gets a permanent `id`, `created_at`, `updated_at` and `created_by`
// - nothing is ever deleted: `deleted_at` is set instead (and can be cleared to restore)
// - an edit is refused if someone else changed the record since it was loaded (no silent overwrite)

import { callGoogle, readTabs, tabRange, type SheetsClient } from './sheets';

export const ID = 'id';
/** Columns every record table has. Features may not write these directly. */
export const SAFETY_COLUMNS = ['id', 'created_at', 'updated_at', 'created_by', 'deleted_at'] as const;

/** One record: column name → text. */
export type Fields = Readonly<Record<string, string>>;

export interface StoredRecord {
  /** Row number in the sheet (1 = headers), for messages like "row 7". */
  row: number;
  fields: Fields;
}

export interface TableContents {
  records: StoredRecord[];
  /** Rows Kraken could not use, explained in a sentence each. They are shown, never dropped silently. */
  problems: string[];
}

/** The tab does not have the columns Kraken needs. Kraken then reads nothing and writes nothing. */
export class TableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TableError';
  }
}

/** The record was changed by someone else since it was loaded. Reload and try again; nothing was written. */
export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

const cellText = (cell: unknown) => (cell === null || cell === undefined ? '' : String(cell));

/** Column number (1 = A) as letters: 1 → A, 26 → Z, 27 → AA. */
export function columnLetters(column: number): string {
  let letters = '';
  for (let n = column; n > 0; n = Math.floor((n - 1) / 26)) letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  return letters;
}

/** Reads the header row and checks the needed columns are there exactly once. */
export function readHeaders(tab: string, values: readonly (readonly unknown[])[], needed: readonly string[]): string[] {
  const headers = (values[0] ?? []).map((cell) => cellText(cell).trim());
  const missing = needed.filter((name) => !headers.includes(name));
  if (missing.length > 0) throw new TableError(`Tab "${tab}" is missing the column(s): ${missing.join(', ')}.`);
  const duplicates = headers.filter((name, i) => name !== '' && headers.indexOf(name) !== i);
  if (duplicates.length > 0) throw new TableError(`Tab "${tab}" has the column(s) ${[...new Set(duplicates)].join(', ')} more than once.`);
  return headers;
}

/** Turns the rows of a tab into records by header name. Empty rows are skipped; rows without a usable ID are reported. */
export function parseTable(tab: string, values: readonly (readonly unknown[])[], needed: readonly string[]): TableContents {
  const headers = readHeaders(tab, values, [...SAFETY_COLUMNS, ...needed]);
  const records: StoredRecord[] = [];
  const problems: string[] = [];
  const seen = new Map<string, number>();
  values.slice(1).forEach((cells, index) => {
    const row = index + 2;
    if (cells.every((cell) => cellText(cell).trim() === '')) return;
    const fields: Record<string, string> = {};
    headers.forEach((name, i) => {
      if (name !== '') fields[name] = cellText(cells[i]);
    });
    const id = (fields[ID] ?? '').trim();
    if (id === '') {
      problems.push(`Row ${row} of "${tab}" has no ID, so Kraken ignores it. Was it typed in by hand?`);
    } else if (seen.has(id)) {
      problems.push(`Row ${row} of "${tab}" has the same ID as row ${seen.get(id)}, so Kraken ignores it.`);
    } else {
      seen.set(id, row);
      records.push({ row, fields });
    }
  });
  return { records, problems };
}

/** The cells of a row in header order: given fields win, other columns keep what the row had. */
export function rowCells(headers: readonly string[], fields: Fields, existing: readonly unknown[] = []): string[] {
  return headers.map((name, i) => (name !== '' && name in fields ? (fields[name] ?? '') : cellText(existing[i])));
}

function refuseSafetyColumns(fields: Fields): void {
  const touched = SAFETY_COLUMNS.filter((name) => name in fields);
  if (touched.length > 0) throw new Error(`Features may not write ${touched.join(', ')} directly`);
}

/** What a feature needs from a table. The real one is below; it is tested against an in-memory Google. */
export interface RecordTable {
  load(): Promise<TableContents>;
  /** Adds a record with a new ID. Returns all its fields as stored. */
  add(fields: Fields, by: string, now: Date): Promise<Fields>;
  /** Changes some fields. `loadedUpdatedAt` is the record's `updated_at` when it was loaded (optimistic lock). */
  update(id: string, fields: Fields, loadedUpdatedAt: string, now: Date): Promise<Fields>;
  /** Soft delete: sets `deleted_at`. */
  remove(id: string, loadedUpdatedAt: string, now: Date): Promise<Fields>;
  /** Clears `deleted_at`. */
  restore(id: string, loadedUpdatedAt: string, now: Date): Promise<Fields>;
}

export function sheetRecordTable(
  client: SheetsClient,
  spreadsheetId: string,
  tab: string,
  needed: readonly string[],
  newId: () => string = () => crypto.randomUUID(),
): RecordTable {
  const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
  const base = `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}`;

  async function readAll() {
    const [values = []] = await readTabs(client, spreadsheetId, [tab]);
    return { values, headers: readHeaders(tab, values, [...SAFETY_COLUMNS, ...needed]) };
  }

  async function change(id: string, fields: Fields, loadedUpdatedAt: string, now: Date): Promise<Fields> {
    // Read again just before writing, so the row number and the lock check are current.
    const { values, headers } = await readAll();
    const { records } = parseTable(tab, values, needed);
    const record = records.find((r) => r.fields[ID] === id);
    if (!record) throw new ConflictError(`This record is no longer in "${tab}". Reload the page.`);
    if ((record.fields.updated_at ?? '') !== loadedUpdatedAt) {
      throw new ConflictError('Someone else changed this record in the meantime. Reload the page to see their change, then try again.');
    }
    const stored = { ...record.fields, ...fields, updated_at: now.toISOString() };
    const cells = rowCells(headers, stored, values[record.row - 1]);
    const range = encodeURIComponent(tabRange(tab, `A${record.row}:${columnLetters(headers.length)}${record.row}`));
    await callGoogle(client, `${base}/values/${range}?valueInputOption=RAW`, { method: 'PUT', body: JSON.stringify({ values: [cells] }) });
    return stored;
  }

  return {
    async load() {
      const { values } = await readAll();
      return parseTable(tab, values, needed);
    },
    async add(fields, by, now) {
      refuseSafetyColumns(fields);
      const { headers } = await readAll();
      const time = now.toISOString();
      const stored: Fields = { ...fields, id: newId(), created_at: time, updated_at: time, created_by: by, deleted_at: '' };
      const range = encodeURIComponent(tabRange(tab, 'A1'));
      await callGoogle(client, `${base}/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
        method: 'POST',
        body: JSON.stringify({ values: [rowCells(headers, stored)] }),
      });
      return stored;
    },
    async update(id, fields, loadedUpdatedAt, now) {
      refuseSafetyColumns(fields);
      return change(id, fields, loadedUpdatedAt, now);
    },
    remove(id, loadedUpdatedAt, now) {
      return change(id, { deleted_at: now.toISOString() }, loadedUpdatedAt, now);
    },
    restore(id, loadedUpdatedAt, now) {
      return change(id, { deleted_at: '' }, loadedUpdatedAt, now);
    },
  };
}
