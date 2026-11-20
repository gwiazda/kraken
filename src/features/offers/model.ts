// The offer for a customer (owner, 2026-11-17; docs/REQUIREMENTS.md section 5): the owner's HTML template, filled
// with ticked products, bag sizes and discounts, saved as a PDF with Chrome's "Save as PDF". The offer is in Polish
// (for Polish customers); Kraken's screens stay in English. Pure: no Google, no screen.

import { formatDate, isValidDate } from '../../core/dates';

export { addDays } from '../../core/dates';

/** An offer is valid for two weeks (owner, 2026-11-17). */
export const OFFER_VALID_DAYS = 14;

/**
 * At most this many discounts on one offer (owner, 2026-11-18: more discounts, without breaking the PDF): each one
 * adds a price line to every product card. Their names are short (Packaging & discounts allows 12 characters).
 */
export const MAX_TIERS = 4;

export interface Tier {
  /** Tenths of a percent (150 = 15 %). */
  readonly tenths: number;
  /** e.g. "Do 10 kg"; '' for none. */
  readonly label: string;
}

/** The yellow banner at the bottom: a title, the main line and a small note (empty parts are left out). */
export interface Banner {
  readonly title: string;
  readonly line: string;
  readonly note: string;
}

export interface OfferForm {
  customer: string;
  /** YYYY-MM-DD */
  date: string;
  /** The ticked products, in the order they appear on the offer. */
  productIds: string[];
  sizes: number[];
  tiers: Tier[];
  /** The owner's own banner text; null: the text made from the discounts and sizes (bannerText). */
  banner: Banner | null;
}

export type OfferErrors = Partial<Record<'customer' | 'date' | 'products' | 'sizes' | 'tiers' | 'banner', string>>;

/** A discount name is shown next to every price, so it must stay short ("Do 10 kg", "10–20 kg"). */
export const TIER_LABEL_MAX = 12;

/** At most this many characters in each part of the banner. */
export const BANNER_MAX = 300;

/** "2026-11-16" → "16.11.2026" (the Polish way; the one rule in core/dates). */
export const polishDate = formatDate;

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
export function bannerText(tiers: readonly Tier[], sizeLabels: readonly string[]): Banner {
  // Only a client's special prices (no discount ticked): no "Ceny netto B2B" line about discounts.
  if (tiers.length === 0) return { title: '', line: '', note: '' };
  const sorted = [...tiers].sort((a, b) => a.tenths - b.tenths);
  return {
    title: 'Ceny netto B2B:',
    line: sorted.map((t) => (t.label ? `${t.label} / mies.: ${discountText(t.tenths)}` : `Rabat: ${discountText(t.tenths)}`)).join(' | '),
    note: sorted.some((t) => t.label)
      ? `* Progi rabatowe dotyczą łącznej wagi zamówienia w miesiącu (dowolne połączenie ziaren oraz gramatur ${sizesText(sizeLabels)}).`
      : '',
  };
}

/**
 * Checks the offer before it is saved as a PDF. Messages are for the owner (English, like the rest of Kraken).
 * `withDeals`: a client's special prices are used, so the offer may have no standard discount (only their prices);
 * `withoutPrice`: product sizes that would then have no price at all (buildOffer), which must not go out.
 */
export function validateOffer(form: OfferForm, withDeals = false, withoutPrice: readonly string[] = []): OfferErrors {
  const errors: OfferErrors = {};
  if (cleanName(form.customer) === '') errors.customer = 'Enter who the offer is for.';
  if (!isValidDate(form.date)) errors.date = 'Enter the offer date.';
  if (form.productIds.length === 0) errors.products = 'Tick at least one product.';
  if (form.sizes.length === 0) errors.sizes = 'Tick at least one bag size.';
  if (form.tiers.length === 0 && !withDeals) errors.tiers = 'Tick at least one discount (they are set under Packaging & discounts).';
  else if (withoutPrice.length > 0) {
    errors.tiers = `No price for ${withoutPrice.join(', ')}: there is no special price for it and no discount is ticked. Tick a discount, or untick that product or size.`;
  } else if (form.tiers.length > MAX_TIERS) errors.tiers = `Tick at most ${MAX_TIERS} discounts, so the offer stays readable.`;
  for (const tier of form.tiers) {
    if (tier.label.length > TIER_LABEL_MAX) errors.tiers = `The name "${tier.label}" is longer than ${TIER_LABEL_MAX} characters, so it does not fit next to the prices. Shorten it under Packaging & discounts.`;
  }
  if (form.banner && [form.banner.title, form.banner.line, form.banner.note].some((part) => part.length > BANNER_MAX)) {
    errors.banner = `Each part of the banner can have at most ${BANNER_MAX} characters.`;
  }
  return errors;
}
