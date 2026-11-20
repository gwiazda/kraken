// Kraken start screen: sign in, then connect to the Kraken spreadsheet.
// All text is set with textContent (never innerHTML), so nothing from Google or the sheet can inject code.

import {
  SignInSuperseded,
  getToken,
  initAuth,
  isSignedIn,
  onLateReply,
  signIn,
  signOut,
  withFreshToken,
} from './auth';
import { whoAmI } from './core/drive';
import { pickSpreadsheet } from './core/picker';
import { SheetsError, isGoogleSheetsUrl, type SheetsClient, type SpreadsheetInfo } from './core/sheets';
import { browserStore, forgetSpreadsheetId, loadSpreadsheetId, saveSpreadsheetId } from './core/storage';
import { showLotsPage, sheetLotsRepository, type LotsPageDeps } from './features/lots';
import { allocate, sheetRoastsRepository, showRoastsPage } from './features/roasts';
import { lotLosses, sheetCostsRepository, showPackagingPage, validateLoss } from './features/costs';
import { sheetClientsRepository, sheetSpecialPricesRepository, showClientsPage } from './features/clients';
import { showOfferPage } from './features/offers';
import { sheetSaleNotesRepository, sheetSalesRepository, showSalesPage } from './features/sales';
import { sheetProductsRepository, showPlannerPage, showProductsPage, type PlannerStart } from './features/products';
import { showRoastimeSync } from './features/roastime';
import { APP_SCHEMA_VERSION, MigrationError, createKrakenSpreadsheet, describeMetaProblem, inspectSpreadsheet, updatePlan, updateSpreadsheet } from './schema';
import { button, el, gearIcon, message, type Child } from './ui/dom';
import { forgetLists } from './ui/listView';
import { HOME_SCREEN, type Screen, screenOf, stateFor } from './ui/history';
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
/** The sheet whose list filters are remembered (ui/listView.ts); another sheet starts without them. */
let listsSheetId = '';
/** The screen shown now (to put it back if Back is pressed while saving). */
let currentScreen: Screen = HOME_SCREEN;
/** True while Kraken saves to Google: Back and the menu wait, so nothing is left running unseen. */
let saving = false;
/** History moves Kraken makes itself (stepping back over a closed form or import) whose popstate must be ignored. */
let ownMoves = 0;

/** 'push': a new history entry (a click); 'replace': this entry becomes the screen; 'none': came from Back/Forward. */
type HistoryMove = 'push' | 'replace' | 'none';

function record(screen: Screen, move: HistoryMove): void {
  currentScreen = screen;
  if (move === 'push') window.history.pushState(stateFor(screen), '', `#${screen}`);
  if (move === 'replace') window.history.replaceState(stateFor(screen), '', `#${screen}`);
}

/**
 * Steps back over a history entry Kraken itself added (an open form, the import), without reacting to it, so the
 * history stays clean. Done at most once at a time; a safety timer clears the counter if the browser never answers.
 */
function leave(screen: Screen): void {
  if (screenOf(window.history.state) !== screen || ownMoves > 0) return;
  ownMoves = 1;
  window.history.back();
  window.setTimeout(() => (ownMoves = 0), 1000);
}

/** How a menu click moves: back to the same screen (or out of an open form) replaces, anything else adds a step. */
function menuMove(target: Screen): HistoryMove {
  const now = screenOf(window.history.state);
  return now === target || now === 'lot-form' || now === 'roast-form' || now === 'product-form' || now === 'client-form' || now === 'sale-form' ? 'replace' : 'push';
}

window.addEventListener('popstate', (event) => {
  if (ownMoves > 0) {
    ownMoves = 0;
    return;
  }
  const info = openSheet;
  if (!info) return;
  if (saving) {
    window.history.pushState(stateFor(currentScreen), '', `#${currentScreen}`); // stay: Kraken is saving
    return;
  }
  const screen = screenOf(event.state);
  if (screen === 'settings') showSettings(info, 'none');
  else if (screen === 'packaging') showPackaging(info, false, 'none');
  else if (screen === 'offer') showOffer(info, false, 'none');
  else if (screen === 'sales' || screen === 'sale-form') {
    if (screen === 'sale-form') window.history.replaceState(stateFor('sales'), '', '#sales');
    showSales(info, false, 'none');
  }
  else if (screen === 'clients' || screen === 'client-form') {
    if (screen === 'client-form') window.history.replaceState(stateFor('clients'), '', '#clients');
    showClients(info, false, 'none');
  }
  else if (screen === 'planner') showPlanner(info, lastPlan, false, 'none');
  else if (screen === 'products' || screen === 'product-form') {
    if (screen === 'product-form') window.history.replaceState(stateFor('products'), '', '#products');
    showProducts(info, false, 'none');
  }
  else if (screen === 'sync') showSync(info, 'none');
  else if (screen === 'roasts' || screen === 'roast-form') {
    // A form cannot be brought back with Forward: that entry becomes the list.
    if (screen === 'roast-form') window.history.replaceState(stateFor('roasts'), '', '#roasts');
    showRoasts(info, undefined, false, 'none');
  } else if (screen === 'lots' || screen === 'lot-form') {
    if (screen === 'lot-form') window.history.replaceState(stateFor('lots'), '', '#lots');
    showLots(info, undefined, false, 'none');
  } else showSales(info, false, 'none'); // the home screen
});

/** A screen of the connected app: a small menu bar on top, the page below. */
type MenuTab = 'lots' | 'roasts' | 'products' | 'planner' | 'offer' | 'sales' | 'clients' | 'packaging' | 'settings';

function showApp(info: SpreadsheetInfo, active: MenuTab): HTMLElement {
  resume = null;
  if (listsSheetId !== info.id) forgetLists(); // another sheet: its lists start without filters
  listsSheetId = info.id;
  openSheet = info;
  const page = el('section', { class: 'page' });
  const tab = (label: string, name: MenuTab, open: () => void) => {
    const b = button(label, open, 'link');
    if (name === active) b.setAttribute('aria-current', 'page');
    return b;
  };
  app.replaceChildren(
    el(
      'nav',
      { class: 'app-nav', 'aria-label': 'Kraken' },
      // Sales first: Kraken opens on it (owner, 2026-11-20).
      tab('Sprzedaż', 'sales', () => {
        if (!saving) showSales(info, true, menuMove('sales'));
      }),
      tab('Zielone ziarno', 'lots', () => {
        if (!saving) showLots(info, undefined, true, menuMove('lots'));
      }),
      tab('Wypały', 'roasts', () => {
        if (!saving) showRoasts(info, undefined, true, menuMove('roasts'));
      }),
      tab('Produkty', 'products', () => {
        if (!saving) showProducts(info, true, menuMove('products'));
      }),
      tab('Planer produktu', 'planner', () => {
        if (!saving) showPlanner(info, undefined, true, menuMove('planner'));
      }),
      tab('Oferta', 'offer', () => {
        if (!saving) showOffer(info, true, menuMove('offer'));
      }),
      tab('Klienci', 'clients', () => {
        if (!saving) showClients(info, true, menuMove('clients'));
      }),
      tab('Opakowania i rabaty', 'packaging', () => {
        if (!saving) showPackaging(info, true, menuMove('packaging'));
      }),
      // Kraken's own settings (sheet, sync, sign-in), apart from the business tabs: on the right, with a gear.
      (() => {
        const b = tab('Ustawienia', 'settings', () => {
          if (!saving) showSettings(info, menuMove('settings'));
        });
        b.classList.add('nav-settings');
        b.title = 'Ustawienia Krakena: arkusz, synchronizacja z RoasTime, logowanie';
        b.prepend(gearIcon(), ' ');
        return b;
      })(),
    ),
    page,
  );
  return page;
}

function errorText(error: unknown): string {
  if (error instanceof SheetsError) {
    switch (error.kind) {
      case 'signed-out':
        return 'Twoje logowanie wygasło. Zaloguj się ponownie.';
      case 'no-access':
        return 'Kraken nie może otworzyć tego arkusza. Jeśli ktoś Ci go udostępnił, wybierz go raz przyciskiem „Wybierz istniejący arkusz”.';
      case 'rate-limited':
        return 'Google jest teraz zajęty. Poczekaj minutę i spróbuj ponownie.';
      case 'other':
        return error.message;
    }
  }
  return error instanceof Error ? error.message : String(error);
}

const WAITING_FOR_GOOGLE = 'Czekam na logowanie Google… Dokończ je w oknie Google.';

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
    el('p', {}, 'Zaloguj się kontem Google, które ma dostęp do arkusza Krakena.'),
    ...(note ? [message(note, 'error')] : []),
    button('Zaloguj się przez Google', () => signInFromClick(afterSignIn, (text) => showSignIn(text), screen)),
  );
  resume = screen;
}

/**
 * Google rejected the sign-in in the middle of an action. Offer to sign in and repeat the same action instead of
 * starting over. Future forms keep their typed values this way.
 */
function showRetry(retry: () => void, note = 'Twoje logowanie Google wygasło. Nic nie zostało utracone.'): void {
  const screen: Resume = { ok: retry, fail: (text) => showRetry(retry, text) };
  show(
    message(note, 'error'),
    button('Zaloguj się i kontynuuj', () => signInFromClick(retry, (text) => showRetry(retry, text), screen)),
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
    el('p', {}, 'Połącz Krakena z jego arkuszem Google.'),
    ...(note ? [message(note, 'error')] : []),
    el(
      'div',
      { class: 'actions' },
      button('Wybierz istniejący arkusz', onClickWithGoogle('Otwieram okno plików Google…', chooseSheet)),
      ...(ownerSetup ? [button('Utwórz arkusz Krakena', onClickWithGoogle('Tworzę arkusz Krakena…', createSheet), 'secondary')] : []),
    ),
    el(
      'p',
      { class: 'muted small' },
      ownerSetup
        ? 'Tworzy nowy, pusty arkusz Krakena na Twoim Dysku Google. Udostępnij go wspólnikowi na Dysku Google.'
        : 'Wybierz arkusz Krakena raz na tym komputerze. Jeśli ktoś Ci go udostępnił, jest w zakładce „Udostępnione dla mnie”.',
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
  await run('Otwieram arkusz Krakena…', async () => {
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
    showSales(info, false, 'replace', note); // Sales first (owner, 2026-11-20: the partner records sales on the go)
  });
}

/** The sheet is older than this app. Nothing changes until the user clicks "Update now". */
function showUpdate(info: SpreadsheetInfo, fromVersion: number, error?: string): void {
  const shownAt = new Date(); // the backup gets the name shown here, even if the click comes after midnight
  const plan = updatePlan(fromVersion, shownAt);
  show(
    el('p', {}, `Twój arkusz Krakena „${info.title}” wymaga aktualizacji (wersja danych ${fromVersion} → ${plan.toVersion}):`),
    el('ul', {}, ...plan.changes.map((change) => el('li', {}, change))),
    el(
      'p',
      { class: 'muted small' },
      `Kraken najpierw zrobi pełną kopię zapasową na Twoim Dysku Google o nazwie „${plan.backupName}” i ją sprawdzi. ` +
        'Dopiero potem zmieni Twój arkusz.',
    ),
    ...(error ? [message(error, 'error')] : []),
    el(
      'div',
      { class: 'actions' },
      button('Aktualizuj teraz', onClickWithGoogle('Rozpoczynam aktualizację…', () => runUpdate(info, fromVersion, shownAt))),
      button(
        'Zmień arkusz',
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
    await connect(info.id, result.backupName ? `Zaktualizowano. Kopia zapasowa jest na Twoim Dysku Google: „${result.backupName}”.` : undefined);
  } catch (error) {
    if (error instanceof SignInSuperseded || (error instanceof SheetsError && error.kind === 'signed-out')) throw error;
    const text = error instanceof MigrationError ? error.message : `${errorText(error)} Wersja danych nie została podniesiona; kliknij „Aktualizuj teraz” jeszcze raz.`;
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

/** What every page needs to talk to Google and explain problems. */
function googleDeps() {
  return {
    whoAmI: () => whoAmI(client), // asked each time: the person signed in can change on renewal
    withGoogle: <T>(action: () => Promise<T>) => withFreshToken(action),
    signIn,
    isSignedOut: (error: unknown) => error instanceof SheetsError && error.kind === 'signed-out',
    isIgnorable: (error: unknown) => error instanceof SignInSuperseded,
    describeError: errorText,
    now: () => new Date(),
    busy: (on: boolean) => {
      saving = on;
      app.classList.toggle('saving', on);
    },
  };
}

function lotsPageDeps(info: SpreadsheetInfo): LotsPageDeps {
  const roasts = sheetRoastsRepository(client, info.id);
  const costs = sheetCostsRepository(client, info.id);
  return {
    ...googleDeps(),
    repo: sheetLotsRepository(client, info.id),
    // Stock left: the roasts are loaded and counted against the lots (oldest delivery first).
    loadStock: async (lots) => allocate(lots, (await roasts.load()).roasts).lots,
    // Roast loss: the lot's own value (Lot costs tab), else the average of its roasts, else the usual loss.
    loadLosses: async (lots) => {
      const [data, all] = await Promise.all([costs.load(), roasts.load()]);
      return lotLosses(data, lots, all.roasts);
    },
    checkLoss: validateLoss,
    saveLoss: async (lotId, value) => {
      const data = await costs.load();
      const existing = data.lotCosts.find((c) => c.deletedAt === '' && c.lotId === lotId);
      await costs.saveLoss(lotId, value, existing, () => whoAmI(client), new Date());
    },
    formOpened: () => record('lot-form', 'push'),
    formClosed: () => {
      currentScreen = 'lots';
      leave('lot-form');
    },
  };
}

function showRoasts(info: SpreadsheetInfo, note?: string, fromClick = false, move: HistoryMove = 'push'): void {
  record('roasts', move);
  showRoastsPage(
    showApp(info, 'roasts'),
    {
      ...googleDeps(),
      repo: sheetRoastsRepository(client, info.id),
      lots: sheetLotsRepository(client, info.id),
      formOpened: () => record('roast-form', 'push'),
      formClosed: () => {
        currentScreen = 'roasts';
        leave('roast-form');
      },
    },
    note,
    fromClick,
  );
}

function showPackaging(info: SpreadsheetInfo, fromClick = false, move: HistoryMove = 'push'): void {
  record('packaging', move);
  showPackagingPage(showApp(info, 'packaging'), { ...googleDeps(), repo: sheetCostsRepository(client, info.id) }, undefined, fromClick);
}

/** `create`: open "Add product" with these beans and prices (from the Product planner). */
function showProducts(info: SpreadsheetInfo, fromClick = false, move: HistoryMove = 'push', create?: PlannerStart): void {
  record('products', move);
  showProductsPage(
    showApp(info, 'products'),
    {
      ...googleDeps(),
      repo: sheetProductsRepository(client, info.id),
      costs: sheetCostsRepository(client, info.id),
      lots: sheetLotsRepository(client, info.id),
      roasts: sheetRoastsRepository(client, info.id),
      // A product, then its form: one history step, so Back returns to the list.
      formOpened: () => record('product-form', currentScreen === 'product-form' ? 'replace' : 'push'),
      formClosed: () => {
        currentScreen = 'products';
        leave('product-form');
      },
      openPlanner: (start) => showPlanner(info, start, true),
    },
    undefined,
    fromClick,
    create,
  );
}

/** The Sales page (owner, 2026-11-19): sales, samples, own use, and the invoices to issue. */
/** The Sales page; also the page Kraken opens with (owner, 2026-11-20). `note`: e.g. after an update of the sheet. */
function showSales(info: SpreadsheetInfo, fromClick = false, move: HistoryMove = 'push', note?: string): void {
  record('sales', move);
  showSalesPage(
    showApp(info, 'sales'),
    {
      ...googleDeps(),
      repo: sheetSalesRepository(client, info.id),
      notes: sheetSaleNotesRepository(client, info.id),
      clients: sheetClientsRepository(client, info.id),
      products: sheetProductsRepository(client, info.id),
      formOpened: () => record('sale-form', currentScreen === 'sale-form' ? 'replace' : 'push'),
      formClosed: () => {
        currentScreen = 'sales';
        leave('sale-form');
      },
    },
    note,
    fromClick,
  );
}

/** The Clients page (owner, 2026-11-19). */
function showClients(info: SpreadsheetInfo, fromClick = false, move: HistoryMove = 'push'): void {
  record('clients', move);
  showClientsPage(
    showApp(info, 'clients'),
    {
      ...googleDeps(),
      repo: sheetClientsRepository(client, info.id),
      costs: sheetCostsRepository(client, info.id),
      prices: sheetSpecialPricesRepository(client, info.id),
      products: sheetProductsRepository(client, info.id),
      lots: sheetLotsRepository(client, info.id),
      roasts: sheetRoastsRepository(client, info.id),
      formOpened: () => record('client-form', currentScreen === 'client-form' ? 'replace' : 'push'),
      formClosed: () => {
        currentScreen = 'clients';
        leave('client-form');
      },
    },
    undefined,
    fromClick,
  );
}

/** The plan in the Product planner after its last change: Back/Forward bring it back (kept only in this browser tab). */
let lastPlan: PlannerStart | undefined;

/** The Planner (owner, 2026-11-19): try beans and prices, nothing saved. `start`: e.g. a product's beans and prices. */
function showPlanner(info: SpreadsheetInfo, start?: PlannerStart, fromClick = false, move: HistoryMove = 'push'): void {
  record('planner', move);
  showPlannerPage(
    showApp(info, 'planner'),
    {
      ...googleDeps(),
      products: sheetProductsRepository(client, info.id),
      costs: sheetCostsRepository(client, info.id),
      lots: sheetLotsRepository(client, info.id),
      roasts: sheetRoastsRepository(client, info.id),
      createProduct: (plan) => showProducts(info, true, 'push', plan),
      remember: (plan) => (lastPlan = plan),
    },
    start,
    fromClick,
  );
}

function showOffer(info: SpreadsheetInfo, fromClick = false, move: HistoryMove = 'push'): void {
  record('offer', move);
  showOfferPage(
    showApp(info, 'offer'),
    {
      ...googleDeps(),
      products: sheetProductsRepository(client, info.id),
      costs: sheetCostsRepository(client, info.id),
      clients: sheetClientsRepository(client, info.id),
      prices: sheetSpecialPricesRepository(client, info.id),
      openProducts: () => showProducts(info, true),
    },
    fromClick,
  );
}

/** "Sync with RoasTime", opened from Settings (owner, 2026-11-18); it returns there. */
function showSync(info: SpreadsheetInfo, move: HistoryMove = 'push'): void {
  record('sync', move);
  showRoastimeSync(showApp(info, 'settings'), {
    ...googleDeps(),
    lots: sheetLotsRepository(client, info.id),
    roasts: sheetRoastsRepository(client, info.id),
    copyText: (text: string) => navigator.clipboard.writeText(text),
    back: (note?: string) => {
      leave('sync');
      showSettings(info, 'none', note);
      currentScreen = 'settings';
    },
  });
}

/** The sheet Kraken uses, and signing out. Kept off the main page (owner, 2026-11-15). */
function showSettings(info: SpreadsheetInfo, move: HistoryMove = 'push', note?: string): void {
  record('settings', move);
  // Only link to a real Google Sheets address (defence in depth: the URL comes from Google's reply).
  const link = isGoogleSheetsUrl(info.url)
    ? el('a', { href: info.url, target: '_blank', rel: 'noopener noreferrer' }, info.title)
    : el('span', {}, info.title);
  showApp(info, 'settings').append(
    el('h2', {}, 'Ustawienia Krakena'),
    el('p', { class: 'muted small' }, 'Jak działa sam Kraken: arkusz, z którego korzysta, pobieranie danych z RoasTime i logowanie. Opakowania, ceny i rabaty są w zakładce Opakowania i rabaty.'),
    ...(note ? [message(note)] : []),
    el('section', { class: 'product-card' }, el('h3', {}, 'RoasTime'),
      el('p', { class: 'muted small' }, 'Pobiera dostawy i wypały z folderu RoasTime na tym komputerze. Najpierw widzisz podgląd; nic nie jest zapisywane, dopóki nie potwierdzisz.'),
      el('div', { class: 'actions' }, button('Synchronizuj z RoasTime', () => showSync(info), 'primary')),
    ),
    el('h3', {}, 'Arkusz i logowanie'),
    el('p', { class: 'connected' }, 'Połączono z: ', link),
    el('p', { class: 'muted small' }, `Wersja danych ${APP_SCHEMA_VERSION}.`),
    el(
      'div',
      { class: 'actions' },
      button(
        'Zmień arkusz',
        () => {
          forgetSpreadsheetId(store);
          showChooseSheet();
        },
        'secondary',
      ),
      button(
        'Wyloguj się',
        () => {
          signOut();
          forgetLists();
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

show(message('Wczytuję logowanie Google…'));
initAuth()
  .then(() => showSignIn())
  .catch((error: unknown) => show(message(errorText(error), 'error')));
