// Remembers which spreadsheet this browser uses. Only the spreadsheet ID is stored (never tokens).
// Browser storage can be missing or blocked (private window, cleared data), so every access is guarded.

const SHEET_ID_KEY = 'kraken.spreadsheetId';

/** The part of the browser's localStorage that Kraken uses. Passed in so tests can use a fake. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Google spreadsheet IDs are letters, digits, `-` and `_`. Anything else is ignored as corrupt. */
export function isValidSpreadsheetId(id: string): boolean {
  return /^[A-Za-z0-9_-]{20,}$/.test(id);
}

export function loadSpreadsheetId(store: KeyValueStore | undefined): string | null {
  try {
    const id = store?.getItem(SHEET_ID_KEY) ?? null;
    return id !== null && isValidSpreadsheetId(id) ? id : null;
  } catch {
    return null;
  }
}

/** Returns false if the browser refused to store it (Kraken then works until the page is closed). */
export function saveSpreadsheetId(store: KeyValueStore | undefined, id: string): boolean {
  if (!isValidSpreadsheetId(id)) throw new Error(`Not a valid spreadsheet ID: ${id}`);
  try {
    if (!store) return false;
    store.setItem(SHEET_ID_KEY, id);
    return true;
  } catch {
    return false;
  }
}

export function forgetSpreadsheetId(store: KeyValueStore | undefined): void {
  try {
    store?.removeItem(SHEET_ID_KEY);
  } catch {
    // Nothing to do: if storage is blocked, nothing was stored.
  }
}

/** The browser's localStorage, or undefined if the browser blocks it. */
export function browserStore(): KeyValueStore | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
