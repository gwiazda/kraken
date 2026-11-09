// Sign-in with Google Identity Services, popup style (no redirect, no server).
// The access token lives only in memory and is lost when the page is closed, which is intended.

import { GOOGLE_CLIENT_ID, GOOGLE_SCOPES } from './config';
import { loadScript } from './loadScript';
import { SheetsError } from './sheets';
import { TokenHolder } from './token';

const GIS_SCRIPT = 'https://accounts.google.com/gsi/client';

const tokens = new TokenHolder();
let tokenClient: google.accounts.oauth2.TokenClient | null = null;
let pending: { resolve: () => void; reject: (error: Error) => void } | null = null;

/** Loads the Google sign-in script. Call once at start-up so the sign-in click opens the popup without delay. */
export async function initAuth(): Promise<void> {
  await loadScript(GIS_SCRIPT);
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: GOOGLE_SCOPES,
    callback: (response) => {
      const done = pending;
      pending = null;
      if (!done) return;
      if (response.error || !response.access_token) {
        done.reject(new Error(response.error_description ?? response.error ?? 'Sign-in failed'));
        return;
      }
      if (!google.accounts.oauth2.hasGrantedAllScopes(response, GOOGLE_SCOPES)) {
        done.reject(new Error('Kraken needs the Google Drive permission to work. Sign in again and tick the box to allow it.'));
        return;
      }
      tokens.set(response.access_token, Number(response.expires_in));
      done.resolve();
    },
    error_callback: (error) => {
      const done = pending;
      pending = null;
      done?.reject(new Error(error.type === 'popup_closed' ? 'Sign-in window was closed.' : `Sign-in failed (${error.type}).`));
    },
  });
}

/** Opens the Google sign-in popup. Must be called directly from a click, or the browser blocks the popup. */
export function signIn(): Promise<void> {
  if (!tokenClient) return Promise.reject(new Error('Google sign-in is still loading. Try again in a moment.'));
  pending?.reject(new Error('Sign-in restarted.'));
  return new Promise<void>((resolve, reject) => {
    pending = { resolve, reject };
    // prompt '' = ask for consent only the first time; after that the popup just confirms the account.
    tokenClient?.requestAccessToken({ prompt: '' });
  });
}

/** The current access token. Throws a 'signed-out' error if there is none or it expired (about 1 hour). */
export function getToken(): string {
  const token = tokens.get();
  if (!token) throw new SheetsError('signed-out', 401, 'Not signed in, or the sign-in expired.');
  return token;
}

export function isSignedIn(): boolean {
  return tokens.get() !== null;
}

/** Forgets the token and tells Google to revoke it. */
export function signOut(): void {
  const token = tokens.peek();
  tokens.clear();
  if (token && typeof google !== 'undefined') google.accounts.oauth2.revoke(token);
}
