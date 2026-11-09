// The sign-in bookkeeping, kept free of Google's script so it can be tested.
//
// Google's script sometimes reports the popup as closed while the user is still on Google's first-time
// "allow" screens, and then delivers the token a moment later. So a token is never thrown away: if it arrives
// after the sign-in was already reported as failed, it is stored and `onLateSignIn` moves the app forward.

import type { TokenHolder } from './token';

export interface TokenReply {
  access_token?: string;
  expires_in?: number | string;
  error?: string;
  error_description?: string;
}

export const MISSING_SCOPE_MESSAGE =
  'Kraken did not get permission to use its Google Sheet. Click "Sign in with Google" again and, on Google\'s screen, ' +
  'tick the box that lets Kraken see and edit the Google Drive files you use with it.';

export function popupErrorMessage(type: string): string {
  if (type === 'popup_closed') return 'The Google sign-in window was closed before sign-in finished. Click "Sign in with Google" to try again.';
  if (type === 'popup_failed_to_open') return 'Chrome blocked the Google sign-in window. Allow popups for this site and try again.';
  return `Google sign-in failed (${type}). Try again.`;
}

export class SignInFlow {
  private pending: { resolve: () => void; reject: (error: Error) => void } | null = null;
  private lateListener: () => void = () => {};

  constructor(private readonly tokens: TokenHolder) {}

  /** Called when a token arrives after its sign-in attempt was already reported as failed. */
  onLateSignIn(listener: () => void): void {
    this.lateListener = listener;
  }

  /** Starts a sign-in. `request` opens Google's popup and is called synchronously (popups need the click). */
  start(request: () => void): Promise<void> {
    this.pending?.reject(new Error('Sign-in restarted.'));
    return new Promise<void>((resolve, reject) => {
      this.pending = { resolve, reject };
      request();
    });
  }

  /** Google's token callback. `scopesGranted` = the user allowed the Drive permission. */
  handleToken(reply: TokenReply, scopesGranted: boolean): void {
    const waiting = this.pending;
    this.pending = null;

    if (reply.error || !reply.access_token) {
      waiting?.reject(new Error(reply.error_description ?? reply.error ?? 'Google sign-in failed. Try again.'));
      return;
    }
    if (!scopesGranted) {
      waiting?.reject(new Error(MISSING_SCOPE_MESSAGE));
      return;
    }
    this.tokens.set(reply.access_token, Number(reply.expires_in));
    if (waiting) {
      waiting.resolve();
    } else {
      this.lateListener();
    }
  }

  /** Google's popup error callback (for example 'popup_closed'). */
  handlePopupError(type: string): void {
    const waiting = this.pending;
    this.pending = null;
    waiting?.reject(new Error(popupErrorMessage(type)));
  }
}
