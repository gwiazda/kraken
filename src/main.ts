// Kraken start screen: sign in, then connect to the Kraken spreadsheet.
// All text is set with textContent (never innerHTML), so nothing from Google or the sheet can inject code.

import { getToken, initAuth, isSignedIn, onLateReply, onSignInLog, signIn, signOut, withFreshToken } from './auth';
import { startDevSignInLog } from './devLog';
import { NEW_SHEET_TITLE } from './config';
import { describeMetaProblem, inspectSpreadsheet } from './connect';
import { pickSpreadsheet } from './picker';
import { SheetsError, createSpreadsheet, isGoogleSheetsUrl, type SheetsClient, type SpreadsheetInfo } from './sheets';
import { SignInSuperseded } from './signInFlow';
import { browserStore, forgetSpreadsheetId, loadSpreadsheetId, saveSpreadsheetId } from './storage';

const appRoot = document.querySelector<HTMLElement>('#app');
if (!appRoot) throw new Error('Missing #app element in index.html');
const app: HTMLElement = appRoot;

const client: SheetsClient = { getToken, fetch: (input, init) => window.fetch(input, init) };
const store = browserStore();

/**
 * What to do if Google delivers a sign-in reply after it had reported a failure.
 * Set only by screens that wait for a sign-in (the sign-in screen and "Sign in and continue"), cleared by every
 * other screen, so a late reply always resumes exactly the action the user was trying to do.
 */
interface Resume {
  ok: () => void;
  fail: (text: string) => void;
}
let resume: Resume | null = null;

type Child = Node | string;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  node.append(...children);
  return node;
}

function button(label: string, onClick: () => void, variant: 'primary' | 'secondary' = 'primary'): HTMLButtonElement {
  const b = el('button', { type: 'button', class: `btn btn-${variant}` }, label);
  b.addEventListener('click', onClick);
  return b;
}

function show(...children: Child[]): void {
  resume = null;
  app.replaceChildren(el('h1', {}, 'Kraken'), ...children);
}

function message(text: string, kind: 'info' | 'error' = 'info'): HTMLParagraphElement {
  return el('p', { class: kind === 'error' ? 'message message-error' : 'message muted', role: kind === 'error' ? 'alert' : 'status' }, text);
}

function errorText(error: unknown): string {
  if (error instanceof SheetsError) {
    switch (error.kind) {
      case 'signed-out':
        return 'Your sign-in expired. Please sign in again.';
      case 'no-access':
        return 'Kraken cannot open this sheet. If it was shared with you, use "Choose existing sheet" to pick it once.';
      case 'rate-limited':
        return 'Google is busy. Wait a minute and try again.';
      case 'other':
        return error.message;
    }
  }
  return error instanceof Error ? error.message : String(error);
}

const WAITING_FOR_GOOGLE = 'Waiting for Google sign-in… Finish it in the Google window.';

/**
 * Opens Google's sign-in window (synchronously, inside the click) and shows a waiting message, so there is nothing
 * to double-click. A newer attempt replacing this one is not an error and is ignored.
 */
function signInFromClick(next: () => void, onError: (text: string) => void, waitingScreen: Resume): void {
  const attempt = signIn();
  show(message(WAITING_FOR_GOOGLE));
  resume = waitingScreen;
  attempt.then(next).catch((error: unknown) => {
    if (error instanceof SignInSuperseded) return;
    if (!isSignedIn()) onError(errorText(error));
  });
}

/** Runs an action, showing a busy message and turning errors into a readable screen. */
async function run(busyText: string, action: () => Promise<void>): Promise<void> {
  show(message(busyText));
  try {
    await action();
  } catch (error) {
    if (error instanceof SignInSuperseded) return;
    if (error instanceof SheetsError && error.kind === 'signed-out') {
      showRetry(() => void run(busyText, action));
    } else {
      showChooseSheet(errorText(error));
    }
  }
}

/** Click handler for actions that talk to Google: renews the sign-in first if needed (renew on the next click). */
function onClickWithGoogle(busyText: string, action: () => Promise<void>): () => void {
  return () => {
    void run(busyText, () => withFreshToken(action));
  };
}

// ---- Screens ----

function showSignIn(note?: string): void {
  const screen: Resume = { ok: afterSignIn, fail: (text) => showSignIn(text) };
  show(
    el('p', {}, 'Sign in with the Google account that has access to the Kraken sheet.'),
    ...(note ? [message(note, 'error')] : []),
    button('Sign in with Google', () => signInFromClick(afterSignIn, (text) => showSignIn(text), screen)),
  );
  resume = screen;
}

/**
 * Google rejected the sign-in in the middle of an action. Offer to sign in and repeat the same action instead of
 * starting over. Future forms keep their typed values this way.
 */
function showRetry(retry: () => void, note = 'Your Google sign-in ran out. Nothing was lost.'): void {
  const screen: Resume = { ok: retry, fail: (text) => showRetry(retry, text) };
  show(
    message(note, 'error'),
    button('Sign in and continue', () => signInFromClick(retry, (text) => showRetry(retry, text), screen)),
  );
  resume = screen;
}

function afterSignIn(): void {
  const savedId = loadSpreadsheetId(store);
  if (savedId) {
    void connect(savedId);
  } else {
    showChooseSheet();
  }
}

function showChooseSheet(note?: string): void {
  if (!isSignedIn()) {
    showSignIn(note);
    return;
  }
  show(
    el('p', {}, 'Connect Kraken to its Google Sheet.'),
    ...(note ? [message(note, 'error')] : []),
    el(
      'div',
      { class: 'actions' },
      button('Choose existing sheet', onClickWithGoogle("Opening Google's file window…", chooseSheet)),
      button('Create Kraken sheet', onClickWithGoogle('Creating the Kraken sheet…', createSheet), 'secondary'),
    ),
    el(
      'p',
      { class: 'muted small' },
      'First time? Create the sheet once, then share it in Google Drive with your partner. ' +
        'Your partner then uses "Choose existing sheet" once on their computer.',
    ),
  );
}

async function chooseSheet(): Promise<void> {
  const id = await pickSpreadsheet(getToken());
  if (id) {
    await connect(id);
  } else {
    showChooseSheet();
  }
}

async function createSheet(): Promise<void> {
  const info = await createSpreadsheet(client, NEW_SHEET_TITLE);
  remember(info.id);
  await connect(info.id);
}

async function connect(id: string): Promise<void> {
  await run('Opening the Kraken sheet…', async () => {
    const { info, meta } = await inspectSpreadsheet(client, id);
    const problem = describeMetaProblem(meta);
    if (problem) {
      showChooseSheet(problem);
      return;
    }
    remember(info.id);
    showConnected(info, meta.kind === 'ok' ? meta.schemaVersion : 0);
  });
}

function remember(id: string): void {
  if (!saveSpreadsheetId(store, id)) {
    console.warn('Browser storage is blocked: Kraken will ask for the sheet again next time.');
  }
}

function showConnected(info: SpreadsheetInfo, schemaVersion: number): void {
  // Only link to a real Google Sheets address (defence in depth: the URL comes from Google's reply).
  const link = isGoogleSheetsUrl(info.url)
    ? el('a', { href: info.url, target: '_blank', rel: 'noopener noreferrer' }, info.title)
    : el('span', {}, info.title);
  show(
    el('p', { class: 'connected' }, 'Connected to: ', link),
    el('p', { class: 'muted small' }, `Data version ${schemaVersion}. Next: green coffee lots, roasts and prices.`),
    el(
      'div',
      { class: 'actions' },
      button(
        'Change sheet',
        () => {
          forgetSpreadsheetId(store);
          showChooseSheet();
        },
        'secondary',
      ),
      button(
        'Sign out',
        () => {
          signOut();
          showSignIn();
        },
        'secondary',
      ),
    ),
  );
}

// ---- Start ----

onLateReply((outcome) => {
  const waiting = resume;
  if (!waiting) return;
  if (outcome.ok) {
    waiting.ok();
  } else {
    waiting.fail(errorText(outcome.error));
  }
});

// Test version only (npm run dev): show each sign-in step under the page, to diagnose sign-in problems.
if (import.meta.env.DEV) startDevSignInLog(onSignInLog);

show(message('Loading Google sign-in…'));
initAuth()
  .then(() => showSignIn())
  .catch((error: unknown) => show(message(errorText(error), 'error')));
