// One way to explain a failed Google action on any screen (loading, saving, deleting, restoring, importing).
// - signed out: a button that signs in (inside the click) and repeats the action
// - someone else changed the record: reload
// - the tab is missing columns: say so, and offer to try again after fixing the sheet
// - anything else: Kraken cannot know whether a change reached the sheet, so it says so

import { ConflictError, TableError } from '../core/records';
import { button, message } from './dom';

export interface ErrorDeps {
  isSignedOut: (error: unknown) => boolean;
  isIgnorable: (error: unknown) => boolean;
  describeError: (error: unknown) => string;
  /** Opens Google's sign-in window. Called inside the click. */
  signIn: () => Promise<void>;
}

export interface ErrorOptions {
  /** Repeats the action after signing in. */
  retry: () => void;
  retryLabel: string;
  /** Shows a new error (if signing in fails). */
  show: (error: unknown) => void;
  /** The second button: 'Try again' (nothing was being written) or a reload (a write may have happened). */
  other: { label: string; action: () => void; mayHaveSaved: boolean };
  /** Shown after "Your Google sign-in ran out." */
  signedOutNote?: string;
}

export function googleErrorNodes(error: unknown, deps: ErrorDeps, options: ErrorOptions): Node[] {
  const other = button(options.other.label, options.other.action, 'secondary');
  if (deps.isSignedOut(error)) {
    return [
      message(`Your Google sign-in ran out. ${options.signedOutNote ?? 'What you did is still on screen.'}`, 'error'),
      button(options.retryLabel, () => {
        deps.signIn().then(options.retry, (e: unknown) => {
          if (!deps.isIgnorable(e)) options.show(e);
        });
      }),
    ];
  }
  if (error instanceof ConflictError) return [message(error.message, 'error'), other];
  if (error instanceof TableError) return [message(`${error.message} Fix it in the sheet, then try again.`, 'error'), other];
  if (options.other.mayHaveSaved) {
    return [message(`${deps.describeError(error)} Kraken could not finish. Reload to see what was saved.`, 'error'), other];
  }
  return [message(deps.describeError(error), 'error'), other];
}
