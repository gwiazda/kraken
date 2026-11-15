// Google Drive calls: backup copies of the spreadsheet (the `drive.file` permission covers files Kraken created or
// that were picked for it, and the copies it makes), and who is signed in.

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

/** The signed-in person's email address (for "created by"). Works with the drive.file permission. */
export async function whoAmI(client: SheetsClient): Promise<string> {
  const result = await callGoogle<{ user?: { emailAddress?: unknown } }>(client, 'https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)');
  const email = result.user?.emailAddress;
  if (typeof email !== 'string' || email === '') throw new Error('Google did not say who is signed in');
  return email;
}
