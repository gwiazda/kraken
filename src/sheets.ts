// Talks to the Google Sheets API directly from the browser with the signed-in user's access token.
// No server is involved. `fetch` and the token are passed in so tests can replace them with fakes.

import { META_TAB, initialMetaRows } from './meta';

const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';

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

async function call<T>(client: SheetsClient, url: string, init: RequestInit = {}): Promise<T> {
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
    throw new SheetsError(errorKindForStatus(response.status), response.status, `Google Sheets error ${response.status}: ${detail}`);
  }
  return (await response.json()) as T;
}

export interface SpreadsheetInfo {
  id: string;
  title: string;
  url: string;
}

interface SpreadsheetResource {
  spreadsheetId: string;
  spreadsheetUrl: string;
  properties: { title: string };
}

function toInfo(resource: SpreadsheetResource): SpreadsheetInfo {
  return { id: resource.spreadsheetId, title: resource.properties.title, url: resource.spreadsheetUrl };
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

/** The request body that creates a new Kraken spreadsheet with a filled `_meta` tab, in one step. */
export function newSpreadsheetBody(title: string, createdAt: Date): object {
  return {
    properties: { title },
    sheets: [
      {
        properties: { title: META_TAB },
        data: [
          {
            startRow: 0,
            startColumn: 0,
            rowData: initialMetaRows(createdAt).map((row) => ({
              values: row.map((text) => ({ userEnteredValue: { stringValue: text } })),
            })),
          },
        ],
      },
    ],
  };
}

/** Creates a new spreadsheet in the user's Drive. One request, so it either fully exists with `_meta` or not at all. */
export async function createSpreadsheet(client: SheetsClient, title: string, now = new Date()): Promise<SpreadsheetInfo> {
  const resource = await call<SpreadsheetResource>(client, `${SHEETS_API}?fields=spreadsheetId,spreadsheetUrl,properties.title`, {
    method: 'POST',
    body: JSON.stringify(newSpreadsheetBody(title, now)),
  });
  return toInfo(resource);
}

export async function getSpreadsheetInfo(client: SheetsClient, id: string): Promise<SpreadsheetInfo> {
  const resource = await call<SpreadsheetResource>(
    client,
    `${SHEETS_API}/${encodeURIComponent(id)}?fields=spreadsheetId,spreadsheetUrl,properties.title`,
  );
  return toInfo(resource);
}

/** Reads the `_meta` tab. Returns undefined if the spreadsheet has no `_meta` tab. */
export async function readMetaRows(client: SheetsClient, id: string): Promise<unknown[][] | undefined> {
  const range = encodeURIComponent(`'${META_TAB}'!A1:B100`);
  try {
    const result = await call<{ values?: unknown[][] }>(client, `${SHEETS_API}/${encodeURIComponent(id)}/values/${range}`);
    return result.values ?? [];
  } catch (error) {
    // Google answers 400 "Unable to parse range" when the tab does not exist.
    if (error instanceof SheetsError && error.status === 400) return undefined;
    throw error;
  }
}
