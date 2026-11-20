// Creates a Kraken spreadsheet, or opens one and decides whether Kraken may use it. Opening never writes to the sheet.

import { localDate } from '../core/dates';
import { createSpreadsheet, getSpreadsheetInfo, readValues, type SheetsClient, type SpreadsheetInfo } from '../core/sheets';
import { META_TAB, checkMeta, type MetaCheck } from './meta';
import { googleSheetOps, initialTabs, migrateSpreadsheet, type MigrateResult } from './migrate';

/**
 * Creates a new Kraken spreadsheet with `_meta` and every tab the migrations add, in one request: it either fully
 * exists or not at all (no half-made sheet if something fails).
 */
export function createKrakenSpreadsheet(client: SheetsClient, now = new Date()): Promise<SpreadsheetInfo> {
  return createSpreadsheet(client, newSheetTitle(now), initialTabs(now));
}

/** "Kraken 2026-11-15": Google Drive allows two files with the same name, so the date tells them apart. */
export function newSheetTitle(now: Date): string {
  return `Kraken ${localDate(now)}`;
}

/** Updates an existing sheet to this app's data version, with a checked backup copy first. */
export function updateSpreadsheet(client: SheetsClient, id: string, onProgress: (text: string) => void, now?: Date): Promise<MigrateResult> {
  return migrateSpreadsheet(googleSheetOps(client), id, { backup: true, onProgress, ...(now ? { now } : {}) });
}

/**
 * Reads the `_meta` tab. Call only when the tab exists (see SpreadsheetInfo.tabs): every error is passed on,
 * so a temporary Google problem is never mistaken for "this is not a Kraken sheet".
 */
export function readMetaRows(client: SheetsClient, id: string): Promise<unknown[][]> {
  return readValues(client, id, META_TAB, 'A1:B100');
}

export type ConnectResult = { info: SpreadsheetInfo; meta: MetaCheck };

export async function inspectSpreadsheet(client: SheetsClient, id: string): Promise<ConnectResult> {
  const info = await getSpreadsheetInfo(client, id);
  // Only a sheet that has a _meta tab can be a Kraken sheet. Decided from the tab list, never from an error.
  if (!info.tabs.includes(META_TAB)) return { info, meta: { kind: 'not-kraken' } };
  const rows = await readMetaRows(client, id);
  return { info, meta: checkMeta(rows) };
}

/** A sentence for the user explaining a non-ok check. Returns null when the sheet can be used. */
export function describeMetaProblem(meta: MetaCheck): string | null {
  switch (meta.kind) {
    case 'ok':
      return null;
    case 'not-kraken':
      return 'To nie jest arkusz Krakena. Wybierz arkusz Krakena (jeśli ktoś Ci go udostępnił, szukaj w „Udostępnione dla mnie”).';
    case 'app-outdated':
      return `Ten arkusz został zaktualizowany przez nowszą wersję Krakena (wersja danych ${meta.schemaVersion}). Odśwież tę stronę skrótem Cmd+Shift+R, aby wczytać najnowszą wersję. Do tego czasu Kraken nie zmieni arkusza.`;
    case 'needs-migration':
      return `Ten arkusz ma starszą wersję danych (${meta.schemaVersion}) i przed użyciem wymaga aktualizacji. Kraken nie zmieni go bez wcześniejszej kopii zapasowej.`;
  }
}
