// The offer for a customer (owner, 2026-11-17; docs/REQUIREMENTS.md section 5): the owner's HTML template, filled
// with ticked products, bag sizes and discounts, saved as a PDF with Chrome's "Save as PDF". The offer is in Polish
// (for Polish customers); Kraken's screens stay in English. Pure: no Google, no screen.

import { isValidDate } from '../../core/dates';

/** An offer is valid for two weeks (owner, 2026-11-17). */
export const OFFER_VALID_DAYS = 14;

/**
 * The tier names used so far (the owner's template): the discount depends on the monthly order weight. A discount
 * without a name is shown as "Rabat −20%".
 */
export const DEFAULT_TIER_LABELS: Readonly<Record<number, string>> = { 150: 'Do 10 kg', 250: '10–20 kg', 300: '20+ kg' };

export interface Tier {
  /** Tenths of a percent (150 = 15 %). */
  readonly tenths: number;
  /** e.g. "Do 10 kg"; '' for none. */
  readonly label: string;
}

export interface OfferForm {
  customer: string;
  /** YYYY-MM-DD */
  date: string;
  productIds: string[];
  sizes: number[];
  tiers: Tier[];
}

export type OfferErrors = Partial<Record<'customer' | 'date' | 'products' | 'sizes' | 'tiers', string>>;

/** YYYY-MM-DD plus some days (calendar days, no time zones involved). */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const result = new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, (d ?? 1) + days));
  return result.toISOString().slice(0, 10);
}

/** "2026-11-16" → "16.11.2026" (the Polish way). */
export function polishDate(date: string): string {
  const [y, m, d] = date.split('-');
  return `${d}.${m}.${y}`;
}

/** The customer's name as it goes into a file name: no characters a file name cannot have, single spaces. */
export function cleanName(customer: string): string {
  return customer
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
    .trim();
}

/** The PDF's name, e.g. "Oferta dla Kawiarnia Pod Lipą 16.11.2026" (Chrome adds ".pdf"). */
export const offerFileName = (customer: string, date: string) => `Oferta dla ${cleanName(customer)} ${polishDate(date)}`;

/** "-15%", "-12,5%" (as on the template). */
export function discountText(tenths: number): string {
  const whole = Math.floor(tenths / 10);
  const rest = tenths % 10;
  return `-${whole}${rest ? `,${rest}` : ''}%`;
}

/** The line next to a wholesale price: "Do 10 kg (-15%):" or "Rabat -20%:". */
export const tierText = (tier: Tier) => (tier.label ? `${tier.label} (${discountText(tier.tenths)}):` : `Rabat ${discountText(tier.tenths)}:`);

/** "250 g", "250 g i 1 kg", "250 g, 500 g i 1 kg" */
export function sizesText(labels: readonly string[]): string {
  if (labels.length <= 1) return labels[0] ?? '';
  return `${labels.slice(0, -1).join(', ')} i ${labels[labels.length - 1]}`;
}

/** The yellow banner at the bottom of the offer. */
export function bannerText(tiers: readonly Tier[], sizeLabels: readonly string[]): { title: string; line: string; note: string } {
  const sorted = [...tiers].sort((a, b) => a.tenths - b.tenths);
  return {
    title: 'Ceny netto B2B:',
    line: sorted.map((t) => (t.label ? `${t.label} / mies.: ${discountText(t.tenths)}` : `Rabat: ${discountText(t.tenths)}`)).join(' | '),
    note: sorted.some((t) => t.label)
      ? `* Progi rabatowe dotyczą łącznej wagi zamówienia w miesiącu (dowolne połączenie ziaren oraz gramatur ${sizesText(sizeLabels)}).`
      : '',
  };
}

/** Checks the offer before it is saved as a PDF. Messages are for the owner (English, like the rest of Kraken). */
export function validateOffer(form: OfferForm): OfferErrors {
  const errors: OfferErrors = {};
  if (cleanName(form.customer) === '') errors.customer = 'Enter who the offer is for.';
  if (!isValidDate(form.date)) errors.date = 'Enter the offer date.';
  if (form.productIds.length === 0) errors.products = 'Tick at least one product.';
  if (form.sizes.length === 0) errors.sizes = 'Tick at least one bag size.';
  if (form.tiers.length === 0) errors.tiers = 'Tick at least one discount.';
  for (const tier of form.tiers) {
    if (tier.label.length > 40) errors.tiers = 'A discount name can have at most 40 characters.';
  }
  return errors;
}
