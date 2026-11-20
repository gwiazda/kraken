// Talks to the Google Sheets API directly from the browser with the signed-in user's access token.
// No server is involved. `fetch` and the token are passed in so tests can replace them with fakes.
// Generic building block: knows nothing about Kraken's tabs (those live in `schema/`).

export const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export interface SheetsClient {
  /** Returns a valid access token, or throws if the user is not signed in. */
  getToken: () => string;
  fetch: FetchFn;
}

/** Why a Sheets call failed, in terms the UI can act on. */
export type SheetsErrorKind =
  | 'signed-out' // the access token expired or was revoked: sign in again
  | 'no-access' // the file does not exist, or this user has not shared/picked it for Kraken
  | 'rate-limited' // too many requests: try again in a minute
  | 'other';

export class SheetsError extends Error {
  readonly kind: SheetsErrorKind;
  readonly status: number;
  constructor(kind: SheetsErrorKind, status: number, message: string) {
    super(message);
    this.name = 'SheetsError';
    this.kind = kind;
    this.status = status;
  }
}

export function errorKindForStatus(status: number): SheetsErrorKind {
  if (status === 401) return 'signed-out';
  if (status === 403 || status === 404) return 'no-access';
  if (status === 429) return 'rate-limited';
  return 'other';
}

/** One authorised call to a Google API (Sheets or Drive). Errors become a SheetsError the UI can act on. */
export async function callGoogle<T>(client: SheetsClient, url: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${client.getToken()}`);
  if (init.body !== undefined) headers.set('Content-Type', 'application/json');

  const response = await client.fetch(url, { ...init, headers });
  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = (await response.json()) as { error?: { message?: string } };
      detail = body.error?.message ?? detail;
    } catch {
      // Body was not JSON; keep the status text.
    }
    throw new SheetsError(errorKindForStatus(response.status), response.status, `Błąd Google ${response.status}: ${detail}`);
  }
  return (await response.json()) as T;
}

export interface SpreadsheetInfo {
  id: string;
  title: string;
  url: string;
  /** Names of the tabs, in order. */
  tabs: string[];
}

const INFO_FIELDS = 'spreadsheetId,spreadsheetUrl,properties.title,sheets.properties.title';

interface SpreadsheetResource {
  spreadsheetId: string;
  spreadsheetUrl: string;
  properties: { title: string };
  sheets?: { properties?: { title?: string } }[];
}

function toInfo(resource: SpreadsheetResource): SpreadsheetInfo {
  const tabs = (resource.sheets ?? []).map((sheet) => sheet.properties?.title).filter((t): t is string => typeof t === 'string');
  return { id: resource.spreadsheetId, title: resource.properties.title, url: resource.spreadsheetUrl, tabs };
}

/** True only for https addresses on docs.google.com, so a link to the sheet can never point anywhere else. */
export function isGoogleSheetsUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname === 'docs.google.com';
  } catch {
    return false;
  }
}

/** A tab with its starting content, written as plain text. */
export interface InitialTab {
  title: string;
  rows: string[][];
  /** Rows kept visible when scrolling (1 for a header row). */
  frozenRows?: number;
}

/** The request body that creates a new spreadsheet with filled tabs, in one step. */
export function newSpreadsheetBody(title: string, tabs: readonly InitialTab[]): object {
  return {
    properties: { title },
    sheets: tabs.map((tab) => ({
      properties: {
        title: tab.title,
        ...(tab.frozenRows ? { gridProperties: { frozenRowCount: tab.frozenRows, columnCount: Math.max(26, ...tab.rows.map((r) => r.length)) } } : {}),
      },
      data: [
        {
          startRow: 0,
          startColumn: 0,
          rowData: tab.rows.map((row) => ({
            values: row.map((text) => ({ userEnteredValue: { stringValue: text } })),
          })),
        },
      ],
    })),
  };
}

/** Creates a new spreadsheet in the user's Drive. One request, so it either fully exists with all its tabs or not at all. */
export async function createSpreadsheet(client: SheetsClient, title: string, tabs: readonly InitialTab[]): Promise<SpreadsheetInfo> {
  const resource = await callGoogle<SpreadsheetResource>(client, `${SHEETS_API}?fields=${INFO_FIELDS}`, {
    method: 'POST',
    body: JSON.stringify(newSpreadsheetBody(title, tabs)),
  });
  return toInfo(resource);
}

export async function getSpreadsheetInfo(client: SheetsClient, id: string): Promise<SpreadsheetInfo> {
  const resource = await callGoogle<SpreadsheetResource>(
    client,
    `${SHEETS_API}/${encodeURIComponent(id)}?fields=${INFO_FIELDS}`,
  );
  return toInfo(resource);
}

/** An A1 range on a named tab, e.g. `'_meta'!A1:B100`. Quotes in the tab name are doubled, as Sheets requires. */
export function tabRange(tab: string, cells: string): string {
  return `'${tab.replace(/'/g, "''")}'!${cells}`;
}

/** Reads the cells of a tab. Every error is passed on, so the caller never mistakes a Google problem for data. */
export async function readValues(client: SheetsClient, id: string, tab: string, cells: string, render: ValueRender = 'formatted'): Promise<unknown[][]> {
  const range = encodeURIComponent(tabRange(tab, cells));
  const result = await callGoogle<{ values?: unknown[][] }>(client, `${SHEETS_API}/${encodeURIComponent(id)}/values/${range}${render === 'unformatted' ? `?${renderQuery(render).slice(1)}` : ''}`);
  return result.values ?? [];
}

/**
 * How cells are read. 'formatted': as shown in Google Sheets. 'unformatted': numbers without their display format
 * (a number shown as "4 500,00 zł" reads as 4500), dates still as shown. Record tables use 'unformatted'.
 */
export type ValueRender = 'formatted' | 'unformatted';
const renderQuery = (render: ValueRender) => (render === 'unformatted' ? '&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING' : '');

/** Reads several whole tabs in one request. Returns the rows of each tab, in the order asked. */
export async function readTabs(client: SheetsClient, id: string, tabs: readonly string[], render: ValueRender = 'formatted'): Promise<unknown[][][]> {
  if (tabs.length === 0) return [];
  const query = tabs.map((tab) => `ranges=${encodeURIComponent(tabRange(tab, 'A:ZZ'))}`).join('&') + renderQuery(render);
  const result = await callGoogle<{ valueRanges?: { values?: unknown[][] }[] }>(
    client,
    `${SHEETS_API}/${encodeURIComponent(id)}/values:batchGet?${query}`,
  );
  const ranges = result.valueRanges ?? [];
  if (ranges.length !== tabs.length) throw new Error(`Google returned ${ranges.length} tabs instead of ${tabs.length}`);
  return ranges.map((range) => range.values ?? []);
}

/**
 * Adds a tab with a frozen header row, in one request: Google applies all of it or none of it,
 * so a tab never exists without its headers.
 */
export async function addTab(client: SheetsClient, id: string, title: string, headers: readonly string[]): Promise<void> {
  const existing = await callGoogle<{ sheets?: { properties?: { sheetId?: number } }[] }>(
    client,
    `${SHEETS_API}/${encodeURIComponent(id)}?fields=sheets.properties.sheetId`,
  );
  const sheetId = Math.max(0, ...(existing.sheets ?? []).map((sheet) => sheet.properties?.sheetId ?? 0)) + 1;
  await callGoogle(client, `${SHEETS_API}/${encodeURIComponent(id)}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({
      requests: [
        {
          addSheet: {
            properties: { sheetId, title, gridProperties: { frozenRowCount: 1, columnCount: Math.max(26, headers.length) } },
          },
        },
        {
          updateCells: {
            start: { sheetId, rowIndex: 0, columnIndex: 0 },
            rows: [{ values: headers.map((text) => ({ userEnteredValue: { stringValue: text } })) }],
            fields: 'userEnteredValue',
          },
        },
      ],
    }),
  });
}

/** Writes values into cells exactly as given (RAW: Google does not turn text into numbers or dates). */
export async function writeValues(client: SheetsClient, id: string, tab: string, cells: string, values: string[][]): Promise<void> {
  const range = encodeURIComponent(tabRange(tab, cells));
  await callGoogle(client, `${SHEETS_API}/${encodeURIComponent(id)}/values/${range}?valueInputOption=RAW`, {
    method: 'PUT',
    body: JSON.stringify({ values }),
  });
}

/**
 * Writes single cells as given (RAW), in one request: Google applies all or none. Each range is one cell on a tab,
 * e.g. { tab: 'Lots', cell: 'L5', value: '4500' }. Cells not listed are not touched (formulas elsewhere stay).
 */
export async function writeCells(client: SheetsClient, id: string, cells: readonly { tab: string; cell: string; value: string }[]): Promise<void> {
  if (cells.length === 0) return;
  await callGoogle(client, `${SHEETS_API}/${encodeURIComponent(id)}/values:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({
      valueInputOption: 'RAW',
      data: cells.map(({ tab, cell, value }) => ({ range: tabRange(tab, cell), values: [[value]] })),
    }),
  });
}
