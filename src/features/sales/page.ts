// The Sales screen (owner, 2026-11-19): what went out and the invoices to issue. Either owner adds entries: a sale
// to a client (the invoice starts "to be issued"), a sample left somewhere, or own use. The list has filters
// ("Invoice to be issued" first) and a dropdown for the invoice status (today's date is taken). No prices (owner, 2026-11-19): it
// records how much went out; the owner takes the prices from the client's offer when issuing the invoice.
// Everything from outside comes through SalesPageDeps (main.ts provides it).

import { localDate } from '../../core/dates';
import { BAG_SIZES_G, formatBagSize } from '../../domain/bagSizes';
import { busy, button, clickableRow, el, infoTip, message } from '../../ui/dom';
import { googleErrorNodes } from '../../ui/googleErrors';
import { isClientDeleted, sortClients, type Client, type ClientsRepository } from '../clients';
import { isProductDeleted, sortProducts, type Product, type ProductsRepository } from '../products';
import {
  KIND_LABELS,
  STATUS_LABELS,
  changedSaleFields,
  emptyLine,
  emptySaleForm,
  formFromSale,
  isDeleted,
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
  type SaleKind,
  type SaleLine,
} from './model';
import { FILTERS, bagsText, saleFacts, saleRows, type SaleRow, type SalesFilter } from './present';
import type { SalesRepository } from './repo';

export interface SalesPageDeps {
  repo: SalesRepository;
  clients: ClientsRepository;
  products: ProductsRepository;
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
  let clients: Client[] = [];
  let products: Product[] = [];
  let problems: string[] = [];
  /** The filter shown; null until the first load (then "to be issued" if there is any, else all). */
  let filter: SalesFilter | null = null;

  const render = (...children: (Node | string)[]) => root.replaceChildren(...children);
  const today = () => localDate(deps.now());

  function errorNodes(error: unknown, retry: () => void, retryLabel: string, show: (e: unknown) => void, mayHaveSaved: boolean, reloadLabel = 'Reload sales'): Node[] {
    return googleErrorNodes(error, deps, {
      retry,
      retryLabel,
      show,
      ...(mayHaveSaved ? {} : { signedOutNote: 'Nothing was lost.' }),
      other: { label: mayHaveSaved ? reloadLabel : 'Try again', action: () => load(undefined, true), mayHaveSaved },
    });
  }

  function load(note?: string, fromClick = false): void {
    render(el('p', {}, busy('Loading sales…')));
    const all = () => Promise.all([deps.repo.load(), deps.clients.load(), deps.products.load()]);
    (fromClick ? deps.withGoogle(all) : all())
      .then(([s, c, p]) => {
        if (!root.isConnected) return;
        sales = s.sales;
        lines = s.lines;
        clients = c.clients;
        products = p.products;
        const active = s.sales.filter((x) => !isDeleted(x));
        const activeIds = new Set(active.map((x) => x.id));
        problems = [
          ...s.problems,
          ...c.problems,
          ...p.problems,
          ...active.flatMap((x) => x.problems),
          ...s.lines.filter((l) => l.deletedAt === '' && activeIds.has(l.saleId)).flatMap((l) => l.problems),
        ];
        showList(note);
      })
      .catch((error: unknown) => {
        if (!root.isConnected || deps.isIgnorable(error)) return;
        const show = (e: unknown) => render(...errorNodes(e, () => load(), 'Sign in and show sales', show, false));
        show(error);
      });
  }

  function lockPage(): void {
    for (const node of root.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('button, input, select, textarea')) node.disabled = true;
  }

  /** Writes something about one entry from the list (status, delete, restore), inside the click; reloads after. */
  function act(slot: HTMLElement, working: string, action: () => Promise<void>, done: string, afterSave?: () => void): void {
    lockPage();
    slot.replaceChildren(busy(working));
    deps.busy(true);
    deps
      .withGoogle(action)
      .finally(() => deps.busy(false))
      .then(() => {
        afterSave?.();
        if (root.isConnected) load(done);
      })
      .catch((error: unknown) => {
        if (!root.isConnected) return;
        if (deps.isIgnorable(error)) return showList();
        const show = (e: unknown) => showList(undefined, errorNodes(e, () => act(slot, working, action, done, afterSave), 'Sign in and try again', show, true));
        show(error);
      });
  }

  const clientName = (id: string) => clients.find((c) => c.id === id)?.name;
  const productName = (id: string) => products.find((p) => p.id === id)?.name;

  // ---- The list ----

  function showList(note?: string, error?: Node[]): void {
    deps.formClosed();
    filter ??= saleRows(sales, lines, 'all', clientName, productName).counts.to_issue > 0 ? 'to_issue' : 'all';
    const { rows, counts } = saleRows(sales, lines, filter, clientName, productName);
    const deleted = sales.filter(isDeleted);

    const chip = (f: SalesFilter, label: string) => {
      const b = button(`${label} (${counts[f]})`, () => ((filter = f), showList()), 'link');
      if (f === filter) b.setAttribute('aria-current', 'true');
      return b;
    };

    const row = (r: SaleRow) => {
      const actions = el('td', { class: 'row-actions nowrap' });
      const extra = el('tr', { class: 'confirm-row', hidden: '' });
      const sale = r.sale;
      const inline = (...children: (Node | string)[]) => {
        extra.replaceChildren(el('td', { colspan: '8' }, ...children));
        extra.hidden = false;
      };
      /** Puts the status dropdown back to the stored status (a date box closed without saving). */
      let resetStatus = () => {};
      const normal = () => {
        extra.hidden = true;
        resetStatus();
        actions.replaceChildren(button('Delete', ask, 'link'));
      };
      /** The invoice status as a dropdown: any status to any other; after saving the list shows all entries. */
      const statusCell = el('td', { class: 'nowrap no-row-click' });
      if (sale.kind !== 'sale') statusCell.append(el('span', { class: 'muted' }, '—'));
      else {
        const select = el('select', { class: `status-select status-${sale.status ?? ''}`, 'aria-label': `Invoice status: ${r.who}` });
        if (sale.status === null) select.append(el('option', { value: '', selected: '' }, '? (cannot be read)'));
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
          act(statusCell, 'Saving…', () => deps.repo.update(sale, change.fields, deps.now()), `${r.who}: ${STATUS_LABELS[to].toLowerCase()}.`, () => (filter = 'all'));
        };
        resetStatus = () => (select.value = sale.status ?? '');
        const cancel = normal;
        select.addEventListener('change', () => {
          const to = select.value as InvoiceStatus;
          if (!needsInvoiceDate(sale, to)) return save(to, '');
          // A small date box under the row: when the invoice was issued (the date it already has, or today).
          const label = 'Invoice issued on';
          const date = el('input', { type: 'date', class: 'input-short', 'aria-label': label });
          date.value = suggestedInvoiceDate(sale, today());
          const errorLine = el('span', { class: 'field-error', role: 'alert' });
          const form = el(
            'form',
            { class: 'inline-form', novalidate: '' },
            el('span', {}, label),
            date,
            el('button', { type: 'submit', class: 'btn btn-primary' }, 'Save'),
            button('Cancel', cancel, 'secondary'),
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
        const no = button('No', normal, 'secondary');
        inline(
          el('span', {}, `Delete this ${r.kindLabel.toLowerCase()} (${r.date})? It can be restored later. `),
          button('Yes, delete', () => act(actions, 'Deleting…', () => deps.repo.remove(sale, deps.now()), 'Deleted. It can be restored under "Deleted entries".'), 'primary'),
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
          el('td', { class: 'nowrap' }, r.date),
          el('td', { class: 'nowrap' }, el('span', { class: `badge kind-${r.kind ?? 'unknown'}` }, r.kindLabel)),
          el('td', {}, r.who || el('span', { class: 'muted' }, '—')),
          el('td', {}, r.items),
          el('td', { class: 'num nowrap' }, r.bags || el('span', { class: 'muted' }, '—')),
          statusCell,
          el('td', { class: 'nowrap' }, r.invoiceDate || el('span', { class: 'muted' }, '—')),
          actions,
        ),
          () => showForm(sale),
          `Open the ${r.kindLabel.toLowerCase()} of ${r.date}${r.who ? ` (${r.who})` : ''}`,
          { asking: () => !extra.hidden },
        ),
        extra,
      ];
    };

    render(
      el(
        'div',
        { class: 'page-head' },
        el('h2', {}, 'Sales'),
        el('div', { class: 'head-actions' }, button('Add', () => showForm(null))),
      ),
      el('p', { class: 'muted small' }, 'What went out: sales to clients (with the invoice to issue), samples left somewhere, and bags you took yourselves. ', infoTip('A sale starts as "Invoice to be issued". When the invoice is made in Fakturownia, choose "Invoice issued" in the Invoice column; when it is paid, choose "Paid". Choosing "Invoice issued" asks for the date it was issued (today unless you change it); it shows under "Issued on". A mistake can be undone the same way. Samples and own use have no invoice.')),
      ...(note ? [message(note)] : []),
      ...(error ?? []),
      ...problems.map((text) => message(text, 'error')),
      el('p', { class: 'compare-sizes sales-filters small' }, ...FILTERS.flatMap(({ filter: f, label }) => [chip(f, label), ' '])),
      rows.length === 0
        ? el('p', { class: 'muted' }, filter === 'to_issue' ? 'No invoices to issue.' : 'Nothing here yet.')
        : el(
            'div',
            { class: 'table-wrap' },
            el(
              'table',
              { class: 'data-table sales-table' },
              el('thead', {}, el('tr', {}, ...['Date', 'What', 'Client / place', 'Products', 'Bags', 'Invoice', 'Issued on', ''].map((h) => el('th', { scope: 'col' }, h)))),
              el('tbody', {}, ...rows.flatMap(row)),
            ),
          ),
      ...(deleted.length > 0 ? [deletedList(deleted)] : []),
    );
  }

  function deletedList(deleted: readonly Sale[]): HTMLElement {
    return el(
      'details',
      { class: 'small deleted-products' },
      el('summary', {}, `Deleted entries (${deleted.length})`),
      el(
        'ul',
        {},
        ...deleted.map((s) => {
          const slot = el('span', {});
          slot.append(button('Restore', () => act(slot, 'Restoring…', () => deps.repo.restore(s, deps.now()), 'Restored.'), 'link'));
          return el('li', {}, `${s.date} · ${s.kind ? KIND_LABELS[s.kind] : '?'} · ${s.clientId ? (clientName(s.clientId) ?? '?') : s.place || s.reason} `, slot);
        }),
      ),
    );
  }

  // ---- The form ----

  function showForm(sale: Sale | null): void {
    deps.formOpened();
    const existingLines = sale ? linesOf(lines, sale.id) : [];
    const form: SaleForm = sale ? formFromSale(sale, existingLines) : emptySaleForm(today());
    if (form.lines.length === 0) form.lines.push(emptyLine());
    const activeClients = sortClients(clients).filter((c) => !isClientDeleted(c));
    const activeProducts = sortProducts(products).filter((p) => !isProductDeleted(p));

    const errorBox = el('div', {});
    const banner = el('div', { class: 'form-banner' });

    // Who and why: a sale needs a client; a sample a client or a place; own use a reason.
    const kindHolder = el('div', { class: 'kind-choice', role: 'radiogroup', 'aria-label': 'What it was' });
    const whoHolder = el('div', { class: 'fields' });
    const linesHolder = el('div', {});
    const totalLine = el('p', { class: 'sale-total' });

    const date = el('input', { id: 'sale-date', type: 'date' });
    date.value = form.date;
    date.addEventListener('input', () => (form.date = date.value));
    const notes = el('textarea', { id: 'sale-notes', rows: '2' });
    notes.value = form.notes;
    notes.addEventListener('input', () => (form.notes = notes.value));

    const renderKind = () => {
      kindHolder.replaceChildren(
        ...(['sale', 'sample', 'own_use'] as SaleKind[]).map((k) => {
          const b = button(KIND_LABELS[k], () => {
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

    const renderWho = () => {
      const fields: Node[] = [];
      if (form.kind !== 'own_use') {
        const select = el('select', { id: 'sale-client' });
        select.append(el('option', { value: '' }, form.kind === 'sale' ? 'Choose a client…' : 'Not a client (type the place)'));
        for (const c of activeClients) select.append(el('option', { value: c.id }, c.name));
        if (form.clientId && !activeClients.some((c) => c.id === form.clientId)) select.append(el('option', { value: form.clientId }, `${clientName(form.clientId) ?? '?'} (deleted)`));
        select.value = form.clientId;
        select.addEventListener('change', () => {
          form.clientId = select.value;
          renderWho();
        });
        fields.push(
          el(
            'div',
            { class: 'field' },
            el('div', { class: 'label-row' }, el('label', { for: select.id }, form.kind === 'sale' ? 'Client *' : 'Client')),
            select,
          ),
        );
      }
      if (form.kind === 'sample' && form.clientId === '') {
        const place = el('input', { id: 'sale-place', type: 'text', autocomplete: 'off', placeholder: 'e.g. Café Nowa, Kazimierz' });
        place.value = form.place;
        place.addEventListener('input', () => (form.place = place.value));
        fields.push(el('div', { class: 'field' }, el('div', { class: 'label-row' }, el('label', { for: place.id }, 'Where was it left? *')), place));
      }
      if (form.kind === 'own_use') {
        const reason = el('input', { id: 'sale-reason', type: 'text', autocomplete: 'off', placeholder: 'e.g. tasting at home' });
        reason.value = form.reason;
        reason.addEventListener('input', () => (form.reason = reason.value));
        fields.push(el('div', { class: 'field' }, el('div', { class: 'label-row' }, el('label', { for: reason.id }, 'Why? *')), reason));
      }
      whoHolder.replaceChildren(el('div', { class: 'field' }, el('div', { class: 'label-row' }, el('label', { for: date.id }, `Date of the ${KIND_LABELS[form.kind].toLowerCase()} *`)), date), ...fields);
    };

    const showTotal = () => {
      const text = bagsText(form.lines.map((l) => ({ bags: typedBags(l.bags), free: form.kind === 'sale' && l.free })));
      totalLine.replaceChildren(...(text ? ['Together: ', el('strong', {}, text)] : []));
    };

    const renderLines = () => {
      const sale_ = form.kind === 'sale'; // free bags only matter for a sale (not invoiced)
      const rows = form.lines.map((line, i) => {
        const product = el('select', { 'aria-label': `Line ${i + 1}: product` });
        product.append(el('option', { value: '' }, 'Choose a product…'));
        for (const p of activeProducts) product.append(el('option', { value: p.id }, p.name));
        if (line.productId && !activeProducts.some((p) => p.id === line.productId)) product.append(el('option', { value: line.productId }, `${productName(line.productId) ?? '?'} (deleted)`));
        product.value = line.productId;
        const size = el('select', { 'aria-label': `Line ${i + 1}: bag size` });
        for (const g of BAG_SIZES_G) size.append(el('option', { value: String(g) }, formatBagSize(g)));
        size.value = line.grams;
        const bags = el('input', { type: 'text', inputmode: 'numeric', class: 'input-xs', 'aria-label': `Line ${i + 1}: number of bags`, autocomplete: 'off' });
        bags.value = line.bags;
        const free = el('input', { type: 'checkbox', 'aria-label': `Line ${i + 1}: free` });
        free.checked = line.free;
        product.addEventListener('change', () => {
          line.productId = product.value;
        });
        size.addEventListener('change', () => {
          line.grams = size.value;
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
          'Remove',
          () => {
            form.lines.splice(i, 1);
            renderLines();
          },
          'link',
        );
        return el(
          'tr',
          {},
          el('td', {}, product),
          el('td', {}, size),
          el('td', {}, bags),
          ...(sale_ ? [el('td', { class: 'nowrap' }, el('label', { class: 'free-label' }, free, ' free'))] : []),
          el('td', {}, form.lines.length > 1 ? remove : ''),
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
                el('th', { scope: 'col' }, 'Product'),
                el('th', { scope: 'col' }, 'Size'),
                el('th', { scope: 'col' }, 'Bags'),
                ...(sale_
                  ? [el('th', { scope: 'col' }, 'Free ', infoTip('Tick it for bags given for free (gratis): they are not invoiced.'))]
                  : []),
                el('th', { scope: 'col' }, ''),
              ),
            ),
            el('tbody', {}, ...rows),
          ),
        ),
        button(
          'Add another product',
          () => {
            form.lines.push(emptyLine());
            renderLines();
          },
          'secondary',
        ),
      );
      showTotal();
    };

    const label = sale ? 'Save changes' : 'Save';
    const saveButton = el('button', { type: 'submit', class: 'btn btn-primary' }, label);
    const cancelButton = button('Cancel', () => showList(), 'secondary');
    const setBusy = (working: boolean) => {
      saveButton.disabled = working;
      cancelButton.disabled = working;
      saveButton.replaceChildren(working ? busy('Saving…') : label);
    };
    /** The entry once saved: if the lines then fail, a retry saves only the lines (never a second entry). */
    let savedId: string | null = null;

    function save(): void {
      const { clientIds, productIds } = choosableIds(
        clients.filter((c) => !isClientDeleted(c)).map((c) => c.id),
        products.filter((p) => !isProductDeleted(p)).map((p) => p.id),
        sale,
        existingLines,
      );
      const result = validateSale(form, clientIds, productIds);
      if (!result.ok) {
        const e = result.errors;
        errorBox.replaceChildren(...[e.date, e.client, e.place, e.reason, e.notes, e.lines, ...e.line].filter((t): t is string => !!t).map((t) => message(t, 'error')));
        banner.replaceChildren(message('Please fix what is listed below.', 'error'));
        return;
      }
      errorBox.replaceChildren();
      banner.replaceChildren();
      setBusy(true);
      deps.busy(true);
      deps
        .withGoogle(async () => {
          let email: string | null = null;
          const by = async () => (email ??= await deps.whoAmI());
          if (savedId === null) {
            if (sale) {
              const changes = changedSaleFields(sale, saleEditFields(sale, form.kind, result.fields));
              if (Object.keys(changes).length > 0) await deps.repo.update(sale, changes, deps.now());
              savedId = sale.id;
              await deps.repo.saveLines(sale.id, result.lines, existingLines, by, deps.now());
            } else {
              // The sale first, then its lines: if the lines fail, a retry saves only them (never a second sale).
              savedId = await deps.repo.add({ ...result.fields, ...startingInvoice(form.kind) }, await by(), deps.now());
              await deps.repo.saveLines(savedId, result.lines, [], by, deps.now());
            }
            return;
          }
          // A retry after the entry was saved: read again and write only what still differs.
          const fresh = await deps.repo.load();
          const stored = fresh.sales.find((s) => s.id === savedId);
          if (stored) {
            const changes = changedSaleFields(stored, result.fields);
            if (Object.keys(changes).length > 0) await deps.repo.update(stored, changes, deps.now());
          }
          await deps.repo.saveLines(savedId, result.lines, linesOf(fresh.lines, savedId), by, deps.now());
        })
        .finally(() => deps.busy(false))
        .then(() => {
          if (root.isConnected) load('Saved.');
        })
        .catch((error: unknown) => {
          setBusy(false);
          if (deps.isIgnorable(error)) return;
          const show = (e: unknown) => {
            banner.replaceChildren(...errorNodes(e, save, 'Sign in and save', show, true, 'Reload sales (drops this form)'));
            banner.scrollIntoView({ block: 'nearest' });
          };
          show(error);
        });
    }

    const formNode = el(
      'form',
      { class: 'lot-form', novalidate: '' },
      el('fieldset', { class: 'form-section' }, el('legend', {}, 'What was it?'), kindHolder),
      el('fieldset', { class: 'form-section' }, el('legend', {}, 'When and who'), whoHolder),
      el('fieldset', { class: 'form-section' }, el('legend', {}, 'Products'), linesHolder, totalLine),
      el('fieldset', { class: 'form-section' }, el('legend', {}, 'Notes'), el('div', { class: 'field field-wide' }, el('label', { for: notes.id, class: 'visually-hidden' }, 'Notes'), notes)),
      errorBox,
      el('div', { class: 'actions' }, saveButton, cancelButton),
    );
    formNode.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!saveButton.disabled) save();
    });

    renderKind();
    renderWho();
    renderLines();
    render(
      el('p', { class: 'small back-link' }, button('← All sales', () => showList(), 'link')),
      el('h2', {}, sale ? `Edit ${sale.kind ? KIND_LABELS[sale.kind].toLowerCase() : 'entry'} of ${sale.date}` : 'Add a sale, sample or own use'),
      ...(sale ? [el('dl', { class: 'product-details sale-facts' }, ...saleFacts(sale).flatMap((f) => [el('dt', {}, f.label), el('dd', {}, f.value)]))] : []),
      ...(sale?.kind === 'sale' && sale.status !== 'to_issue' ? [message('The invoice for this sale is already issued: if you change the products, correct the invoice in Fakturownia too.', 'error')] : []),
      banner,
      formNode,
    );
  }

  load(note, fromClick);
}
