// "Renew on the next click": before a button's action runs, make sure there is a fresh Google token.
//
// Browsers only allow a popup during a click. So when renewal is needed, `renew` (which opens Google's popup)
// must be called synchronously inside the click handler, before anything is awaited. `guard` guarantees that.

import { SignInSuperseded } from './signInFlow';
import type { TokenStatus } from './token';

export interface SessionDeps {
  status: () => TokenStatus;
  /** Opens Google's popup to get a fresh token. Must be called synchronously from a click. */
  renew: () => Promise<void>;
}

/** Returns a function to call from a click handler: renews the token first if needed, then runs the action. */
export function makeGuard(deps: SessionDeps) {
  return function guard<T>(action: () => Promise<T>): Promise<T> {
    const status = deps.status();
    if (status === 'valid') return action();
    // Called right now, in the same click, so Chrome allows the popup.
    const renewal = deps.renew();
    if (status === 'none') return renewal.then(action);
    // 'renew': the current pass still works for a few minutes. If renewal fails, do the action with it anyway.
    return renewal.then(action, (error: unknown) => {
      if (error instanceof SignInSuperseded || deps.status() === 'none') throw error;
      return action();
    });
  };
}
