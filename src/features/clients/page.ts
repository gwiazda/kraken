// The Clients screen (owner, 2026-11-19): the list of clients, and the form to add or edit one. No discount per
// client (owner, 2026-11-27): it depends on each invoice's weight; a client's own prices are its special prices.
// Everything from outside comes through ClientsPageDeps (main.ts provides it).

import { busy, button, cardTable, clickableRow, el, infoTip, message } from '../../ui/dom';
import { googleErrorNodes } from '../../ui/googleErrors';
import type { CostsRepository } from '../costs';
import type { LotsRepository } from '../lots';
import type { ProductsRepository } from '../products';
import type { RoastsRepository } from '../roasts';
import { changedClientFields, emptyClientForm, formFromClient, formatNip, isDeleted, sortClients, validateClientForm, type Client, type ClientForm, type ClientFormErrors } from './model';
import { pricesSection } from './pricesSection';
import type { ClientsRepository } from './repo';
import type { SpecialPricesRepository } from './repoPrices';

export interface ClientsPageDeps {
  repo: ClientsRepository;
  /** With the next three: what a bag costs and the wholesale discounts, for the special prices. */
  costs: CostsRepository;
  /** A client's special prices (owner, 2026-11-20). */
  prices: SpecialPricesRepository;
  products: ProductsRepository;
  lots: LotsRepository;
  roasts: RoastsRepository;
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

const FIELDS: readonly { key: keyof ClientForm; label: string; hint?: string; tip?: string; required?: boolean }[] = [
  { key: 'name', label: 'Nazwa', hint: 'Nazwa, której używasz, np. Café Nowa.', required: true },
  { key: 'registeredName', label: 'Nazwa w CEIDG', hint: 'Oficjalna nazwa, do faktury.' },
  { key: 'nip', label: 'NIP', hint: 'np. 123-456-32-18. Kraken sprawdza, czy to prawdziwy NIP.', tip: 'NIP ma 10 cyfr. Ostatnia to cyfra kontrolna, więc literówka od razu wychodzi.' },
  { key: 'email', label: 'E-mail' },
];


export function showClientsPage(root: HTMLElement, deps: ClientsPageDeps, note?: string, fromClick = false): void {
  let clients: Client[] = [];
  let problems: string[] = [];

  const render = (...children: (Node | string)[]) => root.replaceChildren(...children);

  function errorNodes(error: unknown, retry: () => void, retryLabel: string, show: (e: unknown) => void, mayHaveSaved: boolean, reloadLabel = 'Odśwież klientów'): Node[] {
    return googleErrorNodes(error, deps, {
      retry,
      retryLabel,
      show,
      ...(mayHaveSaved ? {} : { signedOutNote: 'Nic nie zostało utracone.' }),
      other: { label: mayHaveSaved ? reloadLabel : 'Spróbuj ponownie', action: () => load(undefined, true), mayHaveSaved },
    });
  }

  function load(note?: string, fromClick = false): void {
    render(el('p', {}, busy('Wczytuję klientów…')));
    const all = () => deps.repo.load();
    (fromClick ? deps.withGoogle(all) : all())
      .then((result) => {
        if (!root.isConnected) return;
        clients = result.clients;
        problems = [...result.problems];
        showList(note);
      })
      .catch((error: unknown) => {
        if (!root.isConnected || deps.isIgnorable(error)) return;
        const show = (e: unknown) => render(...errorNodes(e, () => load(), 'Zaloguj się i pokaż klientów', show, false));
        show(error);
      });
  }

  function lockPage(): void {
    for (const node of root.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>('button, input, select')) node.disabled = true;
  }

  /** Delete or Restore, inside the click (so a sign-in renewal can open Google's window). `progress` shows the spinner. */
  function change(client: Client, kind: 'remove' | 'restore', progress: () => void): void {
    progress();
    deps.busy(true);
    deps
      .withGoogle(() => (kind === 'remove' ? deps.repo.remove(client, deps.now()) : deps.repo.restore(client, deps.now())))
      .finally(() => deps.busy(false))
      .then(() => {
        if (root.isConnected) load(kind === 'remove' ? `Usunięto ${client.name}. Można go przywrócić w „Usunięci klienci”.` : `Przywrócono ${client.name}.`);
      })
      .catch((error: unknown) => {
        if (!root.isConnected) return;
        if (deps.isIgnorable(error)) return showList();
        const working = kind === 'remove' ? `Usuwam ${client.name}…` : `Przywracam ${client.name}…`;
        const label = kind === 'remove' ? `Zaloguj się i usuń ${client.name}` : `Zaloguj się i przywróć ${client.name}`;
        const show = (e: unknown) => showList(undefined, errorNodes(e, () => change(client, kind, () => render(el('p', {}, busy(working)))), label, show, true));
        show(error);
      });
  }

  // ---- The list ----

  function showList(note?: string, error?: Node[]): void {
    deps.formClosed();
    const sorted = sortClients(clients);
    const active = sorted.filter((c) => !isDeleted(c));
    const deleted = sorted.filter(isDeleted);

    const row = (c: Client, restorable: boolean) => {
      const actions = el('td', { class: 'row-actions nowrap' });
      const confirmRow = el('tr', { class: 'confirm-row', hidden: '' });
      const inRow = (text: string) => () => {
        lockPage();
        confirmRow.hidden = true;
        actions.replaceChildren(busy(text));
      };
      const normal = () => {
        confirmRow.hidden = true;
        actions.replaceChildren(
          ...(restorable
            ? [button('Przywróć', () => change(c, 'restore', inRow('Przywracam…')), 'link')]
            : [button('Usuń', ask, 'link')]),
        );
      };
      const ask = () => {
        actions.replaceChildren();
        const no = button('Nie', normal, 'secondary');
        confirmRow.replaceChildren(
          el('td', { colspan: '5' }, el('span', {}, `Usunąć ${c.name}? Można go później przywrócić. `), button('Tak, usuń', () => change(c, 'remove', inRow('Usuwam…')), 'primary'), ' ', no),
        );
        confirmRow.hidden = false;
        no.focus();
      };
      normal();
      const tr = el(
          'tr',
          restorable ? { class: 'row-deleted' } : {},
          el('td', {}, el('strong', {}, c.name), ...(c.problems.length > 0 ? [' ', el('span', { class: 'badge badge-warn', title: c.problems.join(' ') }, 'Sprawdź')] : [])),
          el('td', {}, c.registeredName || el('span', { class: 'muted' }, '—')),
          el('td', { class: 'nowrap' }, c.nip ? formatNip(c.nip) : el('span', { class: 'muted' }, '—')),
          el('td', {}, c.email || el('span', { class: 'muted' }, '—')),
          actions,
        );
      if (!restorable) clickableRow(tr, () => showForm(c), `Otwórz ${c.name}`, { asking: () => !confirmRow.hidden });
      return [tr, confirmRow];
    };

    const table = (list: readonly Client[], restorable: boolean) =>
      el(
        'div',
        { class: 'table-wrap' },
        cardTable(el(
          'table',
          { class: 'data-table' },
          el('thead', {}, el('tr', {}, ...['Nazwa', 'Nazwa w CEIDG', 'NIP', 'E-mail', ''].map((h) => el('th', { scope: 'col' }, h)))),
          el('tbody', {}, ...list.flatMap((c) => row(c, restorable))),
        )),
      );

    render(
      el('div', { class: 'page-head' }, el('h2', {}, 'Klienci'), el('div', { class: 'head-actions' }, button('Dodaj klienta', () => showForm(null)))),
      el('p', { class: 'muted small' }, 'Firmy, z którymi współpracujesz. Kliknij klienta, aby zobaczyć lub zmienić jego dane i ceny specjalne. Rabat zależy od wagi kawy na fakturze (Opakowania i rabaty).'),
      ...(note ? [message(note)] : []),
      ...(error ?? []),
      ...problems.map((text) => message(text, 'error')),
      ...active.filter((c) => c.problems.length > 0).map((c) => message(c.problems.join(' '), 'error')),
      active.length === 0 ? el('p', { class: 'muted' }, 'Nie ma jeszcze klientów. Kliknij „Dodaj klienta”.') : table(active, false),
      ...(deleted.length > 0 ? [el('details', { class: 'small deleted-products' }, el('summary', {}, `Usunięci klienci (${deleted.length})`), table(deleted, true))] : []),
    );
  }

  // ---- The form ----

  function showForm(client: Client | null): void {
    deps.formOpened();
    const initial = client ? formFromClient(client) : emptyClientForm();
    const others = clients.filter((c) => c !== client);
    const inputs = {} as Record<(typeof FIELDS)[number]['key'], HTMLInputElement>;
    const errorLines = {} as Record<keyof ClientForm, HTMLParagraphElement>;

    const fieldNodes = FIELDS.map((spec) => {
      const id = `client-${spec.key}`;
      const input = el('input', { id, type: spec.key === 'email' ? 'email' : 'text', autocomplete: 'off', 'aria-describedby': `${id}-error`, ...(spec.key === 'nip' ? { inputmode: 'numeric' } : {}) });
      input.value = initial[spec.key];
      inputs[spec.key] = input;
      errorLines[spec.key] = el('p', { class: 'field-error', id: `${id}-error`, role: 'alert' });
      return el(
        'div',
        { class: 'field' },
        el('div', { class: 'label-row' }, el('label', { for: id }, spec.label, spec.required ? ' *' : ''), ...(spec.tip ? [infoTip(spec.tip)] : [])),
        input,
        ...(spec.hint ? [el('p', { class: 'field-hint' }, spec.hint)] : []),
        errorLines[spec.key],
      );
    });

    const banner = el('div', { class: 'form-banner' });
    const label = client ? 'Zapisz zmiany' : 'Zapisz klienta';
    const saveButton = el('button', { type: 'submit', class: 'btn btn-primary' }, label);
    const cancelButton = button('Anuluj', () => showList(), 'secondary');
    const readForm = (): ClientForm => ({ name: inputs.name.value, nip: inputs.nip.value, email: inputs.email.value, registeredName: inputs.registeredName.value });
    const showErrors = (errors: ClientFormErrors) => {
      for (const key of Object.keys(errorLines) as (keyof ClientForm)[]) errorLines[key].textContent = errors[key] ?? '';
      for (const spec of FIELDS) inputs[spec.key].setAttribute('aria-invalid', errors[spec.key] ? 'true' : 'false');
      const first = FIELDS.find((spec) => errors[spec.key]);
      if (first) inputs[first.key].focus();
    };
    const setBusy = (working: boolean) => {
      saveButton.disabled = working;
      cancelButton.disabled = working;
      saveButton.replaceChildren(working ? busy('Zapisuję…') : label);
    };

    function save(): void {
      const result = validateClientForm(readForm(), others);
      if (!result.ok) {
        showErrors(result.errors);
        banner.replaceChildren(message('Popraw pola zaznaczone poniżej.', 'error'));
        return;
      }
      showErrors({});
      banner.replaceChildren();
      setBusy(true);
      deps.busy(true);
      deps
        .withGoogle(async () =>
          client ? deps.repo.update(client, changedClientFields(client, result.fields), deps.now()) : deps.repo.add(result.fields, await deps.whoAmI(), deps.now()),
        )
        .finally(() => deps.busy(false))
        .then(() => {
          if (root.isConnected) load(`Zapisano ${result.fields['name'] ?? ''}.`);
        })
        .catch((error: unknown) => {
          setBusy(false);
          if (deps.isIgnorable(error)) return;
          const show = (e: unknown) => {
            banner.replaceChildren(...errorNodes(e, save, 'Zaloguj się i zapisz', show, true, 'Odśwież klientów (bez tego formularza)'));
            banner.scrollIntoView({ block: 'nearest' });
          };
          show(error);
        });
    }

    const formNode = el(
      'form',
      { class: 'lot-form', novalidate: '' },
      el('fieldset', { class: 'form-section' }, el('legend', {}, 'Klient'), el('div', { class: 'fields' }, ...fieldNodes)),
      el('div', { class: 'actions' }, saveButton, cancelButton),
    );
    formNode.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!saveButton.disabled) save();
    });
    const prices = client
      ? pricesSection(client, { ...deps, errorNodes: (error, retry, label, show, mayHaveSaved) => errorNodes(error, retry, label, show, mayHaveSaved, 'Odśwież klientów (bez tego formularza)') })
      : el('p', { class: 'muted small' }, 'Najpierw zapisz klienta; potem kliknij go na liście, aby dodać ceny specjalne.');

    render(
      el('p', { class: 'small back-link' }, button('← Wszyscy klienci', () => showList(), 'link')),
      el('h2', {}, client ? client.name : 'Dodaj klienta'),
      el('p', { class: 'muted small' }, 'Pola oznaczone * są wymagane.'),
      ...(client ? client.problems.map((text) => message(text, 'error')) : []),
      banner,
      formNode,
      prices,
    );
    inputs.name.focus();
  }

  load(note, fromClick);
}
