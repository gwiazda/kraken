// The Packaging & discounts screen (owner, 2026-11-18; replaces Costs & prices). The business numbers used to work
// out prices, entered once and used everywhere (products, the offer):
// - Packaging: what goes into one bag of each (fixed) size besides the coffee (bag, label, …), net per piece;
// - Wholesale discounts: each with a short name shown on the offer, e.g. "Do 10 kg" = 15 %;
// - VAT and the usual roast loss.
// The multipliers (2×, 2,5×, 3×) are fixed. Everything from outside comes through CostsPageDeps (main.ts).

import { formatKg, formatPln, kgText } from '../../core/numbers';
import { busy, button, clickableRow, el, infoTip, message } from '../../ui/dom';
import { googleErrorNodes } from '../../ui/googleErrors';
import {
  formFromBagCost,
  formFromSettings,
  formatPercent,
  percentText,
  readSettings,
  validateBagCostForm,
  validateSettingsForm,
  type BagCost,
  type BagCostForm,
  type CostSettings,
  type SettingsForm,
} from './model';
import { DISCOUNT_NAME_MAX, activeDiscounts, discountFields, validateDiscount, type Discount } from './modelDiscounts';
import { bagSizeViews, type BagSizeView } from './present';
import type { CostData, CostsRepository } from './repo';

export interface CostsPageDeps {
  repo: CostsRepository;
  whoAmI: () => Promise<string>;
  /** Runs an action that talks to Google, renewing the sign-in first if needed. Call it inside a click. */
  withGoogle: <T>(action: () => Promise<T>) => Promise<T>;
  signIn: () => Promise<void>;
  isSignedOut: (error: unknown) => boolean;
  isIgnorable: (error: unknown) => boolean;
  describeError: (error: unknown) => string;
  now: () => Date;
  /** Kraken is saving to Google (true) or done (false): Back and the menu wait meanwhile. */
  busy: (on: boolean) => void;
}

export function showPackagingPage(root: HTMLElement, deps: CostsPageDeps, note?: string, fromClick = false): void {
  let data: CostData | null = null;

  const render = (...children: (Node | string)[]) => root.replaceChildren(...children);

  function load(note?: string, fromClick = false): void {
    render(el('p', {}, busy('Wczytuję…')));
    (fromClick ? deps.withGoogle(() => deps.repo.load()) : deps.repo.load())
      .then((costs) => {
        if (!root.isConnected) return;
        data = costs;
        showPage(note);
      })
      .catch((error: unknown) => {
        if (!root.isConnected || deps.isIgnorable(error)) return;
        const show = (e: unknown) =>
          render(
            ...googleErrorNodes(e, deps, {
              retry: () => load(),
              retryLabel: 'Zaloguj się i pokaż stronę',
              show,
              other: { label: 'Spróbuj ponownie', action: () => load(undefined, true), mayHaveSaved: false },
              signedOutNote: 'Nic nie zostało utracone.',
            }),
          );
        show(error);
      });
  }

  /** Disables every button and field; gives back the ones it disabled, to enable them again after a failed save. */
  function lockPage(): (HTMLButtonElement | HTMLInputElement)[] {
    const locked = [...root.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button, input')].filter((node) => !node.disabled);
    for (const node of locked) node.disabled = true;
    return locked;
  }

  /**
   * Saves something, then reloads the page with `done` as the note. While saving, the page is locked and `slot` shows
   * a spinner. If it fails, the page stays as it is (what the owner typed is kept) and `slot` explains the error.
   */
  function save(slot: HTMLElement, working: string, action: () => Promise<void>, done: string): void {
    const locked = lockPage();
    slot.replaceChildren(busy(working));
    deps.busy(true);
    deps
      .withGoogle(action)
      .finally(() => deps.busy(false))
      .then(() => {
        if (root.isConnected) load(done);
      })
      .catch((error: unknown) => {
        if (!root.isConnected) return;
        for (const node of locked) node.disabled = false;
        slot.replaceChildren();
        if (deps.isIgnorable(error)) return;
        const show = (e: unknown) =>
          slot.replaceChildren(
            ...googleErrorNodes(e, deps, {
              retry: () => save(slot, working, action, done),
              retryLabel: 'Zaloguj się i spróbuj ponownie',
              show,
              other: { label: 'Odśwież (bez tego, co wpisano)', action: () => load(undefined, true), mayHaveSaved: true },
            }),
          );
        show(error);
      });
  }

  function showPage(note?: string): void {
    if (!data) return;
    const { settings, problems: settingProblems } = readSettings(data.settings);
    const { views, unplaced, problems: sizeProblems } = bagSizeViews(data.costs);
    const discounts = activeDiscounts(data.discounts);
    render(
      el('div', { class: 'page-head' }, el('h2', {}, 'Opakowania i rabaty')),
      el('p', { class: 'muted small' }, 'Liczby, z których Kraken liczy ceny. Wpisujesz je raz tutaj; służą każdemu produktowi i ofercie.'),
      ...(note ? [message(note)] : []),
      ...[...data.problems, ...settingProblems, ...sizeProblems, ...discounts.problems].map((text) => message(text, 'error')),
      bagsNode(views, unplaced),
      discountsNode(discounts.discounts, discounts.usingDefaults),
      settingsNode(settings),
    );
  }

  // ---- Wholesale discounts ----

  /** Writes a whole list at once: while the defaults are in use nothing is in the tab yet, so the first change does. */
  const writeAll = (list: readonly { tenths: number; name: string; fromGrams: number | null }[]) => async () => {
    // Someone else may have saved discounts since this page was loaded: then writing the defaults again would
    // double them, so stop and ask to reload instead.
    if ((await deps.repo.load()).discounts.length > 0) throw new Error('Rabaty zostały w międzyczasie zmienione (może przez wspólnika). Odśwież stronę i spróbuj ponownie.');
    await deps.repo.addDiscounts(list.map(discountFields), await deps.whoAmI(), deps.now());
  };

  function discountsNode(discounts: readonly Discount[], usingDefaults: boolean): HTMLElement {
    const rows = discounts.map((d) => {
      const actions = el('td', { class: 'row-actions nowrap' });
      const tr = el(
        'tr',
        {},
        el('td', { class: 'num nowrap' }, `−${formatPercent(d.tenths)}`),
        el('td', { class: 'nowrap' }, d.fromGrams === null ? el('span', { class: 'badge badge-warn' }, 'Wpisz, od ilu kg') : `od ${formatKg(d.fromGrams)}`),
        el('td', {}, d.name || el('span', { class: 'muted' }, 'bez nazwy')),
        actions,
      );
      const others = discounts.filter((o) => o !== d);
      const edit = () => {
        const editRow: HTMLTableRowElement = el('tr', {}, el('td', { colspan: '4' }, discountForm(d, others, () => editRow.replaceWith(tr), usingDefaults ? discounts : null)));
        tr.replaceWith(editRow);
      };
      const remove = () => {
        const row = d.row;
        save(actions, 'Usuwam…', row ? () => deps.repo.removeDiscount(row, deps.now()) : writeAll(others), `Usunięto rabat −${formatPercent(d.tenths)}.`);
      };
      let asking = false;
      const normal = () => {
        asking = false;
        actions.replaceChildren(button('Usuń', ask, 'link'));
      };
      const ask = () => {
        asking = true;
        actions.replaceChildren(`Usunąć −${formatPercent(d.tenths)}? `, button('Tak', remove), ' ', button('Nie', normal, 'secondary'));
      };
      normal();
      return clickableRow(tr, edit, `Zmień rabat −${formatPercent(d.tenths)}`, { asking: () => asking });
    });

    return el(
      'section',
      { class: 'product-card' },
      el(
        'h3',
        {},
        'Rabaty hurtowe ',
        infoTip(
          'O ile taniej firma kupuje Twoją kawę. Rabat zależy od wagi kawy na jednej fakturze: obowiązuje od wpisanej wagi (np. od 10 kg, także przy dokładnie 10 kg) do wagi następnego rabatu. Nazwa pojawia się przy cenie w ofercie, żeby klient wiedział, kiedy rabat obowiązuje.',
        ),
      ),
      el('p', { class: 'muted small' }, `Każdy rabat obowiązuje od pewnej wagi kawy na fakturze (najmniejszy od 0 kg) i ma krótką nazwę do oferty (najwyżej ${DISCOUNT_NAME_MAX} znaków). W zakładce Oferta zaznaczasz, które trafią do oferty.`),
      ...(discounts.some((d) => d.fromGrams === null)
        ? [message('Wpisz, od ilu kg kawy na fakturze obowiązuje każdy rabat (kliknij rabat, aby go zmienić). Bez tego Kraken nie dobierze rabatu do faktury.', 'error')]
        : []),
      ...(rows.length > 0
        ? [
            el(
              'table',
              { class: 'data-table discounts-table' },
              el('thead', {}, el('tr', {}, el('th', { scope: 'col', class: 'num' }, 'Rabat'), el('th', { scope: 'col' }, 'Od'), el('th', { scope: 'col' }, 'Nazwa w ofercie'), el('th', { scope: 'col' }, ''))),
              el('tbody', {}, ...rows),
            ),
          ]
        : [el('p', { class: 'muted' }, 'Brak rabatów. Dodaj rabat poniżej.')]),
      discountForm(null, discounts, undefined, usingDefaults ? discounts : null),
    );
  }

  /**
   * Adds a discount (`discount` null) or edits one. `defaults`: the list in use while nothing is saved yet; then the
   * whole new list is written.
   */
  function discountForm(discount: Discount | null, others: readonly Discount[], cancel: (() => void) | undefined, defaults: readonly Discount[] | null): HTMLElement {
    const prefix = `discount-${discount?.tenths ?? 'new'}`;
    const percent = el('input', { id: `${prefix}-percent`, type: 'text', inputmode: 'decimal', autocomplete: 'off', class: 'input-short', placeholder: 'np. 20' });
    percent.value = discount ? percentText(discount.tenths).replace('.', ',') : '';
    const name = el('input', { id: `${prefix}-name`, type: 'text', autocomplete: 'off', placeholder: 'np. Do 10 kg', maxlength: String(DISCOUNT_NAME_MAX) });
    name.value = discount?.name ?? '';
    const from = el('input', { id: `${prefix}-from`, type: 'text', inputmode: 'decimal', autocomplete: 'off', class: 'input-xs', placeholder: 'np. 10' });
    from.value = discount?.fromGrams != null ? kgText(discount.fromGrams).replace('.', ',') : '';
    const errorLine = el('p', { class: 'field-error', role: 'alert' });
    const status = el('div', { class: 'save-status' });
    const form = el(
      'form',
      { class: 'inline-form', novalidate: '' },
      el('label', { for: percent.id, class: 'visually-hidden' }, 'Rabat %'),
      '−',
      percent,
      '% ',
      el('label', { for: from.id }, 'od '),
      from,
      ' kg ',
      el('label', { for: name.id, class: 'visually-hidden' }, 'Nazwa w ofercie'),
      name,
      ' ',
      el('button', { type: 'submit', class: discount ? 'btn btn-primary' : 'btn btn-secondary' }, discount ? 'Zapisz' : 'Dodaj rabat'),
      ...(cancel ? [' ', button('Anuluj', cancel, 'secondary')] : []),
      ' ',
      status,
      errorLine,
    );
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const result = validateDiscount({ percent: percent.value, name: name.value, from: from.value }, others);
      errorLine.textContent = result.ok ? '' : [result.errors.percent, result.errors.from, result.errors.name].filter((t) => t).join(' ');
      if (!result.ok) return;
      const label = `−${formatPercent(result.tenths)}`;
      const row = discount?.row;
      if (defaults) save(status, 'Zapisuję…', writeAll([...defaults.filter((d) => d !== discount), { tenths: result.tenths, name: result.name, fromGrams: result.fromGrams }]), `Zapisano rabat ${label}.`);
      else if (row) save(status, 'Zapisuję…', () => deps.repo.updateDiscount(row, result.fields, deps.now()), `Zapisano rabat ${label}.`);
      else save(status, 'Dodaję…', async () => deps.repo.addDiscounts([result.fields], await deps.whoAmI(), deps.now()), `Dodano rabat ${label}.`);
    });
    if (discount) queueMicrotask(() => percent.focus());
    return form;
  }

  // ---- Bag costs & settings ----

  function bagsNode(views: readonly BagSizeView[], unplaced: readonly BagCost[]): HTMLElement {
    return el(
      'section',
      { class: 'product-card' },
      el(
        'h3',
        {},
        'Opakowania ',
        infoTip('Wszystko w torebce poza kawą: torebka, etykieta, zawór, naklejka. Cena za sztukę, netto. Taka sama dla każdego produktu.'),
      ),
      el('p', { class: 'muted small' }, 'Ile kosztuje Cię jedna torebka każdej wielkości poza kawą (netto, za sztukę).'),
      el('div', { class: 'bag-sizes' }, ...views.map(sizeNode)),
      ...(unplaced.length > 0 ? [unplacedNode(unplaced)] : []),
    );
  }

  /** Items saved for a bag size Kraken does not use (e.g. from before the sizes were fixed): only Delete. */
  function unplacedNode(items: readonly BagCost[]): HTMLElement {
    return el(
      'div',
      { class: 'bag-size' },
      el('h4', {}, 'Nieużywane (stara wielkość torebki)'),
      el(
        'table',
        { class: 'data-table' },
        el(
          'tbody',
          {},
          ...items.map((item) => {
            const actions = el('td', { class: 'row-actions nowrap' });
            actions.replaceChildren(button('Usuń', () => save(actions, 'Usuwam…', () => deps.repo.removeBagCost(item, deps.now()), `Usunięto: ${item.item}.`), 'link'));
            return el('tr', {}, el('td', {}, item.item || '—'), el('td', { class: 'num nowrap' }, item.costGrosze === null ? `„${item.costText}”` : formatPln(item.costGrosze)), actions);
          }),
        ),
      ),
    );
  }

  function settingsNode(settings: CostSettings): HTMLElement {
    return el('section', { class: 'product-card' }, el('h3', {}, 'VAT i ubytek przy paleniu'), settingsForm(settings));
  }

  function settingsForm(settings: CostSettings): HTMLElement {
    const initial = formFromSettings(settings);
    const errors = new Map<keyof SettingsForm, HTMLParagraphElement>();
    const inputs = new Map<keyof SettingsForm, HTMLInputElement>();
    const field = (key: keyof SettingsForm, label: string, hint: string, tip?: string) => {
      const input = el('input', { id: `setting-${key}`, type: 'text', inputmode: 'decimal', autocomplete: 'off', class: 'input-short' });
      input.value = initial[key];
      inputs.set(key, input);
      const error = el('p', { class: 'field-error', role: 'alert' });
      errors.set(key, error);
      return el(
        'div',
        { class: 'field' },
        el('div', { class: 'label-row' }, el('label', { for: input.id }, label), ...(tip ? [infoTip(tip)] : [])),
        input,
        el('p', { class: 'field-hint' }, hint),
        error,
      );
    };
    const status = el('div', { class: 'save-status' });
    const form = el(
      'form',
      { class: 'lot-form', novalidate: '' },
      el(
        'div',
        { class: 'fields' },
        field('vat', 'VAT %', 'Zwykle 23.', 'Podatek doliczany do Twojej ceny. Torebka za 48 zł netto kosztuje z 23 % VAT 59,04 zł.'),
        field(
          'defaultLoss',
          'Zwykły ubytek przy paleniu %',
          'Używany dla dostawy bez wypałów i dla planowanego ziarna.',
          'Ziarno przy paleniu traci na wadze. Przy 15 % ubytku z 1 kg zielonego ziarna jest 850 g palonej kawy. Używany, dopóki dostawa nie ma własnych wypałów.',
        ),
      ),
      el('div', { class: 'actions' }, el('button', { type: 'submit', class: 'btn btn-primary' }, 'Zapisz ustawienia')),
      status,
    );
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const read = (key: keyof SettingsForm) => inputs.get(key)?.value ?? '';
      const result = validateSettingsForm({ vat: read('vat'), defaultLoss: read('defaultLoss') });
      for (const [key, line] of errors) line.textContent = result.ok ? '' : (result.errors[key] ?? '');
      if (!result.ok) return;
      const loaded = data?.settings ?? [];
      save(status, 'Zapisuję…', () => deps.repo.saveSettings(result.values, loaded, deps.whoAmI, deps.now()), 'Zapisano ustawienia.');
    });
    return form;
  }

  function sizeNode(view: BagSizeView): HTMLElement {
    const rows = view.costs.map((cost) => costRow(cost, view));
    return el(
      'div',
      { class: 'bag-size' },
      el('h4', {}, `${view.label} `, el('span', { class: 'muted small' }, view.costs.length === 0 ? 'nic jeszcze nie wpisano' : `razem: ${view.itemsText}`)),
      ...(rows.length > 0
        ? [
            el(
              'table',
              { class: 'data-table' },
              el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, 'Pozycja'), el('th', { scope: 'col', class: 'num' }, 'Koszt netto na torebkę'), el('th', { scope: 'col' }, ''))),
              el('tbody', {}, ...rows),
            ),
          ]
        : []),
      costForm(view, null),
    );
  }

  function costRow(cost: BagCost, view: BagSizeView): HTMLTableRowElement {
    const actions = el('td', { class: 'row-actions nowrap' });
    const tr = el(
      'tr',
      {},
      el('td', {}, cost.item),
      el('td', { class: 'num nowrap' }, cost.costGrosze === null ? `„${cost.costText}”` : formatPln(cost.costGrosze)),
      actions,
    );
    const edit = () => {
      const editRow: HTMLTableRowElement = el('tr', {}, el('td', { colspan: '3' }, costForm(view, cost, () => editRow.replaceWith(tr))));
      tr.replaceWith(editRow);
    };
    let asking = false;
    const normal = () => {
      asking = false;
      actions.replaceChildren(button('Usuń', ask, 'link'));
    };
    const ask = () => {
      asking = true;
      actions.replaceChildren(
        `Usunąć ${cost.item}? `,
        button('Tak', () => save(actions, 'Usuwam…', () => deps.repo.removeBagCost(cost, deps.now()), `Usunięto: ${cost.item} (${view.label}).`)),
        ' ',
        button('Nie', normal, 'secondary'),
      );
    };
    normal();
    return clickableRow(tr, edit, `Zmień ${cost.item} (${view.label})`, { asking: () => asking });
  }

  /** Adds a cost item to a size (`cost` null), or edits one. */
  function costForm(view: BagSizeView, cost: BagCost | null, cancel?: () => void): HTMLElement {
    const initial: BagCostForm = cost ? formFromBagCost(cost) : { item: '', cost: '' };
    const prefix = `cost-${view.id}-${cost?.id ?? 'new'}`;
    const item = el('input', { id: `${prefix}-item`, type: 'text', autocomplete: 'off', placeholder: 'np. Torebka' });
    item.value = initial.item;
    const amount = el('input', { id: `${prefix}-cost`, type: 'text', inputmode: 'decimal', autocomplete: 'off', class: 'input-short', placeholder: 'zł netto' });
    amount.value = initial.cost;
    const errorLine = el('p', { class: 'field-error', role: 'alert' });
    const status = el('div', { class: 'save-status' });
    const form = el(
      'form',
      { class: 'inline-form', novalidate: '' },
      el('label', { for: item.id, class: 'visually-hidden' }, 'Pozycja'),
      item,
      ' ',
      el('label', { for: amount.id, class: 'visually-hidden' }, 'Koszt netto na torebkę (zł)'),
      amount,
      ' zł ',
      el('button', { type: 'submit', class: cost ? 'btn btn-primary' : 'btn btn-secondary' }, cost ? 'Zapisz' : `Dodaj pozycję do ${view.label}`),
      ...(cancel ? [' ', button('Anuluj', cancel, 'secondary')] : []),
      ' ',
      status,
      errorLine,
    );
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const result = validateBagCostForm({ item: item.value, cost: amount.value });
      errorLine.textContent = result.ok ? '' : [result.errors.item, result.errors.cost].filter((t) => t).join(' ');
      if (!result.ok) return;
      if (cost) save(status, 'Zapisuję…', () => deps.repo.updateBagCost(cost, result.fields, deps.now()), `Zapisano: ${result.fields.item} (${view.label}).`);
      else
        save(
          status,
          'Dodaję…',
          async () => deps.repo.addBagCost({ ...result.fields, bag_size_id: view.id }, await deps.whoAmI(), deps.now()),
          `Dodano ${result.fields.item} do ${view.label}.`,
        );
    });
    if (cost) queueMicrotask(() => item.focus());
    return form;
  }

  load(note, fromClick);
}
