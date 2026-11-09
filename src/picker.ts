// Google's "choose a file" window. Picking a spreadsheet here is what gives Kraken (drive.file) access to it.

import { GOOGLE_PICKER_API_KEY, GOOGLE_PROJECT_NUMBER } from './config';
import { loadScript } from './loadScript';

const GAPI_SCRIPT = 'https://apis.google.com/js/api.js';
const LOAD_TIMEOUT_MS = 20_000;

let pickerReady: Promise<void> | null = null;

function loadPicker(): Promise<void> {
  pickerReady ??= loadScript(GAPI_SCRIPT).then(
    () =>
      new Promise<void>((resolve, reject) => {
        const failed = () => reject(new Error("Google's file window could not be loaded. Check the internet connection and try again."));
        gapi.load('picker', { callback: () => resolve(), onerror: failed, timeout: LOAD_TIMEOUT_MS, ontimeout: failed });
      }),
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
        if (data.action === 'loaded') return; // the window has opened; wait for the user
        picker.dispose();
        // 'picked' gives the file; anything else ('cancel', or an error inside the window) means nothing was picked.
        resolve(data.action === 'picked' ? (data.docs?.[0]?.id ?? null) : null);
      })
      .build();
    picker.setVisible(true);
  });
}
