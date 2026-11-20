// The Clients screen (owner, 2026-11-19): the list of clients, and the form to add or edit one. The discount is
// chosen from the wholesale discounts set under Packaging & discounts, so the two never differ.
// Everything from outside comes through ClientsPageDeps (main.ts provides it).

import { formatPercent } from '../../domain/percent';
import { busy, button, el, infoTip, message } from '../../ui/dom';
import { googleErrorNodes } from '../../ui/googleErrors';
import { activeDiscounts, type CostsRepository, type Discount } from '../costs';
import type { LotsRepository } from '../lots';
import type { ProductsRepository } from '../products';
import type { RoastsRepository } from '../roasts';
import { KEEP_DISCOUNT, changedClientFields, emptyClientForm, formFromClient, formatNip, isDeleted, sortClients, validateClientForm, type Client, type ClientForm, type ClientFormErrors } from './model';
import { pricesSection } from './pricesSection';
import type { ClientsRepository } from './repo';
import type { SpecialPricesRepository } from './repoPrices';

export interface ClientsPageDeps {
  repo: ClientsRepository;
  /** For the wholesale discounts (Packaging & discounts), and with the next three, what a bag costs. */
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

const FIELDS: readonly { key: Exclude<keyof ClientForm, 'discount'>; label: string; hint?: string; tip?: string; required?: boolean }[] = [
  { key: 'name', label: 'Name', hint: 'The name you use, e.g. Café Nowa.', required: true },
  { key: 'registeredName', label: 'Registered name (CEIDG)', hint: 'The official name, for the invoice.' },
  { key: 'nip', label: 'NIP', hint: 'e.g. 123-456-32-18. Kraken checks it is a real NIP.', tip: 'The Polish tax ID: 10 digits. The last digit is a check digit, so a typo is caught straight away.' },
  { key: 'email', label: 'Email' },
];


export function showClientsPage(root: HTMLElement, deps: ClientsPageDeps, note?: string, fromClick = false): void {
  let clients: Client[] = [];
  let problems: string[] = [];
  let discounts: Discount[] = [];
  /** False when the Discounts tab could not be read: then no discount is offered or judged (it is kept as it is). */
  let discountsKnown = false;
  /** The discounts are read once per visit: they are only needed for the form and the labels. */
  let discountsLoaded = false;

  const render = (...children: (Node | string)[]) => root.replaceChildren(...children);

  function errorNodes(error: unknown, retry: () => void, retryLabel: string, show: (e: unknown) => void, mayHaveSaved: boolean, reloadLabel = 'Reload clients'): Node[] {
    return googleErrorNodes(error, deps, {
      retry,
      retryLabel,
      show,
      ...(mayHaveSaved ? {} : { signedOutNote: 'Nothing was lost.' }),
      other: { label: mayHaveSaved ? reloadLabel : 'Try again', action: () => load(undefined, true), mayHaveSaved },
    });
  }

  function load(note?: string, fromClick = false): void {
    render(el('p', {}, busy('Loading clients…')));
    // The discounts are only for the form's list: if they cannot be read, the clients are still shown.
    const discountsNow = () =>
      discountsLoaded
        ? Promise.resolve({ discounts, known: discountsKnown, problems: [] as string[] })
        : deps.costs.load().then(
            (costs) => ({ ...activeDiscounts(costs.discounts), known: true }),
            (error: unknown) => {
              if (deps.isSignedOut(error) || deps.isIgnorable(error)) throw error;
              return { discounts: [] as Discount[], known: false, problems: [`The discounts could not be read (${deps.describeError(error)}), so a client's discount cannot be changed now.`] };
            },
          );
    const all = () => Promise.all([deps.repo.load(), discountsNow()]);
    (fromClick ? deps.withGoogle(all) : all())
      .then(([result, found]) => {
        if (!root.isConnected) return;
        clients = result.clients;
        discounts = found.discounts;
        discountsKnown = found.known;
        discountsLoaded = found.known; // read again next time if it failed
        problems = [...result.problems, ...found.problems];
        showList(note);
      })
      .catch((error: unknown) => {
        if (!root.isConnected || deps.isIgnorable(error)) return;
        const show = (e: unknown) => render(...errorNodes(e, () => load(), 'Sign in and show clients', show, false));
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
        if (root.isConnected) load(kind === 'remove' ? `Deleted ${client.name}. It can be restored under "Deleted clients".` : `Restored ${client.name}.`);
      })
      .catch((error: unknown) => {
        if (!root.isConnected) return;
        if (deps.isIgnorable(error)) return showList();
        const working = kind === 'remove' ? `Deleting ${client.name}…` : `Restoring ${client.name}…`;
        const label = kind === 'remove' ? `Sign in and delete ${client.name}` : `Sign in and restore ${client.name}`;
        const show = (e: unknown) => showList(undefined, errorNodes(e, () => change(client, kind, () => render(el('p', {}, busy(working)))), label, show, true));
        show(error);
      });
  }

  /** "15 % (Do 10 kg)", or the stored value with a note when it is not one of the discounts any more. */
  const discountLabel = (c: Client) => {
    if (c.discountTenths === null) return c.discountText ? `"${c.discountText}"` : '—';
    if (!discountsKnown) return formatPercent(c.discountTenths);
    const known = discounts.find((d) => d.tenths === c.discountTenths);
    return known ? `${formatPercent(known.tenths)}${known.name ? ` (${known.name})` : ''}` : `${formatPercent(c.discountTenths)} (not in your discounts)`;
  };

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
            ? [button('Restore', () => change(c, 'restore', inRow('Restoring…')), 'link')]
            : [button('Edit', () => showForm(c), 'link'), button('Delete', ask, 'link')]),
        );
      };
      const ask = () => {
        actions.replaceChildren();
        const no = button('No', normal, 'secondary');
        confirmRow.replaceChildren(
          el('td', { colspan: '6' }, el('span', {}, `Delete ${c.name}? It can be restored later. `), button('Yes, delete', () => change(c, 'remove', inRow('Deleting…')), 'primary'), ' ', no),
        );
        confirmRow.hidden = false;
        no.focus();
      };
      normal();
      return [
        el(
          'tr',
          restorable ? { class: 'row-deleted' } : {},
          el('td', {}, el('strong', {}, c.name), ...(c.problems.length > 0 ? [' ', el('span', { class: 'badge badge-warn', title: c.problems.join(' ') }, 'Check')] : [])),
          el('td', {}, c.registeredName || el('span', { class: 'muted' }, '—')),
          el('td', { class: 'nowrap' }, c.nip ? formatNip(c.nip) : el('span', { class: 'muted' }, '—')),
          el('td', {}, c.email || el('span', { class: 'muted' }, '—')),
          el('td', { class: 'nowrap' }, discountLabel(c)),
          actions,
        ),
        confirmRow,
      ];
    };

    const table = (list: readonly Client[], restorable: boolean) =>
      el(
        'div',
        { class: 'table-wrap' },
        el(
          'table',
          { class: 'data-table' },
          el('thead', {}, el('tr', {}, ...['Name', 'Registered name', 'NIP', 'Email', 'Discount', ''].map((h) => el('th', { scope: 'col' }, h)))),
          el('tbody', {}, ...list.flatMap((c) => row(c, restorable))),
        ),
      );

    render(
      el('div', { class: 'page-head' }, el('h2', {}, 'Clients'), el('div', { class: 'head-actions' }, button('Add client', () => showForm(null)))),
      el('p', { class: 'muted small' }, 'The businesses you work with, and the wholesale discount each one gets.'),
      ...(note ? [message(note)] : []),
      ...(error ?? []),
      ...problems.map((text) => message(text, 'error')),
      ...active.filter((c) => c.problems.length > 0).map((c) => message(c.problems.join(' '), 'error')),
      active.length === 0 ? el('p', { class: 'muted' }, 'No clients yet. Click "Add client".') : table(active, false),
      ...(deleted.length > 0 ? [el('details', { class: 'small deleted-products' }, el('summary', {}, `Deleted clients (${deleted.length})`), table(deleted, true))] : []),
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

    // The discount: one of those set under Packaging & discounts. A stored one that is not there any more, or that
    // cannot be read, is offered as it is, so saving another change never alters it by accident.
    const discount = el('select', { id: 'client-discount' });
    discount.append(el('option', { value: '' }, 'No discount'));
    for (const d of discounts) discount.append(el('option', { value: String(d.tenths) }, `${formatPercent(d.tenths)}${d.name ? ` (${d.name})` : ''}`));
    if (initial.discount === KEEP_DISCOUNT) {
      discount.append(el('option', { value: KEEP_DISCOUNT }, `Keep "${client?.discountText ?? ''}" (cannot be read: choose one to correct it)`));
    } else if (initial.discount !== '' && !discounts.some((d) => String(d.tenths) === initial.discount)) {
      discount.append(el('option', { value: initial.discount }, `${formatPercent(Number(initial.discount))}${discountsKnown ? ' (not in your discounts)' : ''}`));
    }
    discount.value = initial.discount;
    discount.disabled = !discountsKnown; // the discounts could not be read: the client keeps its discount
    errorLines.discount = el('p', { class: 'field-error', role: 'alert' });
    const discountField = el(
      'div',
      { class: 'field' },
      el('div', { class: 'label-row' }, el('label', { for: discount.id }, 'Wholesale discount'), infoTip('How much cheaper this client gets your coffee. The list comes from Packaging & discounts.')),
      discount,
      ...(discountsKnown ? [] : [el('p', { class: 'field-hint' }, 'The discounts could not be read, so this stays as it is for now.')]),
      errorLines.discount,
    );

    const banner = el('div', { class: 'form-banner' });
    const label = client ? 'Save changes' : 'Save client';
    const saveButton = el('button', { type: 'submit', class: 'btn btn-primary' }, label);
    const cancelButton = button('Cancel', () => showList(), 'secondary');
    const readForm = (): ClientForm => ({ name: inputs.name.value, nip: inputs.nip.value, email: inputs.email.value, registeredName: inputs.registeredName.value, discount: discount.value });
    const showErrors = (errors: ClientFormErrors) => {
      for (const key of Object.keys(errorLines) as (keyof ClientForm)[]) errorLines[key].textContent = errors[key] ?? '';
      for (const spec of FIELDS) inputs[spec.key].setAttribute('aria-invalid', errors[spec.key] ? 'true' : 'false');
      const first = FIELDS.find((spec) => errors[spec.key]);
      if (first) inputs[first.key].focus();
    };
    const setBusy = (working: boolean) => {
      saveButton.disabled = working;
      cancelButton.disabled = working;
      saveButton.replaceChildren(working ? busy('Saving…') : label);
    };

    function save(): void {
      const result = validateClientForm(readForm(), others);
      if (!result.ok) {
        showErrors(result.errors);
        banner.replaceChildren(message('Please fix the fields marked below.', 'error'));
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
          if (root.isConnected) load(`Saved ${result.fields['name'] ?? ''}.`);
        })
        .catch((error: unknown) => {
          setBusy(false);
          if (deps.isIgnorable(error)) return;
          const show = (e: unknown) => {
            banner.replaceChildren(...errorNodes(e, save, 'Sign in and save', show, true, 'Reload clients (drops this form)'));
            banner.scrollIntoView({ block: 'nearest' });
          };
          show(error);
        });
    }

    const formNode = el(
      'form',
      { class: 'lot-form', novalidate: '' },
      el('fieldset', { class: 'form-section' }, el('legend', {}, 'Client'), el('div', { class: 'fields' }, ...fieldNodes, discountField)),
      el('div', { class: 'actions' }, saveButton, cancelButton),
    );
    formNode.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!saveButton.disabled) save();
    });
    const prices = client
      ? pricesSection(client, { ...deps, errorNodes: (error, retry, label, show) => errorNodes(error, retry, label, show, true) })
      : el('p', { class: 'muted small' }, 'Save the client first; then open it again (Edit) to add special prices.');

    render(
      el('p', { class: 'small back-link' }, button('← All clients', () => showList(), 'link')),
      el('h2', {}, client ? `Edit ${client.name}` : 'Add client'),
      el('p', { class: 'muted small' }, 'Fields marked * are required.'),
      ...(client ? client.problems.map((text) => message(text, 'error')) : []),
      banner,
      formNode,
      prices,
    );
    inputs.name.focus();
  }

  load(note, fromClick);
}
