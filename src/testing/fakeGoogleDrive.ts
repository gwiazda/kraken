// An in-memory fake of the Google Sheets and Drive APIs, for tests of whole flows (create, migrate, backup).
// It understands exactly the requests Kraken makes and keeps real state, so tests check what ends up in the "sheet".

import type { SheetsClient } from '../core/sheets';

export interface FakeTab {
  title: string;
  sheetId: number;
  rows: string[][];
}

export interface FakeFile {
  name: string;
  tabs: FakeTab[];
}

export interface FakeRequest {
  method: string;
  url: string;
  body: unknown;
}

/** Return a status to make that request fail (nothing is changed), or undefined to let it through. */
export type FailRule = (request: FakeRequest) => number | undefined;

export interface FakeDrive extends SheetsClient {
  files: Map<string, FakeFile>;
  requests: FakeRequest[];
  failWhen: FailRule[];
  /** Runs after a successful Drive copy, e.g. to damage the copy in a test. */
  afterCopy?: (copy: FakeFile) => void;
  /** Adds a file directly, as if it already existed in Drive. */
  addFile(id: string, file: FakeFile): void;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const fail = (status: number, message: string) => json(status, { error: { message } });

function parseRange(range: string): { tab: string; cells: string } {
  const match = /^'((?:[^']|'')*)'!(.+)$/.exec(range);
  if (!match) throw new Error(`Fake Google: cannot read range ${range}`);
  return { tab: (match[1] ?? '').replace(/''/g, "'"), cells: match[2] ?? '' };
}

/** Rows as the real API returns them: trailing empty cells and rows are left out. */
function trimmed(rows: string[][]): string[][] {
  const out = rows.map((row) => {
    const copy = [...row];
    while (copy.length > 0 && copy[copy.length - 1] === '') copy.pop();
    return copy;
  });
  while (out.length > 0 && out[out.length - 1]?.length === 0) out.pop();
  return out;
}

const columnNumber = (letters: string) => [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);

const cellText = (cell: unknown) => String((cell as { userEnteredValue?: { stringValue?: unknown } }).userEnteredValue?.stringValue ?? '');

export function fakeGoogleDrive(): FakeDrive {
  const files = new Map<string, FakeFile>();
  const requests: FakeRequest[] = [];
  let nextId = 1;
  const newId = () => `fake-sheet-${String(nextId++).padStart(20, '0')}`;

  const drive: FakeDrive = {
    files,
    requests,
    failWhen: [],
    getToken: () => 'test-token',
    addFile: (id, file) => void files.set(id, file),
    fetch: async (url, init = {}) => {
      const method = init.method ?? 'GET';
      const body = typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
      const request = { method, url, body };
      requests.push(request);
      for (const rule of drive.failWhen) {
        const status = rule(request);
        if (status !== undefined) return fail(status, 'Injected failure');
      }
      return handle(method, new URL(url), body);
    },
  };

  function info(id: string, file: FakeFile) {
    return {
      spreadsheetId: id,
      spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${id}/edit`,
      properties: { title: file.name },
      sheets: file.tabs.map((tab) => ({ properties: { title: tab.title, sheetId: tab.sheetId } })),
    };
  }

  function handle(method: string, url: URL, body: unknown): Response {
    const path = decodeURIComponent(url.pathname);

    const copy = /^\/drive\/v3\/files\/([^/]+)\/copy$/.exec(path);
    if (url.hostname === 'www.googleapis.com' && copy && method === 'POST') {
      const source = files.get(copy[1] ?? '');
      if (!source) return fail(404, 'File not found');
      const id = newId();
      const file: FakeFile = { name: String((body as { name?: unknown }).name), tabs: structuredClone(source.tabs) };
      files.set(id, file);
      drive.afterCopy?.(file);
      return json(200, { id });
    }
    if (url.hostname !== 'sheets.googleapis.com') return fail(400, `Fake Google: unknown host ${url.hostname}`);

    if (path === '/v4/spreadsheets' && method === 'POST') {
      const spec = body as { properties: { title: string }; sheets: { properties: { title: string }; data: { rowData: { values: unknown[] }[] }[] }[] };
      const id = newId();
      const file: FakeFile = {
        name: spec.properties.title,
        tabs: spec.sheets.map((sheet, index) => ({
          title: sheet.properties.title,
          sheetId: index,
          rows: (sheet.data[0]?.rowData ?? []).map((row) => row.values.map(cellText)),
        })),
      };
      files.set(id, file);
      return json(200, info(id, file));
    }

    const match = /^\/v4\/spreadsheets\/([^/:]+)(.*)$/.exec(path);
    const id = match?.[1] ?? '';
    const rest = match?.[2] ?? '';
    const file = files.get(id);
    if (!file) return fail(404, 'Requested entity was not found.');
    const tab = (title: string) => file.tabs.find((t) => t.title === title);

    if (rest === '' && method === 'GET') return json(200, info(id, file));

    if (rest === '/values:batchGet' && method === 'GET') {
      const ranges = url.searchParams.getAll('ranges');
      if (ranges.some((range) => !tab(parseRange(range).tab))) return fail(400, 'Unable to parse range');
      const valueRanges = ranges.map((range) => {
        const values = trimmed(tab(parseRange(range).tab)?.rows ?? []);
        return values.length > 0 ? { range, values } : { range };
      });
      return json(200, { valueRanges });
    }

    /** Writes one row of values starting at a cell ("B3"), or into a row range ("A5:U5"). Returns an error text or null. */
    const writeAt = (title: string, cells: string, written: unknown[][]): string | null => {
      const found = tab(title);
      if (!found) return `Unable to parse range: ${title}`;
      const range = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(cells);
      if (!range) return 'Fake Google: only writes to a cell or a row';
      const startColumn = columnNumber(range[1] ?? 'A') - 1;
      const row = Number(range[2]) - 1;
      const width = range[3] ? columnNumber(range[3]) - startColumn : 1;
      if (written.length !== 1 || (written[0]?.length ?? 0) > width || (range[4] && Number(range[4]) - 1 !== row)) {
        return 'Requested writing outside the given range';
      }
      while (found.rows.length <= row) found.rows.push([]);
      const target = found.rows[row] ?? [];
      (written[0] ?? []).forEach((cell, i) => {
        while (target.length <= startColumn + i) target.push('');
        target[startColumn + i] = String(cell ?? '');
      });
      return null;
    };

    if (rest === '/values:batchUpdate' && method === 'POST') {
      const request = body as { valueInputOption?: string; data: { range: string; values: unknown[][] }[] };
      if (request.valueInputOption !== 'RAW') return fail(400, 'Fake Google: only RAW writes');
      // All or nothing, like the real API.
      const before = structuredClone(file.tabs);
      for (const item of request.data) {
        const { tab: title, cells } = parseRange(item.range);
        const error = writeAt(title, cells, item.values);
        if (error) {
          file.tabs = before;
          return fail(400, error);
        }
      }
      return json(200, {});
    }

    const append = /^\/values\/(.+):append$/.exec(rest);
    if (append && method === 'POST') {
      const found = tab(parseRange(append[1] ?? '').tab);
      if (!found) return fail(400, `Unable to parse range: ${append[1]}`);
      if (url.searchParams.get('valueInputOption') !== 'RAW' || url.searchParams.get('insertDataOption') !== 'INSERT_ROWS') {
        return fail(400, 'Fake Google: only RAW writes with INSERT_ROWS');
      }
      // Like the real API with range A1: the "table" is the block of filled rows from row 1; new rows are inserted
      // right after it, pushing any rows below (after an empty row) further down.
      const isEmpty = (row: string[] | undefined) => !row || row.every((cell) => cell === '');
      let end = 0;
      while (end < found.rows.length && !isEmpty(found.rows[end])) end++;
      const added = (body as { values: unknown[][] }).values.map((row) => row.map((cell) => String(cell ?? '')));
      found.rows.splice(end, 0, ...added);
      return json(200, { updates: {} });
    }

    const values = /^\/values\/(.+)$/.exec(rest);
    if (values) {
      const { tab: title, cells } = parseRange(values[1] ?? '');
      const found = tab(title);
      if (!found) return fail(400, `Unable to parse range: ${values[1]}`);
      if (method === 'GET') {
        // Whole tab, or the rows of a row range like "1:1" or "A5:U5".
        const rowRange = /^[A-Z]*(\d+):[A-Z]*(\d+)$/.exec(cells);
        const rows = rowRange ? found.rows.slice(Number(rowRange[1]) - 1, Number(rowRange[2])) : found.rows;
        const result = trimmed(rows.map((row) => [...row]));
        return json(200, result.length > 0 ? { values: result } : {});
      }
      if (method === 'PUT') {
        if (url.searchParams.get('valueInputOption') !== 'RAW') return fail(400, 'Fake Google: only RAW writes');
        const error = writeAt(title, cells, (body as { values: unknown[][] }).values);
        return error ? fail(400, error) : json(200, {});
      }
    }

    if (rest === ':batchUpdate' && method === 'POST') {
      // All requests or none, like the real API.
      const staged = structuredClone(file.tabs);
      for (const req of (body as { requests: Record<string, unknown>[] }).requests) {
        const add = req.addSheet as { properties: { sheetId: number; title: string } } | undefined;
        const update = req.updateCells as { start: { sheetId: number }; rows: { values: unknown[] }[] } | undefined;
        if (add) {
          if (staged.some((t) => t.title === add.properties.title || t.sheetId === add.properties.sheetId)) {
            return fail(400, `A sheet with the name "${add.properties.title}" already exists.`);
          }
          staged.push({ title: add.properties.title, sheetId: add.properties.sheetId, rows: [] });
        } else if (update) {
          const target = staged.find((t) => t.sheetId === update.start.sheetId);
          if (!target) return fail(400, 'No grid with id');
          target.rows = update.rows.map((row) => row.values.map(cellText));
        } else {
          return fail(400, 'Fake Google: unknown batchUpdate request');
        }
      }
      file.tabs = staged;
      return json(200, {});
    }

    return fail(400, `Fake Google: unknown request ${method} ${path}`);
  }

  return drive;
}
