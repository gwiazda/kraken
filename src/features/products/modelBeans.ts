// What a product is made of (owner, 2026-11-18): up to 3 beans, each a lot or a planned bean (not bought yet, with
// the price per kg the owner was quoted), and its share of the bag in whole percent. Pure: no Google, no screen.

import { moneyText, parseDecimal, parseMoney, toDecimalText } from '../../core/numbers';
import { MAX_BEANS } from '../../domain/blend';

type Fields = Readonly<Record<string, string>>;

export const PRODUCT_BEANS_TAB = 'Product beans';
export const BEAN_COLUMNS = ['product_id', 'position', 'lot_id', 'planned_name', 'planned_price_per_kg_pln', 'planned_roast_loss_percent', 'share_percent'] as const;

const PLANNED_NAME_MAX = 40;

export interface ProductBean {
  readonly id: string;
  readonly row: number;
  readonly productId: string;
  /** 1, 2 or 3: the order in the product. */
  readonly position: number;
  /** The lot, for a bean from Lots; '' for a planned bean. */
  readonly lotId: string;
  readonly plannedName: string;
  /** Price per kg of a planned bean (grosze, without VAT, with delivery); null if empty or unreadable. */
  readonly plannedPriceGrosze: number | null;
  readonly plannedPriceText: string;
  /** Roast loss of a planned bean, tenths of a percent; null: the usual loss. */
  readonly plannedLossTenths: number | null;
  readonly plannedLossText: string;
  /** Whole percent; null if unreadable. */
  readonly sharePercent: number | null;
  readonly deletedAt: string;
  readonly source: Fields;
}

const text = (fields: Fields, name: string) => (fields[name] ?? '').trim();

/**
 * A roast loss in tenths, 1 to 99,9 %. A cell typed as "15%" in Google Sheets arrives as 0.15, which would read as
 * 0,15 %: values under 1 % are refused (as everywhere in Kraken), and 0 % is no real roast loss.
 */
function percentTenths(value: string): number | null {
  const tenths = parseDecimal(value, 1);
  if (typeof tenths !== 'number' || tenths < 10 || tenths >= 1000) return null; // 0 % loss does not happen
  return tenths;
}

export function beanFromFields(fields: Fields, row: number): ProductBean {
  const price = parseMoney(text(fields, 'planned_price_per_kg_pln'));
  const share = Number(text(fields, 'share_percent'));
  return {
    id: text(fields, 'id'),
    row,
    productId: text(fields, 'product_id'),
    position: Number(text(fields, 'position')) || 0,
    lotId: text(fields, 'lot_id'),
    plannedName: text(fields, 'planned_name'),
    plannedPriceGrosze: typeof price === 'number' && price > 0 ? price : null,
    plannedPriceText: text(fields, 'planned_price_per_kg_pln'),
    plannedLossTenths: percentTenths(text(fields, 'planned_roast_loss_percent')),
    plannedLossText: text(fields, 'planned_roast_loss_percent'),
    sharePercent: Number.isInteger(share) && share > 0 && share <= 100 ? share : null,
    deletedAt: text(fields, 'deleted_at'),
    source: fields,
  };
}

/** A product's active beans, in their order. */
export const beansOf = (beans: readonly ProductBean[], productId: string) =>
  beans.filter((b) => b.deletedAt === '' && b.productId === productId).sort((a, b) => a.position - b.position || a.row - b.row);

// ---- The form ----

export interface BeanForm {
  kind: 'lot' | 'planned';
  lotId: string;
  plannedName: string;
  /** Price per kg as typed ("52,50"). */
  plannedPrice: string;
  /** Roast loss % as typed; '' = the usual loss. */
  plannedLoss: string;
  sharePercent: number;
}

export type BeanErrors = Partial<Record<'lotId' | 'plannedName' | 'plannedPrice' | 'plannedLoss', string>>;

export function formFromBean(bean: ProductBean): BeanForm {
  return {
    kind: bean.lotId ? 'lot' : 'planned',
    lotId: bean.lotId,
    plannedName: bean.plannedName,
    plannedPrice: bean.plannedPriceGrosze === null ? bean.plannedPriceText : `${Math.floor(bean.plannedPriceGrosze / 100)},${String(bean.plannedPriceGrosze % 100).padStart(2, '0')}`,
    plannedLoss: bean.plannedLossTenths === null ? '' : toDecimalText(bean.plannedLossTenths, 1).replace('.', ','),
    sharePercent: bean.sharePercent ?? 0,
  };
}

/** A planned bean's price per kg while typing (grosze); null until readable. */
export function typedBeanPrice(value: string): number | null {
  const grosze = parseMoney(value);
  return typeof grosze === 'number' && grosze > 0 ? grosze : null;
}

/** A planned bean's roast loss while typing (tenths); null when empty (the usual loss) or not readable. */
export const typedBeanLoss = (value: string): number | null => (value.trim() === '' ? null : percentTenths(value.trim()));

/**
 * Checks the beans of a product: at most 3, each a chosen lot (once) or a planned bean with a name and a price,
 * shares of at least 1 % that add up to 100 %. Gives the cells to store, in order (position 1, 2, 3).
 */
export function validateBeans(
  forms: readonly BeanForm[],
): { ok: true; fields: Record<string, string>[] } | { ok: false; errors: BeanErrors[]; shares: string } {
  const errors: BeanErrors[] = forms.map(() => ({}));
  let shares = '';
  if (forms.length > MAX_BEANS) shares = `A product can be made of at most ${MAX_BEANS} beans.`;
  const total = forms.reduce((sum, f) => sum + f.sharePercent, 0);
  if (forms.length > 0 && (total !== 100 || forms.some((f) => !Number.isInteger(f.sharePercent) || f.sharePercent < 1))) {
    shares = 'The shares must add up to 100 %, each at least 1 %.';
  }
  const fields = forms.map((form, i) => {
    const e = errors[i] ?? {};
    const base = { position: String(i + 1), share_percent: String(form.sharePercent) };
    if (form.kind === 'lot') {
      if (form.lotId === '') e.lotId = 'Choose a lot.';
      else if (forms.some((other, j) => j < i && other.kind === 'lot' && other.lotId === form.lotId)) e.lotId = 'This lot is already in the product.';
      return { ...base, lot_id: form.lotId, planned_name: '', planned_price_per_kg_pln: '', planned_roast_loss_percent: '' };
    }
    const name = form.plannedName.trim().replace(/\s+/g, ' ');
    if (name === '') e.plannedName = 'Give it a name, e.g. Etiopia offer.';
    else if (name.length > PLANNED_NAME_MAX) e.plannedName = `At most ${PLANNED_NAME_MAX} characters.`;
    const price = typedBeanPrice(form.plannedPrice);
    if (price === null) e.plannedPrice = 'Enter the price per kg in zł, with delivery and without VAT, e.g. 52,50.';
    const loss = form.plannedLoss.trim() === '' ? null : percentTenths(form.plannedLoss.trim());
    if (form.plannedLoss.trim() !== '' && loss === null) e.plannedLoss = 'Enter a percentage from 1 to 99, e.g. 16, or leave it empty.';
    return {
      ...base,
      lot_id: '',
      planned_name: name,
      planned_price_per_kg_pln: price === null ? '' : moneyText(price),
      planned_roast_loss_percent: loss === null ? '' : toDecimalText(loss, 1),
    };
  });
  if (shares || errors.some((e) => Object.keys(e).length > 0)) return { ok: false, errors, shares };
  return { ok: true, fields };
}

/**
 * What to write so the stored beans become `wanted` (from validateBeans): the bean in each position is updated
 * where anything changed, missing positions are added, and beans no longer wanted are soft-deleted.
 */
export function beanChanges(
  existing: readonly ProductBean[],
  wanted: readonly Record<string, string>[],
): { updates: { bean: ProductBean; changes: Record<string, string> }[]; adds: Record<string, string>[]; removes: ProductBean[] } {
  const updates: { bean: ProductBean; changes: Record<string, string> }[] = [];
  const adds: Record<string, string>[] = [];
  wanted.forEach((fields, i) => {
    const bean = existing[i];
    if (!bean) {
      adds.push(fields);
      return;
    }
    const changes: Record<string, string> = {};
    for (const [column, value] of Object.entries(fields)) if (text(bean.source, column) !== value) changes[column] = value;
    if (Object.keys(changes).length > 0) updates.push({ bean, changes });
  });
  return { updates, adds, removes: existing.slice(wanted.length) };
}
