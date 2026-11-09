// Kraken start screen: sign in, then connect to the Kraken spreadsheet.
// All text is set with textContent (never innerHTML), so nothing from Google or the sheet can inject code.

import { getToken, initAuth, isSignedIn, signIn, signOut } from './auth';
import { NEW_SHEET_TITLE } from './config';
import { describeMetaProblem, inspectSpreadsheet } from './connect';
import { pickSpreadsheet } from './picker';
import { SheetsError, createSpreadsheet, type SheetsClient, type SpreadsheetInfo } from './sheets';
import { browserStore, forgetSpreadsheetId, loadSpreadsheetId, saveSpreadsheetId } from './storage';

const appRoot = document.querySelector<HTMLElement>('#app');
if (!appRoot) throw new Error('Missing #app element in index.html');
const app: HTMLElement = appRoot;

const client: SheetsClient = { getToken, fetch: (input, init) => window.fetch(input, init) };
const store = browserStore();

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

/** Runs an action, showing a busy message and turning errors into a readable screen. */
async function run(busyText: string, action: () => Promise<void>): Promise<void> {
  show(message(busyText));
  try {
    await action();
  } catch (error) {
    if (error instanceof SheetsError && error.kind === 'signed-out') {
      showSignIn(errorText(error));
    } else {
      showChooseSheet(errorText(error));
    }
  }
}

// ---- Screens ----

function showSignIn(note?: string): void {
  show(
    el('p', {}, 'Sign in with the Google account that has access to the Kraken sheet.'),
    ...(note ? [message(note, 'error')] : []),
    button('Sign in with Google', () => {
      signIn()
        .then(afterSignIn)
        .catch((error: unknown) => showSignIn(errorText(error)));
    }),
  );
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
      button('Choose existing sheet', () => {
        let token: string;
        try {
          token = getToken();
        } catch (error) {
          showSignIn(errorText(error));
          return;
        }
        pickSpreadsheet(token)
          .then((id) => (id ? connect(id) : showChooseSheet()))
          .catch((error: unknown) => showChooseSheet(errorText(error)));
      }),
      button('Create Kraken sheet', () => void createSheet(), 'secondary'),
    ),
    el(
      'p',
      { class: 'muted small' },
      'First time? Create the sheet once, then share it in Google Drive with your partner. ' +
        'Your partner then uses "Choose existing sheet" once on their computer.',
    ),
  );
}

async function createSheet(): Promise<void> {
  await run('Creating the Kraken sheet…', async () => {
    const info = await createSpreadsheet(client, NEW_SHEET_TITLE);
    remember(info.id);
    await connect(info.id);
  });
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
  const link = el('a', { href: info.url, target: '_blank', rel: 'noopener noreferrer' }, info.title);
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

show(message('Loading Google sign-in…'));
initAuth()
  .then(() => showSignIn())
  .catch((error: unknown) => show(message(errorText(error), 'error')));
