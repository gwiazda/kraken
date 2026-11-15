// Kraken start screen: sign in, then connect to the Kraken spreadsheet.
// All text is set with textContent (never innerHTML), so nothing from Google or the sheet can inject code.

import {
  SignInSuperseded,
  getToken,
  initAuth,
  isSignedIn,
  onLateReply,
  onSignInLog,
  signIn,
  signOut,
  withFreshToken,
} from './auth';
import { whoAmI } from './core/drive';
import { pickSpreadsheet } from './core/picker';
import { SheetsError, isGoogleSheetsUrl, type SheetsClient, type SpreadsheetInfo } from './core/sheets';
import { browserStore, forgetSpreadsheetId, loadSpreadsheetId, saveSpreadsheetId } from './core/storage';
import { showLotsPage, sheetLotsRepository, type LotsPageDeps } from './features/lots';
import { showRoastimeImport } from './features/roastime';
import { APP_SCHEMA_VERSION, MigrationError, createKrakenSpreadsheet, describeMetaProblem, inspectSpreadsheet, updatePlan, updateSpreadsheet } from './schema';
import { startDevSignInLog } from './ui/devLog';
import { button, el, message, type Child } from './ui/dom';
import { screenOf, stateFor, type Screen } from './ui/history';
import { wantsNewSheet } from './ui/newSheetMode';

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

function show(...children: Child[]): void {
  resume = null;
  openSheet = null; // Back no longer leads into the connected screens
  app.replaceChildren(el('h1', {}, 'Kraken'), ...children);
}

// ---- Browser Back / Forward between Kraken's screens ----

/** The connected sheet, while one of its screens is shown. */
let openSheet: SpreadsheetInfo | null = null;
/** History moves Kraken makes itself (e.g. leaving a form) whose popstate must be ignored. */
let ownMoves = 0;

/** 'push': a new history entry (a click); 'replace': this entry becomes the screen; 'none': came from Back/Forward. */
type HistoryMove = 'push' | 'replace' | 'none';

function record(screen: Screen, move: HistoryMove): void {
  if (move === 'push') window.history.pushState(stateFor(screen), '', `#${screen}`);
  if (move === 'replace') window.history.replaceState(stateFor(screen), '', `#${screen}`);
}

/** Steps back over a history entry Kraken itself added (the form, the import), without reacting to it. */
function leave(screen: Screen): void {
  if (screenOf(window.history.state) !== screen) return;
  ownMoves++;
  window.history.back();
}

window.addEventListener('popstate', (event) => {
  if (ownMoves > 0) {
    ownMoves--;
    return;
  }
  const info = openSheet;
  if (!info) return;
  const screen = screenOf(event.state);
  if (screen === 'settings') showSettings(info, 'none');
  else if (screen === 'import') showImport(info, 'none');
  else showLots(info, undefined, false, 'none'); // a form cannot be brought back: Forward shows the list
});

/** A screen of the connected app: a small menu bar on top, the page below. */
function showApp(info: SpreadsheetInfo, active: 'lots' | 'settings'): HTMLElement {
  resume = null;
  openSheet = info;
  const page = el('section', { class: 'page' });
  const tab = (label: string, name: 'lots' | 'settings', open: () => void) => {
    const b = button(label, open, 'link');
    if (name === active) b.setAttribute('aria-current', 'page');
    return b;
  };
  app.replaceChildren(
    el('nav', { class: 'app-nav', 'aria-label': 'Kraken' }, tab('Lots', 'lots', () => showLots(info, undefined, true)), tab('Settings', 'settings', () => showSettings(info))),
    page,
  );
  return page;
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
  // `?new-sheet` always shows the screen with "Create Kraken sheet", even if this browser remembers a sheet.
  if (savedId && !wantsNewSheet(window.location.search)) {
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
  const ownerSetup = wantsNewSheet(window.location.search);
  show(
    el('p', {}, 'Connect Kraken to its Google Sheet.'),
    ...(note ? [message(note, 'error')] : []),
    el(
      'div',
      { class: 'actions' },
      button('Choose existing sheet', onClickWithGoogle("Opening Google's file window…", chooseSheet)),
      ...(ownerSetup ? [button('Create Kraken sheet', onClickWithGoogle('Creating the Kraken sheet…', createSheet), 'secondary')] : []),
    ),
    el(
      'p',
      { class: 'muted small' },
      ownerSetup
        ? 'Creates a new, empty Kraken sheet in your Google Drive. Share it in Google Drive with your partner.'
        : 'Choose the Kraken sheet once on this computer. If it was shared with you, it is under "Shared with me".',
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
  const info = await createKrakenSpreadsheet(client);
  remember(info.id);
  await connect(info.id);
}

async function connect(id: string, note?: string): Promise<void> {
  await run('Opening the Kraken sheet…', async () => {
    const { info, meta } = await inspectSpreadsheet(client, id);
    if (meta.kind === 'needs-migration') {
      remember(info.id);
      showUpdate(info, meta.schemaVersion);
      return;
    }
    const problem = describeMetaProblem(meta);
    if (problem) {
      showChooseSheet(problem);
      return;
    }
    remember(info.id);
    showLots(info, note, false, 'replace');
  });
}

/** The sheet is older than this app. Nothing changes until the user clicks "Update now". */
function showUpdate(info: SpreadsheetInfo, fromVersion: number, error?: string): void {
  const shownAt = new Date(); // the backup gets the name shown here, even if the click comes after midnight
  const plan = updatePlan(fromVersion, shownAt);
  show(
    el('p', {}, `Your Kraken sheet "${info.title}" needs an update (data version ${fromVersion} → ${plan.toVersion}):`),
    el('ul', {}, ...plan.changes.map((change) => el('li', {}, change))),
    el(
      'p',
      { class: 'muted small' },
      `Kraken will first make a full backup copy in your Google Drive, named "${plan.backupName}", and check it. ` +
        'Your sheet is changed only after that.',
    ),
    ...(error ? [message(error, 'error')] : []),
    el(
      'div',
      { class: 'actions' },
      button('Update now', onClickWithGoogle('Starting the update…', () => runUpdate(info, fromVersion, shownAt))),
      button(
        'Change sheet',
        () => {
          forgetSpreadsheetId(store);
          showChooseSheet();
        },
        'secondary',
      ),
    ),
  );
}

async function runUpdate(info: SpreadsheetInfo, fromVersion: number, shownAt: Date): Promise<void> {
  try {
    const result = await updateSpreadsheet(client, info.id, (text) => show(message(text)), shownAt);
    await connect(info.id, result.backupName ? `Updated. Backup copy saved in your Google Drive: "${result.backupName}".` : undefined);
  } catch (error) {
    if (error instanceof SignInSuperseded || (error instanceof SheetsError && error.kind === 'signed-out')) throw error;
    const text = error instanceof MigrationError ? error.message : `${errorText(error)} The data version was not raised; try "Update now" again.`;
    showUpdate(info, fromVersion, text);
  }
}

function remember(id: string): void {
  if (!saveSpreadsheetId(store, id)) {
    console.warn('Browser storage is blocked: Kraken will ask for the sheet again next time.');
  }
}

function showLots(info: SpreadsheetInfo, note?: string, fromClick = false, move: HistoryMove = 'push'): void {
  record('lots', move);
  showLotsPage(showApp(info, 'lots'), lotsPageDeps(info), note, fromClick);
}

function lotsPageDeps(info: SpreadsheetInfo): LotsPageDeps {
  return {
    repo: sheetLotsRepository(client, info.id),
    whoAmI: () => whoAmI(client), // asked each time: the person signed in can change on renewal
    withGoogle: (action) => withFreshToken(action),
    signIn,
    isSignedOut: (error) => error instanceof SheetsError && error.kind === 'signed-out',
    isIgnorable: (error) => error instanceof SignInSuperseded,
    describeError: errorText,
    now: () => new Date(),
    openImport: () => showImport(info),
    formOpened: () => record('lot-form', 'push'),
    formClosed: () => leave('lot-form'),
  };
}

function showImport(info: SpreadsheetInfo, move: HistoryMove = 'push'): void {
  record('import', move);
  const deps = lotsPageDeps(info);
  showRoastimeImport(showApp(info, 'lots'), {
    ...deps,
    copyText: (text) => navigator.clipboard.writeText(text),
    backToLots: (note) => {
      leave('import');
      showLots(info, note, true, 'none');
    },
  });
}

/** The sheet Kraken uses, and signing out. Kept off the main page (owner, 2026-11-15). */
function showSettings(info: SpreadsheetInfo, move: HistoryMove = 'push'): void {
  record('settings', move);
  // Only link to a real Google Sheets address (defence in depth: the URL comes from Google's reply).
  const link = isGoogleSheetsUrl(info.url)
    ? el('a', { href: info.url, target: '_blank', rel: 'noopener noreferrer' }, info.title)
    : el('span', {}, info.title);
  showApp(info, 'settings').append(
    el('h2', {}, 'Settings'),
    el('p', { class: 'connected' }, 'Connected to: ', link),
    el('p', { class: 'muted small' }, `Data version ${APP_SCHEMA_VERSION}.`),
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
