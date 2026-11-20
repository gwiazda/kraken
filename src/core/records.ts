// A tab used as a table of records: row 1 holds the column names, every other row is one record.
// Kraken's data-safety rules (CLAUDE.md) are built in here once, so no feature can forget them:
// - columns are found by header name, never by position; columns Kraken does not know are kept as they are
// - every record gets a permanent `id`, `created_at`, `updated_at` and `created_by`
// - nothing is ever deleted: `deleted_at` is set instead (and can be cleared to restore)
// - an edit writes only the cells the user changed, and is refused if someone else changed the record (or one of
//   those cells by hand) since it was loaded: nothing is overwritten silently

import { SHEETS_API, callGoogle, readTabs, readValues, tabRange, writeCells, type SheetsClient } from './sheets';

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
  if (missing.length > 0) throw new TableError(`W zakładce „${tab}” brakuje kolumn: ${missing.join(', ')}.`);
  const duplicates = headers.filter((name, i) => name !== '' && headers.indexOf(name) !== i);
  if (duplicates.length > 0) throw new TableError(`Zakładka „${tab}” ma kolumny ${[...new Set(duplicates)].join(', ')} więcej niż raz.`);
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
      problems.push(`Wiersz ${row} zakładki „${tab}” nie ma identyfikatora (ID), więc Kraken go pomija. Czy został wpisany ręcznie?`);
    } else if (seen.has(id)) {
      problems.push(`Wiersz ${row} zakładki „${tab}” ma ten sam identyfikator co wiersz ${seen.get(id)}, więc Kraken go pomija.`);
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

function refuseUnknownColumns(tab: string, headers: readonly string[], fields: Fields): void {
  const unknown = Object.keys(fields).filter((name) => !headers.includes(name));
  if (unknown.length > 0) throw new TableError(`Zakładka „${tab}” nie ma kolumn ${unknown.join(', ')}, więc Kraken niczego nie zapisał.`);
}

const same = (a: string | undefined, b: string | undefined) => (a ?? '') === (b ?? '');

/**
 * Decides what an edit writes. Only fields the user actually changed (compared with the record as it was loaded)
 * are written, so values typed directly in the sheet meanwhile are kept. If someone changed the record through
 * Kraken (`updated_at`) or changed one of the same cells by hand, the edit is refused: nothing is overwritten silently.
 */
export function planChange(current: Fields, loaded: Fields, changes: Fields): { write: Record<string, string> } | { conflict: string } {
  const write: Record<string, string> = {};
  for (const [name, value] of Object.entries(changes)) {
    if (!same(value, loaded[name])) write[name] = value;
  }
  if (!same(current.updated_at, loaded.updated_at)) {
    return { conflict: 'Ktoś inny w międzyczasie zmienił ten wpis. Odśwież stronę, aby zobaczyć tę zmianę, i spróbuj ponownie.' };
  }
  const touchedByHand = Object.keys(write).filter((name) => !same(current[name], loaded[name]));
  if (touchedByHand.length > 0) {
    return { conflict: `Ktoś w międzyczasie zmienił w arkuszu ${touchedByHand.join(', ')}. Odśwież stronę i spróbuj ponownie.` };
  }
  return { write };
}

/** One edit for updateMany: which record, the new values, and the record as it was loaded. */
export interface RecordChange {
  id: string;
  changes: Fields;
  loaded: Fields;
  /** true: also soft-delete the record; false: also restore it; left out: deletion untouched. */
  deleted?: boolean;
}

/** A record that belongs to another one (a product's bean, a sale's line), as loaded. */
export interface ChildRecord {
  readonly id: string;
  readonly source: Fields;
}

/**
 * What to write so the stored children (`existing`, in their order) become `wanted`: the child in each position is
 * updated where anything changed, missing positions are added, and children no longer wanted are soft-deleted.
 */
export function childChanges<T extends ChildRecord>(
  existing: readonly T[],
  wanted: readonly Fields[],
): { updates: { child: T; changes: Record<string, string> }[]; adds: Fields[]; removes: T[] } {
  const updates: { child: T; changes: Record<string, string> }[] = [];
  const adds: Fields[] = [];
  wanted.forEach((fields, i) => {
    const child = existing[i];
    if (!child) {
      adds.push(fields);
      return;
    }
    const changes: Record<string, string> = {};
    for (const [column, value] of Object.entries(fields)) if ((child.source[column] ?? '').trim() !== value) changes[column] = value;
    if (Object.keys(changes).length > 0) updates.push({ child, changes });
  });
  return { updates, adds, removes: existing.slice(wanted.length) };
}

/**
 * Saves a record's children (see childChanges) in at most two requests: changes and removals together, then new
 * children, each with `parentColumn` set to `parentId`. `by` is asked only when something is added.
 */
export async function saveChildren(
  table: RecordTable,
  parentColumn: string,
  parentId: string,
  existing: readonly ChildRecord[],
  wanted: readonly Fields[],
  by: () => Promise<string>,
  now: Date,
): Promise<void> {
  const { updates, adds, removes } = childChanges(existing, wanted);
  const changes: RecordChange[] = [
    ...updates.map(({ child, changes }) => ({ id: child.id, changes, loaded: child.source })),
    ...removes.map((child) => ({ id: child.id, changes: {}, loaded: child.source, deleted: true })),
  ];
  if (changes.length > 0) await table.updateMany(changes, now);
  if (adds.length > 0) await table.addMany(adds.map((fields) => ({ ...fields, [parentColumn]: parentId })), await by(), now);
}

/** What a feature needs from a table. The real one is below; it is tested against an in-memory Google. */
export interface RecordTable {
  load(): Promise<TableContents>;
  /** Adds a record with a new ID. Returns all its fields as stored. */
  add(fields: Fields, by: string, now: Date): Promise<Fields>;
  /** Adds several records in one request (Google applies all or none). Returns them as stored, in order. */
  addMany(list: readonly Fields[], by: string, now: Date): Promise<Fields[]>;
  /**
   * Changes fields. `loaded` is the record exactly as it was loaded (its fields), used to write only what the user
   * changed and to refuse overwriting someone else's change.
   */
  update(id: string, changes: Fields, loaded: Fields, now: Date): Promise<Fields>;
  /** Several edits at once (each may also delete or restore): all checked first (any conflict writes nothing), then written in one request. */
  updateMany(list: readonly RecordChange[], now: Date): Promise<Fields[]>;
  /** Soft delete: sets `deleted_at`. */
  remove(id: string, loaded: Fields, now: Date): Promise<Fields>;
  /** Clears `deleted_at`. */
  restore(id: string, loaded: Fields, now: Date): Promise<Fields>;
}

export function sheetRecordTable(
  client: SheetsClient,
  spreadsheetId: string,
  tab: string,
  needed: readonly string[],
  newId: () => string = () => crypto.randomUUID(),
): RecordTable {
  const allNeeded = [...SAFETY_COLUMNS, ...needed];

  async function readAll() {
    // Unformatted: numbers come without their display format, so "4 500,00 zł" typed by hand reads as 4500.
    const [values = []] = await readTabs(client, spreadsheetId, [tab], 'unformatted');
    return { values, headers: readHeaders(tab, values, allNeeded) };
  }

  async function change(id: string, changes: Fields, loaded: Fields, now: Date): Promise<Fields> {
    const [stored] = await changeMany([{ id, changes, loaded }], now);
    if (!stored) throw new Error('Nothing was changed');
    return stored;
  }

  /**
   * Several edits in one go: one read, all checks first (if any record conflicts, nothing is written), one write
   * of only the changed cells, and one read to check every cell landed in the right record.
   */
  async function changeMany(list: readonly RecordChange[], now: Date): Promise<Fields[]> {
    if (list.length === 0) return [];
    // Read again just before writing, so the row numbers and the checks are current.
    const { values, headers } = await readAll();
    for (const item of list) refuseUnknownColumns(tab, headers, item.changes);
    const records = parseTable(tab, values, needed).records;
    const time = now.toISOString();
    const planned = list.map((item) => {
      const record = records.find((r) => (r.fields[ID] ?? '').trim() === item.id.trim());
      if (!record) throw new ConflictError(`Jednego z wpisów nie ma już w zakładce „${tab}”. Odśwież stronę.`);
      const plan = planChange(record.fields, item.loaded, item.changes);
      if ('conflict' in plan) throw new ConflictError(plan.conflict);
      const write: Record<string, string> = Object.keys(plan.write).length === 0 ? {} : { ...plan.write, updated_at: time };
      return { record, write };
    });
    const cells = planned.flatMap(({ record, write }) =>
      Object.entries(write).map(([name, value]) => ({ tab, cell: `${columnLetters(headers.indexOf(name) + 1)}${record.row}`, value })),
    );
    if (cells.length === 0) return planned.map(({ record }) => record.fields); // nothing changed: nothing written
    await writeCells(client, spreadsheetId, cells);

    // Check the cells landed in the right records (rows can move if someone inserts or deletes rows by hand).
    // One written row: read just that row; several: read the tab once.
    const written = planned.filter(({ write }) => Object.keys(write).length > 0);
    const idColumn = headers.indexOf(ID);
    const lastColumn = columnLetters(headers.length);
    const only = written.length === 1 ? written[0] : undefined;
    const rowsNow: Map<number, unknown[]> = new Map();
    if (only) {
      const [row = []] = await readValues(client, spreadsheetId, tab, `A${only.record.row}:${lastColumn}${only.record.row}`, 'unformatted');
      rowsNow.set(only.record.row, row);
    } else {
      const [after = []] = await readTabs(client, spreadsheetId, [tab], 'unformatted');
      for (const { record } of written) rowsNow.set(record.row, after[record.row - 1] ?? []);
    }
    for (const { record } of written) {
      const idNow = String(rowsNow.get(record.row)?.[idColumn] ?? '').trim();
      if (idNow !== (record.fields[ID] ?? '').trim()) {
        throw new Error(
          `Kraken zapisał do wiersza ${record.row} zakładki „${tab}”, ale ten wiersz zawiera teraz inny wpis (w tej samej chwili w arkuszu przesunięto wiersze). ` +
            'Otwórz arkusz i sprawdź ten wiersz w Plik → Historia wersji.',
        );
      }
    }
    return planned.map(({ record, write }) => ({ ...record.fields, ...write }));
  }

  async function addMany(list: readonly Fields[], by: string, now: Date): Promise<Fields[]> {
    if (list.length === 0) return [];
    for (const fields of list) refuseSafetyColumns(fields);
    const headers = readHeaders(tab, await readValues(client, spreadsheetId, tab, '1:1'), allNeeded);
    for (const fields of list) refuseUnknownColumns(tab, headers, fields);
    const time = now.toISOString();
    const stored: Fields[] = list.map((fields) => ({ ...fields, id: newId(), created_at: time, updated_at: time, created_by: by, deleted_at: '' }));
    const range = encodeURIComponent(tabRange(tab, 'A1'));
    await callGoogle(client, `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
      method: 'POST',
      body: JSON.stringify({ values: stored.map((fields) => rowCells(headers, fields)) }),
    });
    return stored;
  }

  return {
    async load() {
      const { values } = await readAll();
      return parseTable(tab, values, needed);
    },
    async add(fields, by, now) {
      const [stored] = await addMany([fields], by, now);
      if (!stored) throw new Error('Nothing was added');
      return stored;
    },
    addMany,
    async update(id, changes, loaded, now) {
      refuseSafetyColumns(changes);
      return change(id, changes, loaded, now);
    },
    async updateMany(list, now) {
      for (const item of list) refuseSafetyColumns(item.changes);
      const deletedAt = now.toISOString();
      return changeMany(
        list.map(({ deleted, ...item }) =>
          deleted === undefined ? item : { ...item, changes: { ...item.changes, deleted_at: deleted ? deletedAt : '' } },
        ),
        now,
      );
    },
    remove(id, loaded, now) {
      return change(id, { deleted_at: now.toISOString() }, loaded, now);
    },
    restore(id, loaded, now) {
      return change(id, { deleted_at: '' }, loaded, now);
    },
  };
}
