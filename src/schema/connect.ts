// Creates a Kraken spreadsheet, or opens one and decides whether Kraken may use it. Opening never writes to the sheet.

import { createSpreadsheet, getSpreadsheetInfo, readValues, type SheetsClient, type SpreadsheetInfo } from '../core/sheets';
import { META_TAB, checkMeta, initialMetaRows, type MetaCheck } from './meta';

/** Creates a new spreadsheet with a filled `_meta` tab in one request, so it either fully exists or not at all. */
export function createKrakenSpreadsheet(client: SheetsClient, title: string, now = new Date()): Promise<SpreadsheetInfo> {
  return createSpreadsheet(client, title, { title: META_TAB, rows: initialMetaRows(now) });
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
      return 'This is not a Kraken sheet. Choose the sheet that Kraken created, or create a new one.';
    case 'app-outdated':
      return `This sheet was updated by a newer version of Kraken (data version ${meta.schemaVersion}). Reload this page with Cmd+Shift+R to get the latest version. Kraken will not change the sheet until then.`;
    case 'needs-migration':
      return `This sheet has an older data version (${meta.schemaVersion}) and needs an update before use. Kraken will not change it without making a backup copy first.`;
  }
}
