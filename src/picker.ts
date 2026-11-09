// Google's "choose a file" window. Picking a spreadsheet here is what gives Kraken (drive.file) access to it.

import { GOOGLE_PICKER_API_KEY, GOOGLE_PROJECT_NUMBER } from './config';
import { loadScript } from './loadScript';

const GAPI_SCRIPT = 'https://apis.google.com/js/api.js';

let pickerReady: Promise<void> | null = null;

function loadPicker(): Promise<void> {
  pickerReady ??= loadScript(GAPI_SCRIPT).then(
    () => new Promise<void>((resolve) => gapi.load('picker', () => resolve())),
  );
  pickerReady.catch(() => {
    pickerReady = null; // allow a retry after a network error
  });
  return pickerReady;
}

/** Shows the picker with the user's spreadsheets. Resolves with the picked spreadsheet ID, or null if cancelled. */
export async function pickSpreadsheet(accessToken: string): Promise<string | null> {
  await loadPicker();
  return new Promise<string | null>((resolve) => {
    const view = new google.picker.DocsView(google.picker.ViewId.SPREADSHEETS).setMode(google.picker.DocsViewMode.LIST);
    const picker = new google.picker.PickerBuilder()
      .addView(view)
      .setOAuthToken(accessToken)
      .setDeveloperKey(GOOGLE_PICKER_API_KEY)
      .setAppId(GOOGLE_PROJECT_NUMBER)
      .setTitle('Choose your Kraken sheet')
      .setCallback((data) => {
        if (data.action === 'picked') {
          picker.dispose();
          resolve(data.docs?.[0]?.id ?? null);
        } else if (data.action === 'cancel') {
          picker.dispose();
          resolve(null);
        }
      })
      .build();
    picker.setVisible(true);
  });
}
