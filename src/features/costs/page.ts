// The Costs & prices screen: per lot, what one bag costs and the suggested prices; below, the settings for the
// calculation (VAT, markups, default roast loss, bag sizes and their cost items). Everything from outside comes
// through CostsPageDeps (main.ts provides it).

import { formatKg, formatPln } from '../../core/numbers';
import { busy, button, el, infoTip, message } from '../../ui/dom';
import { googleErrorNodes } from '../../ui/googleErrors';
import { formFromLot, type Lot, type LotsRepository } from '../lots';
import type { Roast, RoastsRepository } from '../roasts';
import {
  formFromBagCost,
  formFromSettings,
  formatPercent,
  percentText,
  readSettings,
  validateBagCostForm,
  typedPricePerKg,
  validateLoss,
  validatePriceForm,
  validateSettingsForm,
  type BagCost,
  type BagCostForm,
  type CostSettings,
  type PriceForm,
  type SettingsForm,
} from './model';
import { bagSizeViews, lotCards, type BagSizeView, type LotCard } from './present';
import type { CostData, CostsRepository } from './repo';

export interface CostsPageDeps {
  repo: CostsRepository;
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
  /** Kraken is saving to Google (true) or done (false): Back and the menu wait meanwhile. */
  busy: (on: boolean) => void;
}

type SubTab = 'lots' | 'bags';

export function showCostsPage(root: HTMLElement, deps: CostsPageDeps, note?: string, fromClick = false): void {
  let data: CostData | null = null;
  let lots: Lot[] = [];
  let roasts: Roast[] = [];
  /** Which part of the page is shown; kept when the page reloads after a save. */
  let tab: SubTab = 'lots';

  const render = (...children: (Node | string)[]) => root.replaceChildren(...children);

  function load(note?: string, fromClick = false): void {
    render(el('p', {}, busy('Loading costs…')));
    const all = () => Promise.all([deps.repo.load(), deps.lots.load(), deps.roasts.load()]);
    (fromClick ? deps.withGoogle(all) : all())
      .then(([costs, l, r]) => {
        if (!root.isConnected) return;
        data = costs;
        lots = l.lots;
        roasts = r.roasts;
        showPage(note);
      })
      .catch((error: unknown) => {
        if (!root.isConnected || deps.isIgnorable(error)) return;
        const show = (e: unknown) =>
          render(
            ...googleErrorNodes(e, deps, {
              retry: () => load(),
              retryLabel: 'Sign in and show costs',
              show,
              other: { label: 'Try again', action: () => load(undefined, true), mayHaveSaved: false },
              signedOutNote: 'Nothing was lost.',
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
   * a spinner. If it fails, the page stays as it is (what the owner typed is kept) and `slot` explains the error,
   * with "Sign in and try again" / "Reload costs".
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
              retryLabel: 'Sign in and try again',
              show,
              other: { label: 'Reload costs (drops what you typed)', action: () => load(undefined, true), mayHaveSaved: true },
            }),
          );
        show(error);
      });
  }

  function showPage(note?: string): void {
    if (!data) return;
    const loaded = data;
    const { settings, problems: settingProblems } = readSettings(loaded.settings);
    const { views, problems: sizeProblems } = bagSizeViews(loaded.costs);
    const { cards, problems: cardProblems } = lotCards(lots, roasts, loaded.lotCosts, views, settings);
    const problems = [...loaded.problems, ...settingProblems, ...sizeProblems, ...cardProblems];
    const noBagCosts = views.every((v) => v.costs.length === 0);

    const subTab = (label: string, name: SubTab) => {
      const b = button(label, () => ((tab = name), showPage()), 'link');
      if (name === tab) b.setAttribute('aria-current', 'page');
      return b;
    };
    render(
      el('div', { class: 'page-head' }, el('h2', {}, 'Costs & prices')),
      el('nav', { class: 'sub-nav', 'aria-label': 'Costs & prices' }, subTab('Prices per lot', 'lots'), subTab('Bag costs & settings', 'bags')),
      ...(note ? [message(note)] : []),
      ...problems.map((text) => message(text, 'error')),
      ...(tab === 'lots'
        ? [
            el(
              'p',
              { class: 'muted small' },
              `All costs are net. A suggested price is the cost of one bag × the markup (net); gross = net + VAT ${formatPercent(settings.vatTenths)}.`,
            ),
            ...(noBagCosts
              ? [el('p', { class: 'message muted' }, 'Enter what goes into a bag (bag, label, …) to see the cost of one bag. ', button('Go to Bag costs & settings', () => ((tab = 'bags'), showPage()), 'link'))]
              : []),
            ...(cards.length === 0 ? [el('p', { class: 'muted' }, 'No lots yet. Add them on the Lots page.')] : cards.map(cardNode)),
          ]
        : [bagsNode(views), settingsNode(settings)]),
    );
  }

  // ---- A lot ----

  function cardNode(card: LotCard): HTMLElement {
    const priceLine = priceNode(card);
    const lossLine = el('p', { class: 'cost-line' });
    const showLoss = () => {
      lossLine.replaceChildren(
        el('span', { class: 'cost-label' }, 'Roast loss'),
        el('strong', {}, card.loss),
        ' ',
        el('span', { class: 'muted small' }, `(${card.lossSource})`),
        ' ',
        button('Change', editLoss, 'link'),
      );
    };
    const editLoss = () => {
      const input = el('input', { type: 'text', inputmode: 'decimal', id: `loss-${card.lot.id}`, class: 'input-short', autocomplete: 'off' });
      const shown = percentText(card.lossTenths).replace('.', ',');
      input.value = card.ownLoss?.lossTenths != null ? shown : '';
      input.placeholder = shown;
      const errorLine = el('span', { class: 'field-error', role: 'alert' });
      const status = el('div', { class: 'save-status' });
      const submit = (value: string) => {
        const result = validateLoss(value);
        if (!result.ok) {
          errorLine.textContent = result.error;
          return;
        }
        save(
          status,
          'Saving…',
          () => deps.repo.saveLoss(card.lot.id, result.value, card.ownLoss, deps.whoAmI, deps.now()),
          result.value === '' ? `${card.lot.code}: roast loss back to the average of its roasts.` : `${card.lot.code}: roast loss saved.`,
        );
      };
      const form = el(
        'form',
        { class: 'inline-form', novalidate: '' },
        el('label', { for: input.id }, 'Roast loss % '),
        input,
        ' ',
        el('button', { type: 'submit', class: 'btn btn-primary' }, 'Save'),
        ' ',
        ...(card.ownLoss?.lossTenths != null ? [button('Use the average', () => submit(''), 'secondary'), ' '] : []),
        button('Cancel', showLoss, 'secondary'),
        ' ',
        status,
        errorLine,
      );
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        submit(input.value);
      });
      lossLine.replaceChildren(form);
      input.focus();
    };
    showLoss();

    const line = (label: string, value: string, tip?: string) =>
      el('p', { class: 'cost-line' }, el('span', { class: 'cost-label' }, label, ...(tip ? [' ', infoTip(tip)] : [])), el('strong', {}, value));

    const body: Node[] = card.missing
      ? [message(card.missing, 'error'), priceLine, lossLine]
      : [
          priceLine,
          line('Green price', card.greenPerKg, 'Coffee price + delivery cost, ÷ kg delivered (net).'),
          lossLine,
          line('Roasted from 1 kg green', card.roastedFromKg),
          line('Cost of 1 kg roasted', card.roastedPerKg, 'Green price per kg ÷ (1 − roast loss).'),
          ...(card.bags.length > 0 ? [bagTable(card)] : []),
        ];
    return el(
      'section',
      { class: 'cost-card' },
      el('h3', {}, card.title),
      ...(card.subtitle ? [el('p', { class: 'muted small' }, card.subtitle)] : []),
      ...body,
    );
  }

  function bagTable(card: LotCard): HTMLElement {
    const head = el('tr', {}, el('th', { scope: 'col' }, ''), ...card.bags.map((b) => el('th', { scope: 'col', class: 'num' }, b.label)));
    const row = (label: string, values: readonly string[], strong = false, missing: readonly boolean[] = []) =>
      el(
        'tr',
        strong ? { class: 'row-total' } : {},
        el('th', { scope: 'row' }, label),
        ...values.map((v, i) => el('td', { class: `num nowrap${missing[i] ? ' muted' : ''}` }, v)),
      );
    const markups = card.bags.find((b) => b.prices.length > 0)?.prices.map((p) => p.markup) ?? [];
    const priceRows = markups.flatMap((markup, i) => [
      row(`Price at ${markup}, net`, card.bags.map((b) => b.prices[i]?.net ?? '—'), false, card.bags.map((b) => b.missing)),
      row(`Price at ${markup}, gross`, card.bags.map((b) => b.prices[i]?.gross ?? '—'), true, card.bags.map((b) => b.missing)),
    ]);
    return el(
      'div',
      { class: 'table-wrap' },
      el(
        'table',
        { class: 'data-table cost-table' },
        el('thead', {}, head),
        el(
          'tbody',
          {},
          row('Roasted coffee', card.bags.map((b) => b.coffee)),
          row('Bag, label and other items', card.bags.map((b) => b.items), false, card.bags.map((b) => b.missing)),
          row('Cost of one bag', card.bags.map((b) => b.total), true, card.bags.map((b) => b.missing)),
          ...priceRows,
        ),
      ),
    );
  }

  // ---- The lot's price (stored on the Lots tab; edited here, owner 2026-11-16) ----

  function priceNode(card: LotCard): HTMLElement {
    const lot = card.lot;
    const initial: PriceForm = (({ coffeePrice, deliveryCost }) => ({ coffeePrice, deliveryCost }))(formFromLot(lot));
    const holder = el('div', {});
    const amount = (grosze: number | null, typed: string) => (grosze !== null ? formatPln(grosze) : typed !== '' ? `"${typed}"` : '—');
    const showPrice = () => {
      holder.replaceChildren(
        el(
          'p',
          { class: 'cost-line' },
          el('span', { class: 'cost-label' }, 'Price, whole delivery ', infoTip('Net. Not imported from RoasTime. Stored with the lot.')),
          ...(lot.coffeePriceGrosze === null && initial.coffeePrice === ''
            ? [el('span', { class: 'badge' }, 'Price missing')]
            : [el('strong', {}, amount(lot.coffeePriceGrosze, initial.coffeePrice)), ` + delivery ${amount(lot.deliveryCostGrosze, initial.deliveryCost)}`]),
          ...(lot.quantityGrams !== null ? [` for ${formatKg(lot.quantityGrams)}`] : []),
          ' ',
          button(lot.coffeePriceGrosze === null ? 'Add price' : 'Edit price', editPrice, 'link'),
        ),
      );
    };
    const editPrice = () => {
      const input = (key: keyof PriceForm, label: string) => {
        const node = el('input', { id: `${key}-${lot.id}`, type: 'text', inputmode: 'decimal', autocomplete: 'off', class: 'input-money' });
        node.value = initial[key];
        return { node, label: el('label', { for: node.id }, label) };
      };
      const price = input('coffeePrice', 'Coffee price (zł net)');
      const delivery = input('deliveryCost', 'Delivery cost (zł net)');
      const perKg = el('output', { class: 'muted small', 'aria-live': 'polite' });
      const read = (): PriceForm => ({ coffeePrice: price.node.value, deliveryCost: delivery.node.value });
      const update = () => {
        const value = typedPricePerKg(read(), lot.quantityGrams);
        perKg.textContent = value === null ? 'Green price per kg: shown when the price is filled in.' : `Green price per kg: ${formatPln(value)}`;
      };
      price.node.addEventListener('input', update);
      delivery.node.addEventListener('input', update);
      update();
      const errorLine = el('p', { class: 'field-error', role: 'alert' });
      const status = el('div', { class: 'save-status' });
      const form = el(
        'form',
        { class: 'inline-form', novalidate: '' },
        price.label,
        price.node,
        delivery.label,
        delivery.node,
        el('button', { type: 'submit', class: 'btn btn-primary' }, 'Save'),
        button('Cancel', showPrice, 'secondary'),
        perKg,
        status,
        errorLine,
      );
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        const result = validatePriceForm(read(), initial);
        errorLine.textContent = result.ok ? '' : [result.errors.coffeePrice, result.errors.deliveryCost].filter((t) => t).join(' ');
        if (!result.ok) return;
        if (Object.keys(result.fields).length === 0) {
          showPrice();
          return;
        }
        save(status, 'Saving…', () => deps.lots.update(lot, result.fields, deps.now()).then(() => undefined), `${lot.code}: price saved.`);
      });
      holder.replaceChildren(form);
      price.node.focus();
    };
    showPrice();
    return holder;
  }

  // ---- Bag costs & settings ----

  function bagsNode(views: readonly BagSizeView[]): HTMLElement {
    return el(
      'section',
      {},
      el('h3', {}, 'What goes into one bag'),
      el('p', { class: 'muted small' }, 'Net cost per bag of each item: the bag, the label, a valve, a stamp… A size with no items shows "missing cost" on the lot cards.'),
      el('div', { class: 'bag-sizes' }, ...views.map(sizeNode)),
    );
  }

  function settingsNode(settings: CostSettings): HTMLElement {
    return el('section', { class: 'cost-settings' }, el('h3', {}, 'Settings'), settingsForm(settings));
  }

  function settingsForm(settings: CostSettings): HTMLElement {
    const initial = formFromSettings(settings);
    const errors = new Map<keyof SettingsForm, HTMLParagraphElement>();
    const inputs = new Map<keyof SettingsForm, HTMLInputElement>();
    const field = (key: keyof SettingsForm, label: string, hint: string) => {
      const input = el('input', { id: `setting-${key}`, type: 'text', inputmode: key === 'markups' ? 'text' : 'decimal', autocomplete: 'off' });
      input.value = initial[key];
      inputs.set(key, input);
      const error = el('p', { class: 'field-error', role: 'alert' });
      errors.set(key, error);
      return el('div', { class: 'field' }, el('label', { for: input.id }, label), input, el('p', { class: 'field-hint' }, hint), error);
    };
    const status = el('div', { class: 'save-status' });
    const form = el(
      'form',
      { class: 'lot-form', novalidate: '' },
      el(
        'div',
        { class: 'fields' },
        field('vat', 'VAT %', 'Added to net prices.'),
        field('markups', 'Markups', 'Separated by ";", e.g. 2; 2,5; 3.'),
        field('defaultLoss', 'Default roast loss %', 'For a lot with no roasts yet.'),
      ),
      el('div', { class: 'actions' }, el('button', { type: 'submit', class: 'btn btn-primary' }, 'Save settings')),
      status,
    );
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const read = (key: keyof SettingsForm) => inputs.get(key)?.value ?? '';
      const result = validateSettingsForm({ vat: read('vat'), markups: read('markups'), defaultLoss: read('defaultLoss') });
      for (const [key, line] of errors) line.textContent = result.ok ? '' : (result.errors[key] ?? '');
      if (!result.ok) return;
      const loaded = data?.settings ?? [];
      save(status, 'Saving…', () => deps.repo.saveSettings(result.values, loaded, deps.whoAmI, deps.now()), 'Settings saved.');
    });
    return form;
  }

  function sizeNode(view: BagSizeView): HTMLElement {
    const rows = view.costs.map((cost) => costRow(cost, view));
    return el(
      'div',
      { class: 'bag-size' },
      el('h4', {}, `${view.label} `, el('span', { class: 'muted small' }, `items together: ${view.itemsText}`)),
      ...(rows.length > 0
        ? [
            el(
              'table',
              { class: 'data-table' },
              el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, 'Item'), el('th', { scope: 'col', class: 'num' }, 'Net cost per bag'), el('th', { scope: 'col' }, ''))),
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
      el('td', { class: 'num nowrap' }, cost.costGrosze === null ? `"${cost.costText}"` : formatPln(cost.costGrosze)),
      actions,
    );
    const edit = () => {
      const editRow: HTMLTableRowElement = el('tr', {}, el('td', { colspan: '3' }, costForm(view, cost, () => editRow.replaceWith(tr))));
      tr.replaceWith(editRow);
    };
    const normal = () => actions.replaceChildren(button('Edit', edit, 'link'), button('Delete', ask, 'link'));
    const ask = () =>
      actions.replaceChildren(
        `Delete ${cost.item}? `,
        button('Yes', () => save(actions, 'Deleting…', () => deps.repo.removeBagCost(cost, deps.now()), `${cost.item} (${view.label}) deleted.`)),
        ' ',
        button('No', normal, 'secondary'),
      );
    normal();
    return tr;
  }

  /** Adds a cost item to a size (`cost` null), or edits one. */
  function costForm(view: BagSizeView, cost: BagCost | null, cancel?: () => void): HTMLElement {
    const initial: BagCostForm = cost ? formFromBagCost(cost) : { item: '', cost: '' };
    const prefix = `cost-${view.id}-${cost?.id ?? 'new'}`;
    const item = el('input', { id: `${prefix}-item`, type: 'text', autocomplete: 'off', placeholder: 'e.g. Bag' });
    item.value = initial.item;
    const amount = el('input', { id: `${prefix}-cost`, type: 'text', inputmode: 'decimal', autocomplete: 'off', class: 'input-short', placeholder: 'zł net' });
    amount.value = initial.cost;
    const errorLine = el('p', { class: 'field-error', role: 'alert' });
    const status = el('div', { class: 'save-status' });
    const form = el(
      'form',
      { class: 'inline-form', novalidate: '' },
      el('label', { for: item.id, class: 'visually-hidden' }, 'Item'),
      item,
      ' ',
      el('label', { for: amount.id, class: 'visually-hidden' }, 'Net cost per bag (zł)'),
      amount,
      ' zł ',
      el('button', { type: 'submit', class: cost ? 'btn btn-primary' : 'btn btn-secondary' }, cost ? 'Save' : `Add item to ${view.label}`),
      ...(cancel ? [' ', button('Cancel', cancel, 'secondary')] : []),
      ' ',
      status,
      errorLine,
    );
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const result = validateBagCostForm({ item: item.value, cost: amount.value });
      errorLine.textContent = result.ok ? '' : [result.errors.item, result.errors.cost].filter((t) => t).join(' ');
      if (!result.ok) return;
      if (cost) save(status, 'Saving…', () => deps.repo.updateBagCost(cost, result.fields, deps.now()), `${result.fields.item} (${view.label}) saved.`);
      else
        save(
          status,
          'Adding…',
          async () => deps.repo.addBagCost({ ...result.fields, bag_size_id: view.id }, await deps.whoAmI(), deps.now()),
          `${result.fields.item} added to ${view.label}.`,
        );
    });
    if (cost) queueMicrotask(() => item.focus());
    return form;
  }

  load(note, fromClick);
}
