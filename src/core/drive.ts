// Google Drive calls. Used only for backup copies of the spreadsheet (the `drive.file` permission covers files
// Kraken created or that were picked for it, and the copies it makes).

import { callGoogle, type SheetsClient } from './sheets';

const DRIVE_API = 'https://www.googleapis.com/drive/v3/files';

/** Makes a full copy of a file (all tabs and rows) in the same Drive folder. Returns the new file's ID. */
export async function copyFile(client: SheetsClient, id: string, name: string): Promise<string> {
  const result = await callGoogle<{ id?: unknown }>(client, `${DRIVE_API}/${encodeURIComponent(id)}/copy?fields=id`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
  if (typeof result.id !== 'string' || result.id === '') throw new Error('Google did not return the ID of the backup copy');
  return result.id;
}
