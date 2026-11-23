// The planner (owner, 2026-11-19): a product's beans and its prices, worked out live. One piece, used in two places
// so they never drift apart: the product form (saved with the product) and the Product planner tab (a scratchpad, nothing
// saved). Beans on the left (up to 3, shares on one bar), prices on the right (cost of one bag, suggestions, what a
// price earns, every step explained). The rules are in domain/blend.ts and present.ts (costing).

import { formatPln, parseMoney } from '../../core/numbers';
import { plural } from '../../core/polish';
import { BAG_SIZES_G, formatBagSize, type BagSize } from '../../domain/bagSizes';
import { BASE_GRAMS, MAX_BEANS, dividersOf, evenShares, moveDivider, typeShare } from '../../domain/blend';
import { DEFAULT_SETTINGS, activeDiscounts, pricingFor, type BeanLot, type CostSettings, type CostsRepository, type Discount } from '../costs';
import type { LotsRepository } from '../lots';
import type { RoastsRepository } from '../roasts';
import { button, el, infoTip } from '../../ui/dom';
import type { BeanForm } from './modelBeans';
import { compareRow, costing, followingPrices, priceRows, sortCompared, type ComparedRow } from './present';
import { MARGIN_TIP, compareTable, costsBySize, pricesTable } from './priceTable';

/** What the planner needs from the rest of Kraken: VAT and the usual loss, every lot as a bean, packaging per size. */
export interface PlannerData {
  readonly settings: CostSettings;
  readonly discounts: Discount[];
  readonly beanLots: BeanLot[];
  readonly packaging: ReadonlyMap<number, number | null>;
  readonly problems: string[];
}

/**
 * Loads the planner's data (Packaging & discounts, Lots, Roasts). If it cannot be read, the defaults are used with a
 * note, so a page still opens; a signed-out or superseded sign-in is passed on.
 */
export async function loadPlannerData(sources: {
  costs: CostsRepository;
  lots: LotsRepository;
  roasts: RoastsRepository;
  isSignedOut: (error: unknown) => boolean;
  isIgnorable: (error: unknown) => boolean;
  describeError: (error: unknown) => string;
}): Promise<PlannerData> {
  try {
    const [costs, lots, roasts] = await Promise.all([sources.costs.load(), sources.lots.load(), sources.roasts.load()]);
    const found = pricingFor(costs, lots.lots, roasts.roasts);
    return { settings: found.settings, discounts: found.discounts, beanLots: found.lots, packaging: found.packaging, problems: [...costs.problems, ...found.problems] };
  } catch (error) {
    if (sources.isSignedOut(error) || sources.isIgnorable(error)) throw error;
    const problem = `Nie udało się wczytać opakowań, rabatów i dostaw (${sources.describeError(error)}); używane są domyślne VAT i rabaty.`;
    return { settings: DEFAULT_SETTINGS, discounts: activeDiscounts([]).discounts, beanLots: [], packaging: new Map(), problems: [problem] };
  }
}

/** What the planner starts with: the beans and the price typed for each size ("45", or '' for none). */
export interface PlannerStart {
  readonly beans: readonly BeanForm[];
  readonly prices: Readonly<Partial<Record<BagSize, string>>>;
}

export interface Planner {
  /** Beans on the left, prices on the right (stacked on a narrow screen). */
  readonly node: HTMLElement;
  /** The beans as they are now. */
  beans(): BeanForm[];
  /** The price typed for each size, as typed. */
  prices(): Record<BagSize, string>;
  /** Shows what is wrong with the beans ('' clears it). */
  showBeanErrors(text: string): void;
  /** Shows what is wrong with each price (missing sizes clear); focuses the first one when asked. */
  showPriceErrors(errors: Partial<Record<BagSize, string>>, focus?: boolean): void;
}

/** A bean's name for the screen: its lot, or the planned bean's name, else "Bean 2". */
export function beanName(form: BeanForm, i: number, beanLots: readonly BeanLot[]): string {
  return form.kind === 'lot' ? (beanLots.find((l) => l.lotId === form.lotId)?.label ?? `Ziarno ${i + 1}`) : form.plannedName.trim() || `Ziarno ${i + 1}`;
}

export function createPlanner(
  data: Pick<PlannerData, 'settings' | 'beanLots' | 'packaging'>,
  start: PlannerStart,
  options: {
    pricesTitle: string;
    pricesIntro: string;
    onChange?: (plan: PlannerStart) => void;
    /**
     * The Product planner's extras (owner, 2026-11-19), not in the product form: the wholesale prices of what is
     * typed, and the plan next to the existing products.
     */
    extra?: {
      discounts: readonly { tenths: number; name: string }[];
      products: readonly { name: string; beans: readonly BeanForm[]; prices: Readonly<Partial<Record<number, number>>> }[];
    };
  },
): Planner {
  const { settings, beanLots, packaging } = data;
  const priceInputs = {} as Record<BagSize, HTMLInputElement>;
  const priceErrors = {} as Record<BagSize, HTMLParagraphElement>;
  for (const grams of BAG_SIZES_G) {
    const id = `price-${grams}`;
    priceInputs[grams] = el('input', { id, type: 'text', autocomplete: 'off', inputmode: 'decimal', class: 'input-money', placeholder: '—', 'aria-describedby': `${id}-error` });
    priceInputs[grams].value = start.prices[grams] ?? '';
    priceErrors[grams] = el('p', { class: 'field-error', id: `${id}-error`, role: 'alert' });
  }

  // ---- The beans: up to 3, each a lot or a planned bean. Their shares are set on one bar: drag the divider between
  // two colours, or type a percentage (owner, 2026-11-19: easier than one slider per bean). ----
  // A bean whose lot is no longer on the Lots page starts empty, so the owner chooses another (it is never kept).
  let beanForms: BeanForm[] = start.beans.map((f) => (f.kind === 'lot' && f.lotId !== '' && !beanLots.some((l) => l.lotId === f.lotId) ? { ...f, lotId: '' } : { ...f }));
  const beansHolder = el('div', { class: 'beans' });
  const beansError = el('p', { class: 'field-error', role: 'alert' });
  const splitHolder = el('div', { class: 'split-holder' });
  /** The parts of the bar, its dividers and the typed percentages, updated in place while dragging (keeps focus). */
  let parts: HTMLElement[] = [];
  let dividers: HTMLInputElement[] = [];
  let shareInputs: HTMLInputElement[] = [];
  let legendNames: HTMLElement[] = [];

  const shares = () => beanForms.map((f) => f.sharePercent);
  const applyShares = (next: readonly number[]) =>
    next.forEach((share, k) => {
      const f = beanForms[k];
      if (f) f.sharePercent = share;
    });

  const showSplit = () => {
    const at = dividersOf(shares());
    beanForms.forEach((form, i) => {
      const part = parts[i];
      if (part) {
        part.style.flex = String(form.sharePercent);
        part.textContent = form.sharePercent >= 8 ? `${form.sharePercent} %` : '';
      }
      const input = shareInputs[i];
      if (input && document.activeElement !== input) input.value = String(form.sharePercent);
      const name = legendNames[i];
      if (name) name.textContent = beanName(form, i, beanLots);
    });
    dividers.forEach((d, k) => (d.value = String(at[k] ?? 0)));
  };

  const renderSplit = () => {
    parts = [];
    dividers = [];
    shareInputs = [];
    legendNames = [];
    if (beanForms.length < 2) {
      splitHolder.replaceChildren(...(beanForms.length === 1 ? [el('p', { class: 'muted small' }, 'Jedno ziarno: to 100 % torebki. Dodaj kolejne, aby zrobić mieszankę.')] : []));
      return;
    }
    const bar = el('div', { class: 'split-bar', 'aria-hidden': 'true' });
    parts = beanForms.map((_, i) => el('span', { class: `split-part bean-colour-${i + 1}` }));
    bar.append(...parts);
    dividers = dividersOf(shares()).map((_, k) => {
      const range = el('input', { type: 'range', min: '0', max: '100', step: '1', class: 'split-divider', 'aria-label': `Granica między ziarnem ${k + 1} a ziarnem ${k + 2}` });
      range.addEventListener('input', () => {
        applyShares(moveDivider(shares(), k, Number(range.value)));
        showSplit();
        update();
      });
      return range;
    });
    const legend = el(
      'div',
      { class: 'split-legend' },
      ...beanForms.map((_, i) => {
        const input = el('input', { type: 'text', inputmode: 'numeric', class: 'split-input', id: `bean-${i}-share`, autocomplete: 'off' });
        input.addEventListener('input', () => {
          const value = Number(input.value.trim());
          if (input.value.trim() === '' || !Number.isInteger(value)) return;
          applyShares(typeShare(shares(), i, value));
          showSplit();
          update();
        });
        input.addEventListener('blur', showSplit); // shows the share as kept (e.g. after typing more than allowed)
        shareInputs.push(input);
        const name = el('span', { class: 'split-name' });
        legendNames.push(name);
        return el('label', { class: 'split-item', for: input.id }, el('span', { class: `dot bean-colour-${i + 1}` }), name, input, '%');
      }),
    );
    splitHolder.replaceChildren(el('div', { class: 'split' }, bar, ...dividers), legend);
    showSplit();
  };

  const renderBeans = () => {
    beansHolder.replaceChildren(
      ...beanForms.map((form, i) => {
        const row = el('div', { class: `bean-row bean-${i + 1}` });
        const kind = el('select', { id: `bean-${i}-kind`, 'aria-label': `Ziarno ${i + 1}: skąd pochodzi` });
        kind.append(el('option', { value: 'lot' }, 'Dostawa z zakładki Zielone ziarno'), el('option', { value: 'planned' }, 'Planowane ziarno (jeszcze niekupione)'));
        kind.value = form.kind;
        kind.addEventListener('change', () => {
          form.kind = kind.value === 'planned' ? 'planned' : 'lot';
          renderBeans();
          update();
        });
        const what: Node[] = [];
        if (form.kind === 'lot') {
          const lot = el('select', { id: `bean-${i}-lot`, 'aria-label': `Ziarno ${i + 1}: dostawa` });
          lot.append(el('option', { value: '' }, 'Wybierz dostawę…'));
          for (const l of beanLots) lot.append(el('option', { value: l.lotId }, `${l.label} · ${l.greenPerKg === null ? 'jeszcze bez ceny' : `${formatPln(Math.round(l.greenPerKg))} za kg`}`));
          lot.value = form.lotId;
          lot.addEventListener('change', () => {
            form.lotId = lot.value;
            showSplit();
            update();
          });
          what.push(lot);
        } else {
          const input = (key: 'plannedName' | 'plannedPrice' | 'plannedLoss', label: string, attrs: Record<string, string>) => {
            const node = el('input', { id: `bean-${i}-${key}`, type: 'text', autocomplete: 'off', ...attrs });
            node.value = form[key];
            node.addEventListener('input', () => {
              form[key] = node.value;
              if (key === 'plannedName') showSplit();
              update();
            });
            return el('label', { class: 'bean-field', for: node.id }, el('span', { class: 'bean-field-label' }, label), node);
          };
          what.push(
            input('plannedName', 'Nazwa', { placeholder: 'np. Etiopia z oferty' }),
            input('plannedPrice', 'Cena za kg (zł)', { inputmode: 'decimal', class: 'input-money', placeholder: 'np. 52,50' }),
            input('plannedLoss', 'Ubytek przy paleniu %', { inputmode: 'decimal', class: 'input-short', placeholder: String(settings.defaultLossTenths / 10).replace('.', ',') }),
            infoTip('Cena z oferty za 1 kg zielonego ziarna, z dostawą i bez VAT. Zostaw ubytek pusty, aby użyć zwykłego.'),
          );
        }
        const remove = button(
          'Usuń',
          () => {
            const removed = beanForms[i]?.sharePercent ?? 0;
            beanForms = beanForms.filter((_, k) => k !== i);
            const tail = beanForms[beanForms.length - 1];
            if (tail) tail.sharePercent += removed; // its share goes to the last bean, so the total stays 100 %
            if (beanForms.length === 1 && beanForms[0]) beanForms[0].sharePercent = 100;
            renderBeans();
            update();
          },
          'link',
        );
        row.append(el('div', { class: 'bean-head' }, el('span', { class: `dot bean-colour-${i + 1}` }), el('strong', {}, `Ziarno ${i + 1}`), kind, remove), el('div', { class: 'bean-what' }, ...what));
        return row;
      }),
      ...(beanForms.length < MAX_BEANS
        ? [
            button(
              beanForms.length === 0 ? 'Wybierz ziarno' : 'Dodaj kolejne ziarno',
              () => {
                const even = evenShares(beanForms.length + 1);
                const added: BeanForm = { kind: 'lot', lotId: '', plannedName: '', plannedPrice: '', plannedLoss: '', sharePercent: 0 };
                beanForms = [...beanForms, added].map((f, k): BeanForm => ({ ...f, sharePercent: even[k] ?? 0 }));
                renderBeans();
                update();
              },
              'secondary',
            ),
          ]
        : []),
    );
    renderSplit();
  };

  const beansSection = el(
    'fieldset',
    { class: 'form-section' },
    el('legend', {}, 'Skład'),
    el(
      'p',
      { class: 'muted small' },
      `Najwyżej ${MAX_BEANS} ${plural(MAX_BEANS, 'ziarno', 'ziarna', 'ziaren')}: dostawy, które masz, albo planowane ziarno, które myślisz kupić. `,
      infoTip('Przeciągnij białą granicę na pasku, aby zmienić, ile torebki stanowi każde ziarno, albo wpisz procent. Udziały zawsze dają razem 100 %.'),
    ),
    splitHolder,
    beansHolder,
    beansError,
  );

  // ---- Prices: one row per size, the price in zł, suggested prices to click and what the price earns ----
  const chipHolders = new Map<BagSize, HTMLElement>();
  /** What the price earns, per size: the texts change; the margin ⓘ is made once (never rebuilt while typing). */
  const earnHolders = new Map<BagSize, { box: HTMLElement; texts: HTMLElement; tip: HTMLElement; cost: HTMLElement }>();
  /** "How is this worked out?" of each size: created once, so it stays open while the shares or prices change. */
  const howHolders = new Map<BagSize, { box: HTMLDetailsElement; list: HTMLOListElement }>();
  const madeOfLine = el('p', { class: 'made-of' });
  const notesHolder = el('div', {});
  const perKgList = el('ol', { class: 'how-steps' });
  const perKgTitle = el('summary', {});
  const perKgBox = el('details', { class: 'how' }, perKgTitle, perKgList);
  const summary = el('div', { class: 'costing-summary' }, madeOfLine, perKgBox, notesHolder);
  /** The prices as typed so far (grosze), for "you earn"; a price that cannot be read yet is left out. */
  const typedPrices = (): Partial<Record<number, number>> => {
    const out: Partial<Record<number, number>> = {};
    for (const grams of BAG_SIZES_G) {
      const grosze = parseMoney(priceInputs[grams].value);
      if (typeof grosze === 'number' && grosze > 0) out[grams] = grosze;
    }
    return out;
  };
  // ---- The Product planner's extras: wholesale prices and the comparison with the products ----
  const extra = options.extra;
  const wholesaleHolder = el('div', {});
  const compareHolder = el('div', {});
  let compareSize: BagSize = 250;
  const sizeButtons = BAG_SIZES_G.map((grams) => {
    const b = button(
      formatBagSize(grams),
      () => {
        compareSize = grams;
        update();
      },
      'link',
    );
    return { grams, b };
  });
  /** The wholesale discounts as set under Packaging & discounts, lowest first: one column each, in both tables. */
  const discounts = extra ? [...extra.discounts].sort((a, b) => a.tenths - b.tenths) : [];
  /** The products' rows per bag size: they do not change while the plan does, so they are worked out once. */
  const productRows = new Map<BagSize, ComparedRow[]>();
  const compareArgs = [beanLots, packaging, settings.vatTenths, settings.defaultLossTenths, discounts.map((d) => d.tenths)] as const;
  const showExtra = (rows: readonly { grams: number; costGrosze: number | null }[], prices: Partial<Record<number, number>>) => {
    if (!extra) return;
    wholesaleHolder.replaceChildren(
      Object.keys(prices).length === 0
        ? el('p', { class: 'muted small' }, 'Wpisz cenę powyżej, aby zobaczyć ceny hurtowe.')
        : pricesTable(priceRows(prices, discounts.map((d) => d.tenths), settings.vatTenths, costsBySize(rows)), discounts),
    );
    for (const { grams, b } of sizeButtons) {
      if (grams === compareSize) b.setAttribute('aria-current', 'true');
      else b.removeAttribute('aria-current');
    }
    let products = productRows.get(compareSize);
    if (!products) {
      products = extra.products.map((p) => compareRow({ ...p, isPlan: false }, compareSize, ...compareArgs));
      productRows.set(compareSize, products);
    }
    const plan = compareRow({ name: 'Ten plan', isPlan: true, beans: beanForms, prices }, compareSize, ...compareArgs);
    compareHolder.replaceChildren(compareTable(sortCompared([plan, ...products]), discounts));
  };
  const extraNode = extra
    ? el(
        'div',
        { class: 'planner-extra' },
        el(
          'section',
          { class: 'product-card' },
          el('h3', {}, 'Ceny hurtowe ', infoTip(`Ile zapłaciłaby firma przy Twoich cenach powyżej: netto, minus jej rabat, zaokrąglone do pełnych złotych. Pod każdą ceną: ile zarobisz na torebce i marża brutto. ${MARGIN_TIP}`)),
          wholesaleHolder,
        ),
        el(
          'section',
          { class: 'product-card' },
          el(
            'h3',
            {},
            'Porównaj ze swoimi produktami ',
            infoTip(`Twój plan obok Twoich produktów, dla jednej wielkości torebki, od najbardziej zarabiającego. Każda kolumna hurtowa pokazuje, ile zarabiasz na torebce przy tym rabacie, i marżę brutto; rabaty pochodzą z zakładki Opakowania i rabaty. ${MARGIN_TIP}`),
          ),
          el('p', { class: 'compare-sizes small' }, 'Wielkość torebki: ', ...sizeButtons.flatMap(({ b }) => [b, ' '])),
          compareHolder,
        ),
      )
    : null;

  /** A new 250 g price fills in 500 g and 1 kg (owner, 2026-11-23); their own changes never touch 250 g. */
  const followBase = () => {
    const base = parseMoney(priceInputs[BASE_GRAMS].value);
    if (typeof base !== 'number' || base <= 0) return; // empty or not a price yet: the others stay as they are
    for (const [grams, grosze] of Object.entries(followingPrices(base, packaging, settings.vatTenths))) {
      const input = priceInputs[Number(grams) as BagSize];
      if (input && grosze !== undefined) input.value = String(grosze / 100);
    }
  };

  const update = () => {
    options.onChange?.({ beans: beanForms.map((f) => ({ ...f })), prices: Object.fromEntries(BAG_SIZES_G.map((g) => [g, priceInputs[g].value])) });
    const prices = typedPrices();
    const made = costing(beanForms, beanLots, packaging, settings.vatTenths, settings.defaultLossTenths, prices);
    showExtra(made.rows, prices);
    madeOfLine.replaceChildren(...(made.madeOf ? [made.madeOf, ...(made.perKg ? [el('span', { class: 'muted' }, ` · ${made.perKg}`)] : [])] : []));
    madeOfLine.hidden = !made.madeOf;
    perKgTitle.textContent = `Skąd ${made.perKgPrice}?`;
    perKgList.replaceChildren(...made.perKgSteps.map((step) => el('li', {}, step)));
    perKgBox.hidden = made.perKgSteps.length === 0;
    notesHolder.replaceChildren(...made.notes.map((n) => el('p', { class: 'muted small' }, n)));
    for (const r of made.rows) {
      const grams = r.grams as BagSize;
      const input = priceInputs[grams];
      const chips = r.suggestions.map((sug) => {
        const value = String(sug.grosze / 100);
        const chip = el(
          'button',
          { type: 'button', class: 'chip', 'aria-pressed': String(input.value.trim() === value) },
          el('strong', {}, sug.text),
          el('span', { class: 'chip-note' }, `${sug.markup} · zarabiasz ${sug.earnings}${sug.margin ? ` · marża ${sug.margin}` : ''}`),
        );
        chip.addEventListener('click', () => {
          input.value = value;
          if (grams === BASE_GRAMS) followBase();
          update();
        });
        return chip;
      });
      chipHolders.get(grams)?.replaceChildren(...(chips.length > 0 ? chips : r.parts ? [el('span', { class: 'muted small' }, r.parts)] : []));
      const earn = earnHolders.get(grams);
      if (earn) {
        earn.texts.replaceChildren(
          ...(r.earnings ? [el('span', { class: r.losing ? 'earn losing' : 'earn' }, r.losing ? `Tracisz ${r.earnings.replace('−', '')} na torebce` : `Zarabiasz ${r.earnings} na torebce`)] : []),
          ...(r.margin ? [el('span', { class: r.marginLosing ? 'earn losing' : 'earn' }, ` · marża brutto ${r.margin} `)] : []),
        );
        earn.tip.hidden = r.margin === '';
        earn.cost.textContent = r.cost ? ` (torebka kosztuje Cię ${r.cost})` : '';
        earn.box.hidden = !r.earnings && !r.margin && !r.cost;
      }
      const how = howHolders.get(grams);
      if (how) {
        how.list.replaceChildren(...r.steps.map((step) => el('li', {}, step)));
        how.box.hidden = r.steps.length === 0;
      }
    }
  };
  const priceRow = (grams: BagSize) => {
    const input = priceInputs[grams];
    input.addEventListener('input', () => {
      if (grams === BASE_GRAMS) followBase();
      update();
    });
    const chips = el('div', { class: 'chips' });
    chipHolders.set(grams, chips);
    const texts = el('span', {});
    const tip = infoTip(MARGIN_TIP);
    const cost = el('span', { class: 'muted small' });
    const earn = el('div', { class: 'price-earn', hidden: '' }, texts, tip, cost);
    earnHolders.set(grams, { box: earn, texts, tip, cost });
    const list = el('ol', { class: 'how-steps' });
    const box = el('details', { class: 'how' }, el('summary', {}, 'Jak to jest liczone?'), list);
    howHolders.set(grams, { box, list });
    return el(
      'div',
      { class: 'price-row' },
      el('label', { for: input.id, class: 'price-size' }, formatBagSize(grams)),
      el('span', { class: 'price-input' }, input, el('span', { class: 'price-unit' }, 'zł')),
      chips,
      earn,
      box,
      priceErrors[grams],
    );
  };

  const priceSection = el(
    'fieldset',
    { class: 'form-section' },
    el('legend', {}, options.pricesTitle),
    el(
      'p',
      { class: 'muted small' },
      options.pricesIntro,
      infoTip(
        'Dla 250 g Kraken proponuje dwa, dwa i pół albo trzy razy tyle, ile kosztuje Cię torebka, z VAT. Większe torebki idą za Twoją ceną 250 g: tyle małych torebek, ile się zmieści, z opakowaniem jednej dużej. „Zarabiasz” to to, co zostaje Ci po koszcie torebki, netto; marża to ta część ceny netto w procentach.',
      ),
    ),
    summary,
    el('div', { class: 'price-rows' }, ...BAG_SIZES_G.map(priceRow)),
  );

  renderBeans();
  update();

  return {
    node: el(
      'div',
      {},
      el('div', { class: 'costing-grid' }, el('div', { class: 'costing-beans' }, beansSection), el('div', { class: 'costing-prices' }, priceSection)),
      ...(extraNode ? [extraNode] : []),
    ),
    beans: () => beanForms.map((f) => ({ ...f })),
    prices: () => Object.fromEntries(BAG_SIZES_G.map((g) => [g, priceInputs[g].value])) as Record<BagSize, string>,
    showBeanErrors: (text) => (beansError.textContent = text),
    showPriceErrors(errors, focus = false) {
      for (const grams of BAG_SIZES_G) {
        priceErrors[grams].textContent = errors[grams] ?? '';
        priceInputs[grams].setAttribute('aria-invalid', errors[grams] ? 'true' : 'false');
      }
      const first = BAG_SIZES_G.find((g) => errors[g]);
      if (focus && first) priceInputs[first].focus();
    },
  };
}
