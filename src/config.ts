// Google settings for Kraken. These values are public by design (they identify the app, they grant nothing on
// their own) and are safe to commit. Secrets (client secret, tokens) must never be added here.
// Set up in the Google Cloud project "kraken" on 2026-11-09.

/** OAuth 2.0 Client ID (web application). Allowed origins: http://localhost:5173 and https://gwiazda.github.io */
export const GOOGLE_CLIENT_ID = '931901713438-o8b6fh5iu8a7aiaqs40oqg6o27nlobc0.apps.googleusercontent.com';

/** API key for the Google Picker only. Restricted to the Picker API and to Kraken's two web addresses. */
export const GOOGLE_PICKER_API_KEY = 'AIzaSyBdYoj-fzrBsEOEsOdWK_4Oy9625IRNa44';

/** Google Cloud project number (the first part of the Client ID). The Picker needs it to grant drive.file access. */
export const GOOGLE_PROJECT_NUMBER = '931901713438';

/** drive.file: Kraken can only use files it created or that the user picked in Kraken. */
export const GOOGLE_SCOPES = 'https://www.googleapis.com/auth/drive.file';

/** Title of a newly created Kraken spreadsheet. */
export const NEW_SHEET_TITLE = 'Kraken';
