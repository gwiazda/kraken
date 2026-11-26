import { formatDate } from '../../core/dates';
// What an offer shows, as plain text, so it is tested without a browser: the ticked products in the owner's order, a price block
// per ticked bag size with the wholesale net price at each ticked discount, the suggested retail price under 250 g,
// and the banner. Wholesale = the product's main gross ÷ (1 + VAT) − discount, net rounded to whole złoty.

import { formatWholePln } from '../../core/numbers';
import { wholesalePrice } from '../../domain/prices';
import { formatBagSize, isBagSize } from '../../domain/bagSizes';
import { dealKey } from '../clients';
import { isProductDeleted, productDetails, type Product } from '../products';
import { addDays, bannerText, cleanName, offerFileName, tierText, type Banner, type OfferForm } from './model';

export interface OfferPriceBlock {
  /** "250 g" */
  readonly size: string;
  readonly rows: readonly { readonly label: string; readonly price: string }[];
  /** "Sugerowana cena detaliczna brutto: 45 zł" under 250 g only (owner, 2026-11-17); '' otherwise. */
  readonly retail: string;
}

export interface OfferCard {
  readonly name: string;
  /** e.g. "Espresso"; '' for none. */
  readonly brewMethod: string;
  /** Only the details that are filled in, with their Polish labels. */
  readonly details: readonly { readonly label: string; readonly value: string }[];
  readonly blocks: readonly OfferPriceBlock[];
}

export interface OfferDocument {
  /** The PDF's name, e.g. "Oferta dla Kawiarnia 16.11.2026". */
  readonly fileName: string;
  readonly customer: string;
  readonly date: string;
  readonly validUntil: string;
  readonly year: string;
  readonly cards: readonly OfferCard[];
  readonly banner: Banner;
  /** For the owner, not on the offer: e.g. a product without a price for a ticked size. */
  readonly warnings: readonly string[];
  /** Product sizes on the offer with no price line at all (no special price and no discount ticked): "KENIA 1 kg". */
  readonly withoutPrice: readonly string[];
}

const RETAIL_SIZE = 250;

/** A special price as its only line: no label (owner: no "Cena specjalna"); "38 zł" or "38,50 zł". */
const dealRow = (net: number | undefined) => (net === undefined ? undefined : [{ label: '', price: formatWholePln(net) }]);

/**
 * `deals`: a picked client's special prices (owner, 2026-11-20), product id and size (dealKey) → net grosze, when
 * "Use their special prices" is ticked. A size with a deal shows only that price, without a label; the others show
 * the ticked discounts.
 */
export function buildOffer(products: readonly Product[], form: OfferForm, vatTenths: number, validDays: number, deals: ReadonlyMap<string, number> = new Map()): OfferDocument {
  const sizes = form.sizes.filter(isBagSize).sort((a, b) => a - b);
  const tiers = [...form.tiers].sort((a, b) => a.tenths - b.tenths);
  const byId = new Map(products.filter((p) => !isProductDeleted(p)).map((p) => [p.id, p]));
  const ticked = form.productIds.flatMap((id) => byId.get(id) ?? []); // in the owner's order
  const warnings: string[] = [];
  const withoutPrice: string[] = [];
  const cards = ticked.map((p): OfferCard => {
    const missing = sizes.filter((g) => p.prices[g] === undefined);
    if (sizes.length === 0) {
      // nothing to say per product: validateOffer asks to tick a size
    } else if (missing.length === sizes.length) warnings.push(`${p.name} nie ma ceny za ${missing.map(formatBagSize).join(' ani ')}, więc jest pokazany bez cen. Dodaj je w zakładce Produkty.`);
    else if (missing.length > 0) warnings.push(`${p.name} nie ma ceny za ${missing.map(formatBagSize).join(' i ')}, więc ${missing.length === 1 ? 'ta wielkość jest' : 'te wielkości są'} dla niego ${missing.length === 1 ? 'pominięta' : 'pominięte'}.`);
    // The same details, in the same words, as a product's page shows under "W ofercie" (one list in products).
    const details = productDetails(p).map((d) => ({ label: `${d.label}:`, value: d.value }));
    const blocks = sizes.flatMap((grams): OfferPriceBlock[] => {
      const gross = p.prices[grams];
      if (gross === undefined) return [];
      return [
        {
          size: formatBagSize(grams),
          rows: dealRow(deals.get(dealKey(p.id, grams))) ?? tiers.map((tier) => ({ label: tierText(tier), price: formatWholePln(wholesalePrice(gross, tier.tenths, vatTenths).net) })),
          retail: grams === RETAIL_SIZE ? `Sugerowana cena detaliczna brutto: ${formatWholePln(gross)}` : '',
        },
      ];
    });
    for (const block of blocks) if (block.rows.length === 0) withoutPrice.push(`${p.name} ${block.size}`);
    return { name: p.name, brewMethod: p.brewMethod, details, blocks };
  });
  return {
    fileName: offerFileName(form.customer, form.date),
    // A name with nothing left once cleaned (" / ") is no customer: a general offer, like its file name.
    customer: cleanName(form.customer) === '' ? '' : form.customer.trim().replace(/\s+/g, ' '),
    date: formatDate(form.date),
    validUntil: formatDate(addDays(form.date, validDays)),
    year: form.date.slice(0, 4),
    cards,
    banner: form.banner ?? bannerText(tiers, sizes.map(formatBagSize)),
    warnings,
    withoutPrice,
  };
}
