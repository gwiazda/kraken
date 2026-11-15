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

export const UNUSABLE_PASS_MESSAGE = 'Google sent a sign-in pass Kraken could not use. Click "Sign in with Google" again.';

/** A sign-in attempt replaced by a newer one (for example a double click). Not an error to show. */
export class SignInSuperseded extends Error {
  constructor() {
    super('Sign-in replaced by a newer attempt.');
    this.name = 'SignInSuperseded';
  }
}

/** Google's expires_in in seconds, or null if it is missing or too short to work with. */
export function usableLifetime(expiresIn: number | string | undefined): number | null {
  const seconds = Number(expiresIn);
  return Number.isFinite(seconds) && seconds > 120 ? seconds : null;
}

export function popupErrorMessage(type: string): string {
  // Known Google behaviour: on a person's very first sign-in, Google's script loses contact with its own window
  // during the "allow" screens, reports popup_closed and never sends the pass. Google still saves the "allow",
  // so the second click works. (Diagnosed with the test-version sign-in log, 2026-11-09.)
  if (type === 'popup_closed') {
    return 'First time signing in? Google needs a second click: click "Sign in with Google" again. ' +
      '(If you closed the Google window yourself, just click it again too.)';
  }
  if (type === 'popup_failed_to_open') return 'Chrome blocked the Google sign-in window. Allow popups for this site and try again.';
  return `Google sign-in failed (${type}). Try again.`;
}

/** What a late reply from Google means: signed in after all, or a failure to show to the user. */
export type LateOutcome = { ok: true } | { ok: false; error: Error };

export class SignInFlow {
  private pending: { resolve: () => void; reject: (error: Error) => void } | null = null;
  private lateListener: (outcome: LateOutcome) => void = () => {};

  /** `log` receives a short description of each step (never the token itself), for the test-version sign-in log. */
  constructor(
    private readonly tokens: TokenHolder,
    private readonly log: (event: string) => void = () => {},
  ) {}

  /** Called when Google replies after the sign-in attempt was already reported as failed. */
  onLateReply(listener: (outcome: LateOutcome) => void): void {
    this.lateListener = listener;
  }

  private fail(waiting: { reject: (error: Error) => void } | null, error: Error): void {
    if (waiting) {
      waiting.reject(error);
    } else {
      this.lateListener({ ok: false, error });
    }
  }

  /** Starts a sign-in. `request` opens Google's popup and is called synchronously (popups need the click). */
  start(request: () => void): Promise<void> {
    this.pending?.reject(new SignInSuperseded());
    return new Promise<void>((resolve, reject) => {
      this.pending = { resolve, reject };
      this.log('Kraken asked Google to open the sign-in window');
      request();
    });
  }

  /** Google's token callback. `scopesGranted` = the user allowed the Drive permission. */
  handleToken(reply: TokenReply, scopesGranted: boolean): void {
    const waiting = this.pending;
    this.pending = null;
    const when = waiting ? '' : ' (late: after the attempt had ended)';

    if (reply.error || !reply.access_token) {
      this.log(`Google replied with an error: ${reply.error ?? 'no pass'}${when}`);
      this.fail(waiting, new Error(reply.error_description ?? reply.error ?? 'Google sign-in failed. Try again.'));
      return;
    }
    if (!scopesGranted) {
      this.log(`Google sent a pass WITHOUT the Drive permission${when}`);
      this.fail(waiting, new Error(MISSING_SCOPE_MESSAGE));
      return;
    }
    const lifetime = usableLifetime(reply.expires_in);
    if (lifetime === null) {
      this.log(`Google sent a pass without a usable lifetime${when}`);
      this.fail(waiting, new Error(UNUSABLE_PASS_MESSAGE));
      return;
    }
    this.log(`Google sent a pass with the Drive permission${when}`);
    this.tokens.set(reply.access_token, lifetime);
    if (waiting) {
      waiting.resolve();
    } else {
      this.lateListener({ ok: true });
    }
  }

  /** Google's popup error callback (for example 'popup_closed'). */
  handlePopupError(type: string): void {
    const waiting = this.pending;
    this.pending = null;
    this.log(`Google reported a window problem: ${type}${waiting ? '' : ' (after the attempt had ended)'}`);
    waiting?.reject(new Error(popupErrorMessage(type)));
  }
}
