// The Sales screen (owner, 2026-11-19): what went out and the invoices to issue. Either owner adds entries: a sale
// to a client (the invoice starts "to be issued"), a sample left somewhere, or own use. The list has filters
// ("Invoice to be issued" first) and a dropdown for the invoice status (today's date is taken). A sale's prices
// (owner, 2026-11-27) are worked out by the invoice price rules (pricing.ts), shown live in the form and saved with it.
// Everything from outside comes through SalesPageDeps (main.ts provides it).

import { formatDate, localDate } from '../../core/dates';
import type { Fakturownia, FakturowniaRole, InvoiceState, IssuedInvoice } from '../../core/fakturownia';
import { formatPln, formatWholePln, parseMoney } from '../../core/numbers';
import { count } from '../../core/polish';
import { formatPercent } from '../../domain/percent';
import { BAG_SIZES_G, formatBagSize } from '../../domain/bagSizes';
import { busy, button, cardTable, clickableRow, el, infoTip, message } from '../../ui/dom';
import { googleErrorNodes } from '../../ui/googleErrors';
import { isClientDeleted, sortClients, type Client, type ClientsRepository, type SpecialPrice, type SpecialPricesRepository } from '../clients';
import { activeDiscounts, readSettings, type CostsRepository, type Discount } from '../costs';
import { isProductDeleted, sortProducts, type Product, type ProductsRepository } from '../products';
import {
  DATE_LABELS,
  HEADING_LABELS,
  KIND_LABELS,
  SAMPLE_SIZES_G,
  STATUS_LABELS,
  changedSaleFields,
  emptyLine,
  emptySaleForm,
  formFromSale,
  isDeleted,
  isSampleSize,
  lineSizeProblems,
  linesForKind,
  linesOf,
  choosableIds,
  saleEditFields,
  startingInvoice,
  statusChange,
  needsInvoiceDate,
  suggestedInvoiceDate,
  typedBags,
  validateSale,
  type Sale,
  type SaleForm,
  type InvoiceStatus,
  type LineForm,
  type SaleKind,
  type SaleLine,
} from './model';
import { FILTERS, bagsText, clientFacts, deletedEntryText, priceView, saleFacts, saleRows, type ClientInfo, type SaleRow, type SalesFilter } from './present';
import { linesToPrice, priceCells, priceEntry, pricingDataFrom } from './pricing';
import { cardDiffers, chooseClient, invoiceDraft, invoiceIdsToAsk, issuedFields, ksefState, ksefWaiting, paidUpdates, pricesUpToDate, type InvoiceDraft } from './invoice';
import { lastNotes, type SaleNote } from './modelNotes';
import { notesSection } from './notesSection';
import type { SalesRepository } from './repo';
import type { SaleNotesRepository } from './repoNotes';

export interface SalesPageDeps {
  repo: SalesRepository;
  /** Follow-up notes on samples (owner, 2026-11-20). */
  notes: SaleNotesRepository;
  clients: ClientsRepository;
  products: ProductsRepository;
  /** For a sale's prices (owner, 2026-11-27): the clients' special prices, and VAT and discounts. */
  prices: SpecialPricesRepository;
  costs: CostsRepository;
  /** Fakturownia through Kraken's middleman (owner, 2026-11-28): issuing invoices, reading which are paid. */
  fakturownia: Fakturownia;
  whoAmI: () => Promise<string>;
  /** Runs an action that talks to Google, renewing the sign-in first if needed. Call it inside a click. */
  withGoogle: <T>(action: () => Promise<T>) => Promise<T>;
  signIn: () => Promise<void>;
  isSignedOut: (error: unknown) => boolean;
  isIgnorable: (error: unknown) => boolean;
  describeError: (error: unknown) => string;
  now: () => Date;
  /** The form opened (so the browser's Back closes it) / closed. */
  formOpened: () => void;
  formClosed: () => void;
  /** Kraken is saving to Google (true) or done (false): Back and the menu wait meanwhile. */
  busy: (on: boolean) => void;
}

export function showSalesPage(root: HTMLElement, deps: SalesPageDeps, note?: string, fromClick = false): void {
  let sales: Sale[] = [];
  let lines: SaleLine[] = [];
  /** Follow-up notes of samples (all, deleted ones included). */
  let sampleNotes: SaleNote[] = [];
  let clients: Client[] = [];
  let products: Product[] = [];
  let deals: SpecialPrice[] = [];
  let discounts: Discount[] = [];
  let vatTenths = 230;
  /** Why prices cannot be worked out now ('' when they can): Special prices or Packaging & discounts did not load. */
  let pricesUnavailable = '';
  let problems: string[] = [];
  /** The filter shown: Sales always opens on the invoices to issue (owner, 2026-11-26). */
  let filter: SalesFilter = 'to_issue';
  /** Who is signed in, for Fakturownia (null until known, or when it cannot be reached): only the owner issues. */
  let role: FakturowniaRole | null = null;
  /** Fakturownia is asked once per visit to Sales (who is signed in, which invoices are paid). */
  let fakturowniaAsked = false;
  /** The list is on screen (not a sale's page). */
  let onList = false;
  /**
   * Sales changed in the background (marked paid) while something was going on (a sale's page open, or an answer or
   * save in progress on the list): read again, with this note, the next time the list is shown. '' when not needed.
   */
  let reloadNote: string | null = null;
  /** The note last shown on the list, and whether "Usunięte wpisy" is open: kept when the list is drawn again. */
  let listNote: string | undefined;
  let deletedOpen = false;
  /** What Fakturownia said about Kraken's invoices this visit (by Fakturownia id): paid, and where each is with KSeF. */
  const invoiceStates = new Map<number, InvoiceState>();
  /** The open sale's page adds "Wystaw fakturę" when it learns the owner is signed in (set by showForm). */
  let roleKnown: (() => void) | null = null;

  const render = (...children: (Node | string)[]) => root.replaceChildren(...children);
  /**
   * Back and the menu wait while anything is being saved. Counted, so a note saved while the form is saved (or the
   * other way round) never unlocks them while the other is still writing.
   */
  let busyCount = 0;
  const appBusy = (on: boolean) => {
    busyCount += on ? 1 : -1;
    if (busyCount === (on ? 1 : 0)) deps.busy(on);
  };
  /** One save at a time on a sample's page: its form, or one of its follow-up notes. */
  let formSaving = false;
  let noteSaving = false;
  const today = () => localDate(deps.now());

  function errorNodes(error: unknown, retry: () => void, retryLabel: string, show: (e: unknown) => void, mayHaveSaved: boolean, reloadLabel = 'Odśwież sprzedaż'): Node[] {
    return googleErrorNodes(error, deps, {
      retry,
      retryLabel,
      show,
      ...(mayHaveSaved ? {} : { signedOutNote: 'Nic nie zostało utracone.' }),
      other: { label: mayHaveSaved ? reloadLabel : 'Spróbuj ponownie', action: () => load(undefined, true), mayHaveSaved },
    });
  }

  function load(note?: string, fromClick = false): void {
    render(el('p', {}, busy('Wczytuję sprzedaż…')));
    // The prices need Special prices and Packaging & discounts; if those cannot be read the list still shows (Sales
    // is the start screen), only sales cannot be saved until they load.
    const pricing = () =>
      Promise.all([deps.prices.load(), deps.costs.load()]).then(
        ([d, costs]) => ({ d, costs, error: '' }),
        (error: unknown) => {
          if (deps.isSignedOut(error) || deps.isIgnorable(error)) throw error;
          return { d: null, costs: null, error: deps.describeError(error) };
        },
      );
    const all = () => Promise.all([deps.repo.load(), deps.clients.load(), deps.products.load(), deps.notes.load(), pricing()]);
    (fromClick ? deps.withGoogle(all) : all())
      .then(([s, c, p, n, priced]) => {
        if (!root.isConnected) return;
        sales = s.sales;
        lines = s.lines;
        sampleNotes = n.notes;
        clients = c.clients;
        products = p.products;
        const settings = priced.costs ? readSettings(priced.costs.settings) : null;
        deals = priced.d?.deals ?? [];
        vatTenths = settings?.settings.vatTenths ?? vatTenths;
        discounts = priced.costs ? activeDiscounts(priced.costs.discounts).discounts : [];
        pricesUnavailable = priced.error ? `Nie udało się wczytać cen (${priced.error}), więc sprzedaży nie da się teraz zapisać. Odśwież stronę.` : '';
        const active = s.sales.filter((x) => !isDeleted(x));
        const activeIds = new Set(active.map((x) => x.id));
        problems = [
          ...s.problems,
          ...c.problems,
          ...p.problems,
          ...n.problems,
          // Only what changes a sale's price; problems of special prices and discounts show on their own pages.
          ...(settings?.problems ?? []),
          ...(pricesUnavailable ? [pricesUnavailable] : []),
          ...active.flatMap((x) => x.problems),
          ...s.lines.filter((l) => l.deletedAt === '' && activeIds.has(l.saleId)).flatMap((l) => l.problems),
          ...lineSizeProblems(active, s.lines),
        ];
        showList(note);
        if (!fakturowniaAsked) {
          fakturowniaAsked = true;
          void askFakturownia();
        }
      })
      .catch((error: unknown) => {
        if (!root.isConnected || deps.isIgnorable(error)) return;
        const show = (e: unknown) => render(...errorNodes(e, () => load(), 'Zaloguj się i pokaż sprzedaż', show, false));
        show(error);
      });
  }

  /**
   * In the background, once per visit (owner, 2026-11-28): who is signed in (so only the owner sees "Wystaw fakturę"),
   * and which invoices Kraken issued are now paid in Fakturownia; those sales become "Opłacona". If Fakturownia cannot
   * be reached nothing is shown or changed: it is tried again the next time Sales opens.
   */
  async function askFakturownia(): Promise<void> {
    if (!(await learnRole())) return;
    const chunks = invoiceIdsToAsk(sales, today());
    if (chunks.length === 0) return;
    let written = 0;
    const listIdle = () => onList && root.isConnected && busyCount === 0 && root.querySelector('.sales-table tr.confirm-row:not([hidden])') === null;
    try {
      // One batch after another (the middleman asks Fakturownia four at a time), gentle on Fakturownia.
      const states: InvoiceState[] = [];
      for (const ids of chunks) states.push(...(await deps.fakturownia.readInvoices(ids)));
      for (const s of states) invoiceStates.set(s.id, s);
      const updates = paidUpdates(sales, states);
      if (updates.length === 0) {
        // Only the KSeF states are new: shown at once (with the same note) if the list is idle on screen.
        if (listIdle()) showList(listNote);
        return;
      }
      appBusy(true);
      try {
        for (const u of updates) {
          await deps.repo.update(u.sale, u.fields, deps.now());
          written += 1;
        }
      } finally {
        appBusy(false);
      }
    } catch {
      // The rest is tried again the next time Sales opens.
    }
    if (!root.isConnected) return;
    if (written === 0) {
      // Nothing written (a write failed): the KSeF states that did arrive are still shown.
      if (invoiceStates.size > 0 && listIdle()) showList(listNote);
      return;
    }
    // What was written is shown (also after a failure partway), without breaking off anything going on on the list.
    const note = `Fakturownia: ${count(written, 'sprzedaż opłacona', 'sprzedaże opłacone', 'sprzedaży opłaconych')} (zmieniono na „Opłacona”).`;
    const listBusy = busyCount > 0 || root.querySelector('.sales-table tr.confirm-row:not([hidden])') !== null;
    if (onList && !listBusy) load(note);
    else reloadNote = note;
  }

  /**
   * Who is signed in, for Fakturownia (only the owner issues). Asked again after a failure, at the next opening of a
   * sale. True when known.
   */
  let asking: Promise<boolean> | null = null;
  function learnRole(): Promise<boolean> {
    if (role !== null) return Promise.resolve(true);
    asking ??= deps.fakturownia.whoAmI().then(
      (r) => {
        role = r;
        roleKnown?.();
        return true;
      },
      () => {
        asking = null; // try again later
        return false;
      },
    );
    return asking;
  }

  function lockPage(): void {
    for (const node of root.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('button, input, select, textarea')) node.disabled = true;
  }

  /** Writes something about one entry from the list (status, delete, restore), inside the click; reloads after. */
  function act(slot: HTMLElement, working: string, action: () => Promise<void>, done: string, afterSave?: () => void): void {
    lockPage();
    slot.replaceChildren(busy(working));
    appBusy(true);
    deps
      .withGoogle(action)
      .finally(() => appBusy(false))
      .then(() => {
        afterSave?.();
        if (root.isConnected) load(done);
      })
      .catch((error: unknown) => {
        if (!root.isConnected) return;
        if (deps.isIgnorable(error)) return showList();
        const show = (e: unknown) => showList(undefined, errorNodes(e, () => act(slot, working, action, done, afterSave), 'Zaloguj się i spróbuj ponownie', show, true));
        show(error);
      });
  }

  /** Where a sale's invoice is with KSeF, when Fakturownia said so this visit. */
  const ksefOf = (sale: Sale) => {
    const state = sale.fakturowniaId === null ? undefined : invoiceStates.get(sale.fakturowniaId);
    return state ? ksefState(state.ksefStatus) : null;
  };
  /** A small mark after the invoice date in the list: "w KSeF", or "nie wysłana do KSeF" (and errors) in yellow. */
  const ksefBadge = (sale: Sale): (Node | string)[] => {
    const k = ksefOf(sale);
    if (!k) return [];
    return [' ', el('span', { class: `badge ${k.warn ? 'badge-warn' : 'badge-muted'}` }, k.kind === 'sent' ? 'KSeF ✓' : k.text)];
  };
  const findClient = (id: string) => clients.find((c) => c.id === id);
  const clientName = (id: string) => findClient(id)?.name;
  const productName = (id: string) => products.find((p) => p.id === id)?.name;
  const discountName = (tenths: number) => discounts.find((d) => d.tenths === tenths)?.name ?? '';
  /** The client as the Clients tab has it now (so a change there shows on the entry's page). */
  const clientInfo = (id: string): ClientInfo | undefined => {
    const c = findClient(id);
    return c && { name: c.name, registeredName: c.registeredName, deleted: isClientDeleted(c) };
  };

  // ---- The list ----

  function showList(note?: string, error?: Node[]): void {
    if (reloadNote !== null && !error) {
      const deferred = reloadNote;
      reloadNote = null;
      return load([note, deferred].filter((t) => t).join(' '));
    }
    onList = true;
    listNote = note;
    deps.formClosed();
    const { rows, counts } = saleRows(sales, lines, filter, clientName, productName);
    const newestNotes = lastNotes(sampleNotes);
    const deleted = sales.filter(isDeleted);

    const chip = (f: SalesFilter, label: string) => {
      const b = button(`${label} (${counts[f]})`, () => ((filter = f), showList()), 'link');
      if (f === filter) b.setAttribute('aria-current', 'true');
      return b;
    };

    const row = (r: SaleRow) => {
      const actions = el('td', { class: 'row-actions nowrap c-actions' });
      const extra = el('tr', { class: 'confirm-row', hidden: '' });
      const sale = r.sale;
      const inline = (...children: (Node | string)[]) => {
        extra.replaceChildren(el('td', { colspan: '9' }, ...children));
        extra.hidden = false;
      };
      /** Puts the status dropdown back to the stored status (a date box closed without saving). */
      let resetStatus = () => {};
      const normal = () => {
        extra.hidden = true;
        resetStatus();
        actions.replaceChildren(button('Usuń', ask, 'link'));
      };
      /** The invoice status as a dropdown: any status to any other; after saving the list shows all entries. */
      const statusCell = el('td', { class: `nowrap no-row-click c-status${sale.kind === 'sale' ? '' : ' c-empty'}` });
      if (sale.kind !== 'sale') statusCell.append(el('span', { class: 'muted' }, '—'));
      else {
        const select = el('select', { class: `status-select status-${sale.status ?? ''}`, 'aria-label': `Stan faktury: ${r.who}` });
        if (sale.status === null) select.append(el('option', { value: '', selected: '' }, '? (nie da się odczytać)'));
        for (const [value, label] of Object.entries(STATUS_LABELS)) {
          const option = el('option', { value }, label);
          option.selected = value === sale.status;
          select.append(option);
        }
        const save = (to: InvoiceStatus, date: string, errorLine?: HTMLElement) => {
          const change = statusChange(sale, to, date);
          if (!change.ok) {
            if (errorLine) errorLine.textContent = change.error;
            return;
          }
          act(statusCell, 'Zapisuję…', () => deps.repo.update(sale, change.fields, deps.now()), `${r.who}: ${STATUS_LABELS[to].toLowerCase()}.`, () => (filter = 'all'));
        };
        resetStatus = () => (select.value = sale.status ?? '');
        const cancel = normal;
        select.addEventListener('change', () => {
          const to = select.value as InvoiceStatus;
          if (!needsInvoiceDate(sale, to)) return save(to, '');
          // A small date box under the row: when the invoice was issued (the date it already has, or today).
          const label = 'Faktura wystawiona dnia';
          const date = el('input', { type: 'date', class: 'input-short', 'aria-label': label });
          date.value = suggestedInvoiceDate(sale, today());
          const errorLine = el('span', { class: 'field-error', role: 'alert' });
          const form = el(
            'form',
            { class: 'inline-form', novalidate: '' },
            el('span', {}, label),
            date,
            el('button', { type: 'submit', class: 'btn btn-primary' }, 'Zapisz'),
            button('Anuluj', cancel, 'secondary'),
            errorLine,
          );
          form.addEventListener('submit', (event) => {
            event.preventDefault();
            save(to, date.value, errorLine);
          });
          inline(form);
          date.focus();
        });
        statusCell.append(select);
      }
      const ask = () => {
        const no = button('Nie', normal, 'secondary');
        inline(
          el('span', {}, `Usunąć ten wpis (${r.kindLabel.toLowerCase()}, ${r.date})? Można go później przywrócić. `),
          button('Tak, usuń', () => act(actions, 'Usuwam…', () => deps.repo.remove(sale, deps.now()), 'Usunięto. Można to przywrócić w „Usunięte wpisy”.'), 'primary'),
          ' ',
          no,
        );
        no.focus();
      };
      normal();
      return [
        clickableRow(
          el(
          'tr',
          {},
          el('td', { class: 'nowrap c-date' }, r.date),
          el('td', { class: 'nowrap c-kind' }, el('span', { class: `badge kind-${r.kind ?? 'unknown'}` }, r.kindLabel)),
          el(
            'td',
            { class: 'c-who' },
            r.who || el('span', { class: 'muted' }, '—'),
            ...(sale.kind === 'sample' && newestNotes.has(sale.id) ? [el('span', { class: 'last-note' }, newestNotes.get(sale.id) ?? '')] : []),
          ),
          el('td', { class: 'c-items' }, r.items),
          el('td', { class: 'num nowrap c-bags' }, r.bags || el('span', { class: 'muted' }, '—')),
          el('td', { class: `num nowrap c-net${r.net ? '' : ' c-empty'}` }, r.net || el('span', { class: 'muted' }, '—')),
          statusCell,
          el(
            'td',
            { class: `nowrap c-issued${r.invoiceDate ? '' : ' c-empty'}`, 'data-label': 'Wystawiona' },
            r.invoiceDate || el('span', { class: 'muted' }, '—'),
            ...ksefBadge(sale),
          ),
          actions,
        ),
          () => showForm(sale),
          `Otwórz: ${r.kindLabel.toLowerCase()}, ${r.date}${r.who ? ` (${r.who})` : ''}`,
          { asking: () => !extra.hidden },
        ),
        extra,
      ];
    };

    render(
      el(
        'div',
        { class: 'page-head sales-head' },
        el('h2', {}, 'Sprzedaż'),
        el('div', { class: 'head-actions' }, button('Dodaj', () => showForm(null))),
        // On a phone: always at hand in the corner, also after scrolling (owner, 2026-11-20: used at the cafés).
        (() => {
          const fab = button('+ Dodaj', () => showForm(null));
          fab.classList.add('fab-add');
          fab.title = 'Dodaj sprzedaż, próbkę albo wydanie na własny użytek';
          return fab;
        })(),
      ),
      el('p', { class: 'muted small' }, 'Co wyszło: sprzedaż klientom (z fakturą do wystawienia), zostawione próbki i torebki wzięte na własny użytek. ', infoTip('Sprzedaż zaczyna jako „Faktura do wystawienia”. Gdy faktura jest wystawiona w Fakturowni, wybierz „Faktura wystawiona” w kolumnie Faktura; gdy zostanie opłacona, wybierz „Opłacona”. Wybór „Faktura wystawiona” pyta o datę wystawienia (dziś, chyba że ją zmienisz); widać ją w kolumnie „Wystawiona”. Pomyłkę cofniesz tak samo. Próbki i wydania na własny użytek nie mają faktury.')),
      ...(note ? [message(note)] : []),
      ...(error ?? []),
      ...problems.map((text) => message(text, 'error')),
      ...(() => {
        // At a glance (owner, 2026-11-28): invoices Kraken issued that are not in KSeF yet (the owner sends them in Fakturownia).
        const waiting = ksefWaiting(sales, invoiceStates);
        return waiting.length === 0
          ? []
          : [
              el(
                'p',
                { class: 'message message-error', role: 'status' },
                `${count(waiting.length, 'faktura nie jest', 'faktury nie są', 'faktur nie jest')} jeszcze w KSeF: wyślij ${waiting.length === 1 ? 'ją' : 'je'} w Fakturowni („Wyślij do KSeF”). `,
                ...(filter === 'all' ? [] : [button('Pokaż', () => ((filter = 'all'), showList()), 'link')]),
              ),
            ];
      })(),
      el('p', { class: 'compare-sizes sales-filters small' }, ...FILTERS.flatMap(({ filter: f, label }) => [chip(f, label), ' '])),
      rows.length === 0
        ? el('p', { class: 'muted' }, filter === 'to_issue' ? 'Brak faktur do wystawienia.' : 'Na razie nic tu nie ma.')
        : el(
            'div',
            { class: 'table-wrap' },
            el(
              'table',
              { class: 'data-table sales-table' },
              el('thead', {}, el('tr', {}, ...['Data', 'Rodzaj', 'Klient / miejsce', 'Produkty', 'Ilość', 'Netto', 'Faktura', 'Wystawiona', ''].map((h) => el('th', { scope: 'col' }, h)))),
              el('tbody', {}, ...rows.flatMap(row)),
            ),
          ),
      ...(deleted.length > 0 ? [deletedList(deleted)] : []),
    );
  }

  function deletedList(deleted: readonly Sale[]): HTMLElement {
    const box = el(
      'details',
      { class: 'small deleted-products', ...(deletedOpen ? { open: '' } : {}) },
      el('summary', {}, `Usunięte wpisy (${deleted.length})`),
      el(
        'ul',
        {},
        ...deleted.map((s) => {
          const slot = el('span', {});
          slot.append(button('Przywróć', () => act(slot, 'Przywracam…', () => deps.repo.restore(s, deps.now()), 'Przywrócono.'), 'link'));
          return el('li', {}, `${deletedEntryText(s, clientName)} `, slot);
        }),
      ),
    );
    box.addEventListener('toggle', () => (deletedOpen = box.open));
    return box;
  }

  // ---- The form ----

  function showForm(sale: Sale | null): void {
    onList = false;
    roleKnown = null;
    deps.formOpened();
    const existingLines = sale ? linesOf(lines, sale.id) : [];
    const form: SaleForm = sale ? formFromSale(sale, existingLines) : emptySaleForm(today());
    if (form.lines.length === 0) form.lines.push(emptyLine(form.kind));
    /** The form as saved: an invoice is issued only from a saved sale with nothing changed since. */
    const saved = JSON.stringify(form);
    const activeClients = sortClients(clients).filter((c) => !isClientDeleted(c));
    const activeProducts = sortProducts(products).filter((p) => !isProductDeleted(p));

    const errorBox = el('div', {});
    const banner = el('div', { class: 'form-banner' });

    // Who: a sale needs a client; a sample a client or a place; own use nothing (no reason asked, owner 2026-11-21).
    const kindHolder = el('div', { class: 'kind-choice', role: 'radiogroup', 'aria-label': 'Rodzaj wpisu' });
    const whoHolder = el('div', { class: 'fields' });
    const linesHolder = el('div', {});
    const totalLine = el('p', { class: 'sale-total' });
    const pricesBox = el('fieldset', { class: 'form-section' });
    /** The saved sale, for prices that stay once its invoice is issued. */
    const storedPrices = sale ? { sale, lines: existingLines } : null;
    /** The form's lines and their prices now (what saving will store). */
    const priced = () => {
      const toPrice = linesToPrice(form.lines, form.kind);
      return { toPrice, pricing: priceEntry(form.kind, toPrice, pricingDataFrom({ products, deals, discounts, vatTenths }, form.clientId), storedPrices) };
    };
    /** A sale's prices, live (owner, 2026-11-27): what saving will store. Samples and own use have none. */
    const renderPrices = () => {
      pricesBox.hidden = form.kind !== 'sale';
      if (pricesBox.hidden) return;
      // Without special prices and discounts any price shown would be wrong: say why instead.
      if (pricesUnavailable) return void pricesBox.replaceChildren(el('legend', {}, 'Ceny'), message(pricesUnavailable, 'error'));
      const now = priced();
      const view = priceView(now.toPrice, now.pricing, productName, discountName, vatTenths);
      pricesBox.replaceChildren(
        el('legend', {}, 'Ceny '),
        el('p', { class: 'muted small' }, view.summary, ' ', infoTip('Cena specjalna klienta (zakładka Klienci), jeśli ją ma; inaczej cena hurtowa: główna cena bez VAT minus rabat za wagę kawy na fakturze (Opakowania i rabaty), zaokrąglona do pełnych złotych. Ceny zapisują się z tą sprzedażą; dopóki faktura nie jest wystawiona, każde zapisanie liczy je od nowa. Po wystawieniu faktury zapisane ceny zostają.')),
        el(
          'div',
          { class: 'table-wrap' },
          cardTable(el(
            'table',
            { class: 'data-table sale-prices' },
            el('thead', {}, el('tr', {}, ...['Produkt', 'Torebki', 'Cena wyjściowa (netto / brutto)', 'Rabat', 'Cena dla klienta (netto / brutto)'].map((h, i) => el('th', { scope: 'col', ...(i === 1 || i === 2 || i === 4 ? { class: 'num' } : {}) }, h)))),
            el(
              'tbody',
              {},
              ...view.rows.map((r) =>
                el(
                  'tr',
                  {},
                  el('td', {}, r.item),
                  el('td', { class: 'num' }, r.bags),
                  // One bag: the starting price, the discount (or special price, or why there is no price), the client's price.
                  el('td', { class: 'num nowrap muted' }, r.base || '—'),
                  el('td', { class: r.missing ? 'field-error' : '' }, r.why),
                  el('td', { class: 'num nowrap' }, r.price ? el('strong', {}, r.price) : el('span', { class: 'muted' }, '—')),
                ),
              ),
            ),
          )),
        ),
        el('p', { class: 'sale-total' }, 'Razem netto: ', el('strong', {}, view.total), ' · brutto: ', el('strong', {}, view.totalGross), ` (VAT ${formatPercent(vatTenths)})`),
      );
    };

    const date = el('input', { id: 'sale-date', type: 'date' });
    date.value = form.date;
    date.addEventListener('input', () => (form.date = date.value));
    const notes = el('textarea', { id: 'sale-notes', rows: '2' });
    notes.value = form.notes;
    notes.addEventListener('input', () => (form.notes = notes.value));

    let notesBox: HTMLElement | null = null;
    const renderKind = () => {
      if (notesBox) notesBox.hidden = form.kind !== 'sample';
      kindHolder.replaceChildren(
        ...(['sale', 'sample', 'own_use'] as SaleKind[]).map((k) => {
          const b = button(KIND_LABELS[k], () => {
            if (!sale) form.lines = linesForKind(form.lines, form.kind, k); // a new entry: 250 g ↔ 150 g for a sample
            form.kind = k;
            renderKind();
            renderWho();
            renderLines();
          }, 'secondary');
          b.setAttribute('role', 'radio');
          b.setAttribute('aria-checked', String(form.kind === k));
          if (form.kind === k) b.classList.add('chosen');
          return b;
        }),
      );
    };

    // The box at the top: the entry's dates, and the client chosen in the form as Clients has it now (so it always
    // matches the form, also before saving a change of client).
    const factsBox = el('dl', { class: 'product-details sale-facts' });
    const renderFacts = () => {
      const facts = [...(sale ? saleFacts(sale) : []), ...clientFacts(form.kind === 'own_use' ? '' : form.clientId, clientInfo(form.clientId))];
      factsBox.replaceChildren(...facts.flatMap((f) => [el('dt', {}, f.label), el('dd', {}, f.value)]));
      factsBox.hidden = facts.length === 0;
    };

    const whoLegend = el('legend', {});
    const renderWho = () => {
      renderFacts();
      whoLegend.textContent = form.kind === 'own_use' ? 'Kiedy' : 'Kiedy i kto'; // own use asks only the date
      const fields: Node[] = [];
      if (form.kind !== 'own_use') {
        const select = el('select', { id: 'sale-client' });
        select.append(el('option', { value: '' }, form.kind === 'sale' ? 'Wybierz klienta…' : 'Nie klient (wpisz miejsce)'));
        for (const c of activeClients) select.append(el('option', { value: c.id }, c.name));
        if (form.clientId && !activeClients.some((c) => c.id === form.clientId)) select.append(el('option', { value: form.clientId }, `${clientName(form.clientId) ?? '?'} (usunięty)`));
        select.value = form.clientId;
        select.addEventListener('change', () => {
          form.clientId = select.value;
          renderWho();
          renderPrices(); // special prices are the client's
        });
        fields.push(
          el(
            'div',
            { class: 'field' },
            el('div', { class: 'label-row' }, el('label', { for: select.id }, form.kind === 'sale' ? 'Klient *' : 'Klient')),
            select,
          ),
        );
      }
      if (form.kind === 'sample' && form.clientId === '') {
        const place = el('input', { id: 'sale-place', type: 'text', autocomplete: 'off', placeholder: 'np. Café Nowa, Kazimierz' });
        place.value = form.place;
        place.addEventListener('input', () => (form.place = place.value));
        fields.push(el('div', { class: 'field' }, el('div', { class: 'label-row' }, el('label', { for: place.id }, 'Gdzie została? *')), place));
      }
      whoHolder.replaceChildren(el('div', { class: 'field' }, el('div', { class: 'label-row' }, el('label', { for: date.id }, `${DATE_LABELS[form.kind]} *`)), date), ...fields);
    };

    const showTotal = () => {
      const text = bagsText(form.lines.map((l) => ({ bags: typedBags(l.bags), free: l.free })), form.kind);
      totalLine.replaceChildren(...(text ? ['Razem: ', el('strong', {}, text)] : []));
      renderPrices();
    };

    /** A sample's size: 100, 150 or 250 g, or "Inna" with any amount typed in (owner, 2026-11-24). */
    const sampleSize = (line: LineForm, i: number): Node[] => {
      const other = !isSampleSize(line.grams);
      const choice = el('select', { 'aria-label': `Pozycja ${i + 1}: gramatura` }, ...SAMPLE_SIZES_G.map((g) => el('option', { value: String(g) }, formatBagSize(g))), el('option', { value: 'other' }, 'Inna…'));
      choice.value = other ? 'other' : String(Number(line.grams));
      const amount = el('input', { type: 'text', inputmode: 'numeric', class: 'input-xs', 'aria-label': `Pozycja ${i + 1}: gramy`, autocomplete: 'off' });
      amount.value = line.grams;
      const typed = el('span', { class: 'nowrap' }, ' ', amount, ' g');
      typed.hidden = !other;
      choice.addEventListener('change', () => {
        const isOther = choice.value === 'other';
        typed.hidden = !isOther;
        // "Inna…" starts from the amount chosen so far (nothing is lost before a new one is typed).
        if (isOther) amount.focus();
        else amount.value = line.grams = choice.value;
      });
      amount.addEventListener('input', () => (line.grams = amount.value.trim()));
      return [choice, typed];
    };

    const renderLines = () => {
      const sale_ = form.kind === 'sale'; // free bags only matter for a sale (not invoiced)
      const sample = form.kind === 'sample';
      const rows = form.lines.map((line, i) => {
        const product = el('select', { 'aria-label': `Pozycja ${i + 1}: produkt` });
        product.append(el('option', { value: '' }, 'Wybierz produkt…'));
        for (const p of activeProducts) product.append(el('option', { value: p.id }, p.name));
        if (line.productId && !activeProducts.some((p) => p.id === line.productId)) product.append(el('option', { value: line.productId }, `${productName(line.productId) ?? '?'} (usunięty)`));
        product.value = line.productId;
        // A sale or own use is one of the bag sizes; a sample has its own sizes or any amount (sampleSize).
        const bagSize = () => {
          const size = el('select', { 'aria-label': `Pozycja ${i + 1}: wielkość torebki` }, ...BAG_SIZES_G.map((g) => el('option', { value: String(g) }, formatBagSize(g))));
          size.value = line.grams;
          size.addEventListener('change', () => {
            line.grams = size.value;
            showTotal();
          });
          return [size];
        };
        const bags = el('input', { type: 'text', inputmode: 'numeric', class: 'input-xs', 'aria-label': `Pozycja ${i + 1}: ${sample ? 'liczba opakowań' : 'liczba torebek'}`, autocomplete: 'off' });
        bags.value = line.bags;
        const free = el('input', { type: 'checkbox', 'aria-label': `Pozycja ${i + 1}: gratis` });
        free.checked = line.free;
        product.addEventListener('change', () => {
          line.productId = product.value;
          showTotal();
        });
        bags.addEventListener('input', () => {
          line.bags = bags.value;
          showTotal();
        });
        free.addEventListener('change', () => {
          line.free = free.checked;
          showTotal();
        });
        const remove = button(
          'Usuń',
          () => {
            form.lines.splice(i, 1);
            renderLines();
          },
          'link',
        );
        return el(
          'tr',
          {},
          el('td', { class: 'l-product' }, product),
          el('td', { class: 'nowrap l-size', 'data-label': sample ? 'Gramatura' : 'Wielkość' }, ...(sample ? sampleSize(line, i) : bagSize())),
          el('td', { class: 'l-bags', 'data-label': sample ? 'Opakowania' : 'Torebki' }, bags),
          ...(sale_ ? [el('td', { class: 'nowrap l-free' }, el('label', { class: 'free-label' }, free, ' gratis'))] : []),
          el('td', { class: 'l-remove' }, form.lines.length > 1 ? remove : ''),
        );
      });
      linesHolder.replaceChildren(
        el(
          'div',
          { class: 'table-wrap' },
          el(
            'table',
            { class: 'data-table sale-lines' },
            el(
              'thead',
              {},
              el(
                'tr',
                {},
                el('th', { scope: 'col' }, 'Produkt'),
                el('th', { scope: 'col' }, sample ? 'Gramatura ' : 'Wielkość', ...(sample ? [infoTip('Próbka ma zwykle 100, 150 albo 250 g; inną ilość wpiszesz po wybraniu „Inna…”. Sprzedaż i wydania na własny użytek są w standardowych torebkach.')] : [])),
                el('th', { scope: 'col' }, sample ? 'Opakowania' : 'Torebki'),
                ...(sale_
                  ? [el('th', { scope: 'col' }, 'Gratis ', infoTip('Zaznacz dla torebek wydanych gratis: nie trafiają na fakturę.'))]
                  : []),
                el('th', { scope: 'col' }, ''),
              ),
            ),
            el('tbody', {}, ...rows),
          ),
        ),
        button(
          'Dodaj kolejny produkt',
          () => {
            form.lines.push(emptyLine(form.kind));
            renderLines();
          },
          'secondary',
        ),
      );
      showTotal();
    };

    const label = sale ? 'Zapisz zmiany' : 'Zapisz';
    const saveButton = el('button', { type: 'submit', class: 'btn btn-primary' }, label);
    const cancelButton = button('Anuluj', () => showList(), 'secondary');
    const setBusy = (working: boolean) => {
      saveButton.disabled = working;
      cancelButton.disabled = working;
      saveButton.replaceChildren(working ? busy('Zapisuję…') : label);
    };
    /** The entry once saved: if the lines then fail, a retry saves only the lines (never a second entry). */
    let savedId: string | null = null;

    function save(): void {
      if (noteSaving) {
        banner.replaceChildren(message('Chwila: zapisuje się notatka.', 'error'));
        return;
      }
      const { clientIds, productIds } = choosableIds(
        clients.filter((c) => !isClientDeleted(c)).map((c) => c.id),
        products.filter((p) => !isProductDeleted(p)).map((p) => p.id),
        sale,
        existingLines,
      );
      const result = validateSale(form, clientIds, productIds);
      if (!result.ok) {
        const e = result.errors;
        errorBox.replaceChildren(...[e.date, e.client, e.place, e.notes, e.lines, ...e.line].filter((t): t is string => !!t).map((t) => message(t, 'error')));
        banner.replaceChildren(message('Popraw to, co jest wymienione poniżej.', 'error'));
        return;
      }
      errorBox.replaceChildren();
      banner.replaceChildren();
      if (form.kind === 'sale' && pricesUnavailable) {
        banner.replaceChildren(message(pricesUnavailable, 'error'));
        return;
      }
      // The prices are worked out now and saved with the sale (owner, 2026-11-27); samples and own use get none.
      const cells = priceCells(priced().pricing);
      const fields = { ...result.fields, ...cells.sale };
      const wantedLines = result.lines.map((l, i) => ({ ...l, ...cells.lines[i] }));
      setBusy(true);
      appBusy(true);
      formSaving = true;
      deps
        .withGoogle(async () => {
          let email: string | null = null;
          const by = async () => (email ??= await deps.whoAmI());
          if (savedId === null) {
            if (sale) {
              const changes = changedSaleFields(sale, saleEditFields(sale, form.kind, fields));
              if (Object.keys(changes).length > 0) await deps.repo.update(sale, changes, deps.now());
              savedId = sale.id;
              await deps.repo.saveLines(sale.id, wantedLines, existingLines, by, deps.now());
            } else {
              // The sale first, then its lines: if the lines fail, a retry saves only them (never a second sale).
              savedId = await deps.repo.add({ ...fields, ...startingInvoice(form.kind) }, await by(), deps.now());
              await deps.repo.saveLines(savedId, wantedLines, [], by, deps.now());
            }
            return;
          }
          // A retry after the entry was saved: read again and write only what still differs.
          const fresh = await deps.repo.load();
          const stored = fresh.sales.find((s) => s.id === savedId);
          if (stored) {
            const changes = changedSaleFields(stored, fields);
            if (Object.keys(changes).length > 0) await deps.repo.update(stored, changes, deps.now());
          }
          await deps.repo.saveLines(savedId, wantedLines, linesOf(fresh.lines, savedId), by, deps.now());
        })
        .finally(() => {
          appBusy(false);
          formSaving = false;
        })
        .then(() => {
          // A sample or own use has no invoice: show all entries so it stays in view (Sales opens on invoices to issue).
          if (form.kind !== 'sale') filter = 'all';
          if (root.isConnected) load('Zapisano.');
        })
        .catch((error: unknown) => {
          setBusy(false);
          if (deps.isIgnorable(error)) return;
          const show = (e: unknown) => {
            banner.replaceChildren(...errorNodes(e, save, 'Zaloguj się i zapisz', show, true, 'Odśwież sprzedaż (bez tego formularza)'));
            banner.scrollIntoView({ block: 'nearest' });
          };
          show(error);
        });
    }

    const formNode = el(
      'form',
      { class: 'lot-form', novalidate: '' },
      el('fieldset', { class: 'form-section' }, el('legend', {}, 'Co to było?'), kindHolder),
      el('fieldset', { class: 'form-section' }, whoLegend, whoHolder),
      el('fieldset', { class: 'form-section' }, el('legend', {}, 'Produkty'), linesHolder, totalLine),
      pricesBox,
      el('fieldset', { class: 'form-section' }, el('legend', {}, 'Uwagi'), el('div', { class: 'field field-wide' }, el('label', { for: notes.id, class: 'visually-hidden' }, 'Uwagi'), notes)),
      errorBox,
      el('div', { class: 'actions' }, saveButton, cancelButton),
    );
    formNode.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!saveButton.disabled) save();
    });

    // Follow-up notes: for a saved entry while it is a sample (switching the form to a sale hides them).
    notesBox = sale
      ? notesSection(sale.id, sampleNotes, {
          ...deps,
          busy: appBusy,
          today,
          changed: (stored) => (sampleNotes = stored),
          saving: (on) => (noteSaving = on),
          canSave: () => !formSaving,
          errorNodes: (error, retry, label, show) => errorNodes(error, retry, label, show, true, 'Odśwież sprzedaż (bez tego formularza)'),
        })
      : null;
    // "Wystaw fakturę" for the owner: shown now if Kraken already knows who is signed in, else as soon as it does.
    const invoiceSlot = el('div', {});
    const showInvoiceBox = () => {
      if (sale && role === 'owner' && sale.kind === 'sale' && sale.status === 'to_issue' && sale.fakturowniaId === null && invoiceSlot.childElementCount === 0) {
        invoiceSlot.append(invoiceBox(sale, existingLines, () => JSON.stringify(form) === saved));
      }
    };
    roleKnown = showInvoiceBox;
    renderKind();
    renderWho();
    renderLines();
    showInvoiceBox();
    if (sale && role === null) void learnRole();
    render(
      el('p', { class: 'small back-link' }, button('← Cała sprzedaż', () => showList(), 'link')),
      el('h2', {}, sale ? `${sale.kind ? HEADING_LABELS[sale.kind] : 'Wpis'} z ${formatDate(sale.date)}` : 'Dodaj sprzedaż, próbkę albo wydanie na własny użytek'),
      factsBox,
      ...(sale?.fakturowniaUrl
        ? [
            el(
              'p',
              {},
              'Faktura ',
              el('strong', {}, sale.source['invoice_number'] ?? ''),
              ' w Fakturowni: ',
              el('a', { href: sale.fakturowniaUrl, target: '_blank', rel: 'noopener noreferrer' }, 'otwórz'),
              ' ',
              infoTip('Strona faktury w Fakturowni. PDF jest dostępny, gdy faktura ma już numer KSeF (wyślij ją do KSeF w Fakturowni).'),
              ...(() => {
                const k = ksefOf(sale);
                const number = sale.fakturowniaId === null ? null : invoiceStates.get(sale.fakturowniaId)?.ksefNumber;
                return k ? [' · KSeF: ', el('span', { class: k.warn ? 'badge badge-warn' : '' }, k.text), ...(k.kind === 'sent' && number ? [el('span', { class: 'muted small' }, ` (nr ${number})`)] : [])] : [];
              })(),
            ),
          ]
        : []),
      invoiceSlot,
      ...(sale?.kind === 'sale' && sale.status !== 'to_issue' ? [message('Faktura za tę sprzedaż jest już wystawiona: jeśli zmienisz produkty, popraw też fakturę w Fakturowni.', 'error')] : []),
      banner,
      formNode,
      ...(notesBox ? [notesBox] : []),
    );
  }

  // ---- Issuing the invoice in Fakturownia (owner only, 2026-11-28) ----

  /**
   * "Wystaw fakturę w Fakturowni…" on a saved sale to be invoiced: first a check screen with exactly what will be sent;
   * only "Wystaw fakturę" there creates it. `unchanged`: the form still is as saved.
   */
  function invoiceBox(sale: Sale, saleLines: readonly SaleLine[], unchanged: () => boolean): HTMLElement {
    const box = el('section', { class: 'product-card invoice-box' });
    const start = () => {
      const refuse = (...texts: string[]) => box.replaceChildren(...texts.map((t) => message(t, 'error')), startButton());
      if (pricesUnavailable) return refuse(pricesUnavailable);
      if (!unchanged()) return refuse('Najpierw zapisz zmiany (Zapisz), potem wystaw fakturę.');
      const priced = priceEntry('sale', linesToPrice(formFromSale(sale, saleLines).lines, 'sale'), pricingDataFrom({ products, deals, discounts, vatTenths }, sale.clientId), { sale, lines: saleLines });
      if (!pricesUpToDate(priced, sale, saleLines)) {
        return refuse('Ceny tej sprzedaży zmieniły się od zapisania (np. nowa cena produktu, cena specjalna albo rabat). Kliknij Zapisz, żeby je przeliczyć, a potem wystaw fakturę.');
      }
      const result = invoiceDraft(sale, saleLines, clients.find((c) => c.id === sale.clientId), productName, vatTenths, today());
      if (!result.ok) return refuse(...result.problems);
      lookUpClient(result.draft);
    };
    const startButton = () => button('Wystaw fakturę w Fakturowni…', start, 'secondary');
    const cancelButton = () => button('Anuluj', () => box.replaceChildren(startButton()), 'secondary');

    /** Talks to Fakturownia inside the click (sign-in renewed if needed), showing `working`; `retry` after an error. */
    const ask = <T,>(working: string, action: () => Promise<T>, done: (value: T) => void, retry: () => void, saving: boolean) => {
      box.replaceChildren(el('p', {}, busy(working)));
      if (saving) appBusy(true);
      deps
        .withGoogle(action)
        .finally(() => saving && appBusy(false))
        .then((value) => {
          if (root.isConnected) done(value);
        })
        .catch((error: unknown) => {
          if (!root.isConnected) return;
          if (deps.isIgnorable(error)) return box.replaceChildren(startButton());
          if (error instanceof InvoiceStopped) return box.replaceChildren(message(error.message, 'error'), startButton());
          const show = (e: unknown) => box.replaceChildren(...errorNodes(e, retry, 'Zaloguj się i spróbuj ponownie', show, saving, 'Odśwież sprzedaż'), cancelButton());
          show(error);
        });
    };

    /**
     * Step 1 (owner, 2026-11-28, option A): is the client in Fakturownia (by NIP)? Yes: straight to the invoice. No:
     * first "Dodaj klienta do Fakturowni", then the invoice. A card there without an e-mail stops it.
     */
    const lookUpClient = (draft: InvoiceDraft): void =>
      ask(
        'Sprawdzam klienta w Fakturowni…',
        async () => {
          const chosen = chooseClient(await deps.fakturownia.findClient(draft.buyer.nip));
          if (!chosen.ok) throw new InvoiceStopped(chosen.problem);
          return chosen.card;
        },
        (card) => (card === null ? addClient(draft) : check(draft, card.id, card)),
        () => lookUpClient(draft),
        false,
      );

    const addClient = (draft: InvoiceDraft): void => {
      const add = button(
        'Dodaj klienta do Fakturowni',
        () => ask('Dodaję klienta…', () => deps.fakturownia.createClient(draft.buyer), (id) => check(draft, id, null), () => addClient(draft), true),
        'primary',
      );
      box.replaceChildren(
        el('h3', {}, 'Nowy klient w Fakturowni'),
        el('p', {}, `W Fakturowni nie ma jeszcze klienta z NIP-em ${draft.buyer.nip}. Najpierw dodaj go z danymi z zakładki Klienci; potem zobaczysz fakturę.`),
        el(
          'dl',
          { class: 'product-details' },
          ...[
            ['Nazwa', draft.buyer.name],
            ['NIP', draft.buyer.nip],
            ['E-mail', draft.buyer.email],
            ['Termin płatności', '14 dni'],
            ['VAT', '23 %'],
          ].flatMap(([label, value]) => [el('dt', {}, label ?? ''), el('dd', {}, value ?? '')]),
        ),
        el('p', { class: 'muted small' }, 'Adres klienta uzupełnisz potem na jego karcie w Fakturowni.'),
        el('div', { class: 'actions' }, add, cancelButton()),
      );
      add.focus();
    };

    /**
     * Step 2: the invoice, for the client found in Fakturownia (`card`: the invoice uses that card's name and e-mail,
     * so those are shown) or just added from Klienci (`card` null).
     */
    const check = (draft: InvoiceDraft, clientId: number, card: { name: string; email: string } | null): void => {
      const status = el('div', {});
      const issue = button('Wystaw fakturę', () => send(draft, clientId, issue, cancel, status), 'primary');
      const cancel = cancelButton();
      const buyer = card ?? draft.buyer;
      const differs = card ? cardDiffers(card, draft.buyer) : '';
      box.replaceChildren(
        el('h3', {}, 'Sprawdź fakturę'),
        message(card ? `Klient jest już w Fakturowni (NIP ${draft.buyer.nip}) ✓` : `Dodano klienta ${draft.buyer.name} do Fakturowni ✓`),
        ...(differs ? [message(differs, 'error')] : []),
        el(
          'dl',
          { class: 'product-details' },
          ...[
            ['Nabywca', buyer.name],
            ['NIP', draft.buyer.nip],
            ['E-mail', buyer.email || '—'],
            ['Data sprzedaży', formatDate(draft.request.sellDate)],
            ['Data wystawienia', formatDate(draft.request.issueDate)],
            ['Płatność', `przelew, ${draft.request.paymentDays} dni`],
          ].flatMap(([label, value]) => [el('dt', {}, label ?? ''), el('dd', {}, value ?? '')]),
        ),
        el(
          'div',
          { class: 'table-wrap' },
          cardTable(
            el(
              'table',
              { class: 'data-table' },
              el('thead', {}, el('tr', {}, ...['Pozycja', 'Ilość', 'Cena netto', 'VAT', 'Wartość netto', 'Wartość brutto'].map((h, i) => el('th', { scope: 'col', ...(i > 0 ? { class: 'num' } : {}) }, h)))),
              el(
                'tbody',
                {},
                ...draft.request.positions.map((p, i) => {
                  const unit = parseMoney(p.priceNet);
                  const net = typeof unit === 'number' ? unit : 0;
                  return el(
                    'tr',
                    {},
                    el('td', {}, p.name),
                    el('td', { class: 'num' }, `${p.quantity} szt.`),
                    el('td', { class: 'num nowrap' }, formatWholePln(net)),
                    el('td', { class: 'num' }, `${p.tax} %`),
                    el('td', { class: 'num nowrap' }, formatWholePln(net * p.quantity)),
                    el('td', { class: 'num nowrap' }, formatPln(draft.lineGross[i] ?? 0)),
                  );
                }),
              ),
            ),
          ),
        ),
        el(
          'p',
          { class: 'sale-total' },
          'Razem netto: ',
          el('strong', {}, formatWholePln(draft.totalNet)),
          ' · brutto: ',
          el('strong', {}, formatPln(draft.totalGross)),
          ` (VAT ${draft.vatPercent} %)`,
        ),
        el(
          'p',
          { class: 'muted small' },
          'Faktura zostanie od razu wystawiona w Fakturowni, z numerem. Nie trafi do KSeF: wyślesz ją tam sam w Fakturowni („Wyślij do KSeF”), a do tego czasu możesz ją tam jeszcze poprawić albo usunąć.',
        ),
        el('div', { class: 'actions' }, issue, cancel),
        status,
      );
      issue.focus();
    };

    /** Creates the invoice (never twice: the sale's mark), then the sale is updated. */
    const send = (draft: InvoiceDraft, clientId: number, issue: HTMLButtonElement, cancel: HTMLButtonElement, status: HTMLElement) => {
      issue.disabled = true;
      cancel.disabled = true;
      status.replaceChildren(busy('Wystawiam fakturę…'));
      appBusy(true);
      deps
        .withGoogle(async (): Promise<IssuedInvoice> => {
          const f = deps.fakturownia;
          let invoice: IssuedInvoice;
          try {
            invoice = await f.createInvoice({ ...draft.request, clientId });
          } catch (error) {
            // Maybe it was made but the answer was lost (or this is a retry): then it is there with this sale's mark.
            const made = await f.findInvoice(sale.id).catch(() => null);
            if (!made) throw error;
            invoice = made;
          }
          await deps.repo.update(sale, issuedFields(invoice, draft.request.issueDate), deps.now()); // the date on the invoice
          return invoice;
        })
        .finally(() => appBusy(false))
        .then((invoice) => {
          filter = 'all'; // keep it in view
          if (root.isConnected) load(`Wystawiono fakturę ${invoice.number} w Fakturowni. Wyślij ją do KSeF w Fakturowni, gdy ją sprawdzisz.`);
        })
        .catch((error: unknown) => {
          issue.disabled = false;
          cancel.disabled = false;
          if (deps.isIgnorable(error)) return status.replaceChildren();
          const show = (e: unknown) => status.replaceChildren(...errorNodes(e, () => send(draft, clientId, issue, cancel, status), 'Zaloguj się i wystaw fakturę', show, true, 'Odśwież sprzedaż'));
          show(error);
        });
    };

    box.append(el('h3', {}, 'Faktura'), el('p', { class: 'muted small' }, 'Wystaw fakturę VAT w Fakturowni z cenami tej sprzedaży. Najpierw zobaczysz, co dokładnie zostanie wysłane.'), startButton());
    return box;
  }

  load(note, fromClick);
}

/** Issuing stopped on purpose before anything was created or saved (e.g. the client's card has no e-mail). */
class InvoiceStopped extends Error {}
