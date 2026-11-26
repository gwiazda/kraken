// The offer for a customer (owner, 2026-11-17; docs/REQUIREMENTS.md section 5): the owner's HTML template, filled
// with ticked products, bag sizes and discounts, saved as a PDF with Chrome's "Save as PDF". The offer is in Polish
// (for Polish customers), like Kraken's screens. Pure: no Google, no screen.

import { formatDate, isValidDate } from '../../core/dates';
import { plural } from '../../core/polish';

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

export type OfferErrors = Partial<Record<'date' | 'products' | 'sizes' | 'tiers' | 'banner', string>>;

/** A discount name is shown next to every price, so it must stay short ("Do 10 kg", "10–20 kg"). */
export const TIER_LABEL_MAX = 12;

/** At most this many characters in each part of the banner. */
export const BANNER_MAX = 300;


/** The customer's name as it goes into a file name: no characters a file name cannot have, single spaces. */
export function cleanName(customer: string): string {
  return customer
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
    .trim();
}

/**
 * The PDF's name, e.g. "Oferta dla Kawiarnia Pod Lipą 16.11.2026" (Chrome adds ".pdf"); without a customer a general
 * offer, "Oferta 16.11.2026" (owner, 2026-11-26).
 */
export function offerFileName(customer: string, date: string): string {
  const name = cleanName(customer);
  return `Oferta${name ? ` dla ${name}` : ''} ${formatDate(date)}`;
}

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

/**
 * The small print under the discounts: the basis is one invoice, in both sentences. Bag sizes are mentioned only when
 * two or more are on the offer (one size cannot be combined).
 */
function discountNote(sizeLabels: readonly string[]): string {
  const sizes = sizeLabels.length > 1 ? ` oraz opakowania ${sizesText(sizeLabels)}` : '';
  return `* Wysokość rabatu zależy od łącznej wagi kawy na jednej fakturze. W ramach faktury można dowolnie łączyć rodzaje ziaren${sizes}.`;
}

/** The yellow banner at the bottom of the offer. The discount is counted per invoice (owner, 2026-11-21; was per month). */
export function bannerText(tiers: readonly Tier[], sizeLabels: readonly string[]): Banner {
  // Only a client's special prices (no discount ticked): no "Ceny netto B2B" line about discounts.
  if (tiers.length === 0) return { title: '', line: '', note: '' };
  const sorted = [...tiers].sort((a, b) => a.tenths - b.tenths);
  return {
    title: 'Ceny netto B2B:',
    line: sorted.map((t) => (t.label ? `${t.label}: ${discountText(t.tenths)}` : `Rabat: ${discountText(t.tenths)}`)).join(' | '),
    note: sorted.some((t) => t.label) ? discountNote(sizeLabels) : '',
  };
}

/**
 * Checks the offer before it is saved as a PDF. Messages are for the owner (to be in Polish, like the rest of Kraken).
 * `withDeals`: a client's special prices are used, so the offer may have no standard discount (only their prices);
 * `withoutPrice`: product sizes that would then have no price at all (buildOffer), which must not go out.
 */
export function validateOffer(form: OfferForm, withDeals = false, withoutPrice: readonly string[] = []): OfferErrors {
  const errors: OfferErrors = {};
  if (!isValidDate(form.date)) errors.date = 'Wybierz datę oferty.';
  if (form.productIds.length === 0) errors.products = 'Zaznacz co najmniej jeden produkt.';
  if (form.sizes.length === 0) errors.sizes = 'Zaznacz co najmniej jedną wielkość torebki.';
  if (form.tiers.length === 0 && !withDeals) errors.tiers = 'Zaznacz co najmniej jeden rabat (ustawiasz je w zakładce Opakowania i rabaty).';
  else if (withoutPrice.length > 0) {
    errors.tiers = `Brak ceny dla: ${withoutPrice.join(', ')}; nie ma dla nich ceny specjalnej, a żaden rabat nie jest zaznaczony. Zaznacz rabat albo odznacz ten produkt lub wielkość.`;
  } else if (form.tiers.length > MAX_TIERS) errors.tiers = `Zaznacz najwyżej ${MAX_TIERS} ${plural(MAX_TIERS, 'rabat', 'rabaty', 'rabatów')}, żeby oferta była czytelna.`;
  for (const tier of form.tiers) {
    if (tier.label.length > TIER_LABEL_MAX) errors.tiers = `Nazwa „${tier.label}” ma więcej niż ${TIER_LABEL_MAX} znaków, więc nie zmieści się przy cenach. Skróć ją w zakładce Opakowania i rabaty.`;
  }
  if (form.banner && [form.banner.title, form.banner.line, form.banner.note].some((part) => part.length > BANNER_MAX)) {
    errors.banner = `Każda część baneru może mieć najwyżej ${BANNER_MAX} znaków.`;
  }
  return errors;
}
