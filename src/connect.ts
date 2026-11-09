// Opens a spreadsheet and decides whether Kraken may use it. Never writes to the sheet.

import { checkMeta, type MetaCheck } from './meta';
import { getSpreadsheetInfo, readMetaRows, type SheetsClient, type SpreadsheetInfo } from './sheets';

export type ConnectResult = { info: SpreadsheetInfo; meta: MetaCheck };

export async function inspectSpreadsheet(client: SheetsClient, id: string): Promise<ConnectResult> {
  const info = await getSpreadsheetInfo(client, id);
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
