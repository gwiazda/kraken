// Sign-in with Google Identity Services, popup style (no redirect, no server).
// The access token lives only in memory and is lost when the page is closed, which is intended.

import { GOOGLE_CLIENT_ID, GOOGLE_SCOPES } from './config';
import { loadScript } from './loadScript';
import { makeGuard } from './session';
import { SheetsError } from './sheets';
import { SignInFlow } from './signInFlow';
import { TokenHolder } from './token';

const GIS_SCRIPT = 'https://accounts.google.com/gsi/client';

const tokens = new TokenHolder();
const flow = new SignInFlow(tokens);
let tokenClient: google.accounts.oauth2.TokenClient | null = null;

/** Loads the Google sign-in script. Call once at start-up so the sign-in click opens the popup without delay. */
export async function initAuth(): Promise<void> {
  await loadScript(GIS_SCRIPT);
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: GOOGLE_SCOPES,
    callback: (response) => {
      const granted = !response.error && google.accounts.oauth2.hasGrantedAllScopes(response, GOOGLE_SCOPES);
      flow.handleToken(response, granted);
    },
    error_callback: (error) => flow.handlePopupError(error.type),
  });
}

/** Called when Google delivers a sign-in after it had already reported the popup as closed. */
export function onLateSignIn(listener: () => void): void {
  flow.onLateSignIn(listener);
}

/** Opens the Google sign-in popup. Must be called directly from a click, or the browser blocks the popup. */
export function signIn(): Promise<void> {
  const client = tokenClient;
  if (!client) return Promise.reject(new Error('Google sign-in is still loading. Try again in a moment.'));
  // prompt '' = ask for consent only the first time; after that the popup just confirms the account.
  return flow.start(() => client.requestAccessToken({ prompt: '' }));
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

/**
 * Wrap every button action that talks to Google: if the token is missing or has less than 5 minutes left,
 * Google's popup opens first (it closes by itself when the user already allowed Kraken), then the action runs.
 * Must be called directly in the click handler.
 */
export const withFreshToken = makeGuard({ status: () => tokens.status(), renew: signIn });

/** Forgets the token and tells Google to revoke it. */
export function signOut(): void {
  const token = tokens.peek();
  tokens.clear();
  if (token && typeof google !== 'undefined') google.accounts.oauth2.revoke(token);
}
