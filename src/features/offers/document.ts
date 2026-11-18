// The offer pages, built from the owner's HTML template (2026-11-17): same layout, colours and graphics, with every
// class prefixed "offer-" so nothing clashes with Kraken's own styles (see style.css "Offer document").
// Products flow onto as many A4 pages as needed: `paginate` measures the pages once they are on the screen.
// All text is set with textContent (via el), never as HTML.

import logoUrl from '../../../assets/brand/logo-horizontal-lime-on-black.png';
import crackUrl from '../../../assets/brand/crack-yellow.png';
import beanUrl from '../../../assets/brand/bean-lime.png';
import { el } from '../../ui/dom';
import type { OfferCard, OfferDocument } from './present';

/** One A4 page: the crack in the background, the header, the content area and the footer. */
function pageNode(offer: OfferDocument, first: boolean): { page: HTMLElement; content: HTMLElement; grid: HTMLElement; pageNumber: HTMLElement } {
  const grid = el('div', { class: 'offer-products' });
  const content = el(
    'div',
    { class: 'offer-page-content' },
    el(
      'div',
      { class: 'offer-header' },
      el('img', { src: logoUrl, alt: 'Krak Coffee Roasters', class: 'offer-logo' }),
      el('div', { class: 'offer-title' }, el('h1', {}, 'Oferta'), el('p', {}, 'IG: @krak_coffee_roasters | krakshop.pl')),
    ),
    ...(first
      ? [
          el(
            'div',
            { class: 'offer-meta' },
            el('div', {}, el('span', { class: 'offer-meta-label' }, 'Dla: '), el('span', { class: 'offer-meta-customer' }, offer.customer || '…')),
            el(
              'div',
              { class: 'offer-meta-dates' },
              el('span', { class: 'offer-meta-label' }, 'Data oferty: '),
              offer.date,
              el('span', { class: 'offer-meta-sep' }, ' | '),
              el('span', { class: 'offer-meta-label' }, 'Ważna do: '),
              offer.validUntil,
            ),
          ),
        ]
      : []),
    grid,
  );
  const pageNumber = el('span', {});
  const page = el(
    'section',
    { class: 'offer-page' },
    el('img', { src: crackUrl, alt: '', class: 'offer-crack' }),
    content,
    el('footer', { class: 'offer-footer' }, el('span', {}, `KRAK Coffee Roasters © ${offer.year}`), pageNumber),
  );
  return { page, content, grid, pageNumber };
}

function cardNode(card: OfferCard): HTMLElement {
  return el(
    'div',
    { class: 'offer-card' },
    el(
      'div',
      { class: 'offer-card-head' },
      el('div', { class: 'offer-product' }, el('img', { src: beanUrl, alt: '', class: 'offer-bean' }), el('h2', { class: 'offer-product-name' }, card.name)),
      el(
        'div',
        { class: 'offer-pricing' },
        ...card.blocks.map((block) =>
          el(
            'div',
            { class: 'offer-price-block' },
            el('div', { class: 'offer-price-size' }, block.size),
            el(
              'div',
              { class: 'offer-tiers' },
              ...block.rows.map((row) => el('div', { class: 'offer-tier' }, el('span', { class: 'offer-tier-label' }, row.label), el('span', { class: 'offer-price' }, row.price))),
            ),
            ...(block.retail ? [el('div', { class: 'offer-retail' }, block.retail)] : []),
          ),
        ),
      ),
    ),
    ...(card.details.length > 0 || card.brewMethod
      ? [
          el(
            'div',
            { class: 'offer-details' },
            ...card.details.map((d) => el('span', {}, el('strong', {}, d.label), ' ', d.value)),
            ...(card.brewMethod ? [el('span', { class: 'offer-brew' }, card.brewMethod)] : []),
          ),
        ]
      : []),
  );
}

/** The yellow banner: title, main line and small print, each on its own line; empty ones are left out. */
function bannerNode(offer: OfferDocument): HTMLElement {
  const { title, line, note } = offer.banner;
  const parts: Node[] = [title, line].filter((t) => t).map((t) => el('span', { class: 'offer-banner-line' }, t));
  if (note) parts.push(el('span', { class: 'offer-banner-line offer-banner-note' }, note));
  return el('div', { class: 'offer-banner' }, ...parts);
}

const overflows = (content: HTMLElement) => content.scrollHeight > content.clientHeight + 1;

/**
 * Sizes tried for a product name, in order: [size in pt, most lines]. One line as large as possible (the template's
 * size is 22 pt), then two lines, and only for a very long name three.
 */
const NAME_FITS: readonly (readonly [number, number])[] = [
  [22, 1],
  [20, 1],
  [18, 1],
  [16, 1],
  [18, 2],
  [16, 2],
  [16, 3],
];
/** With this many bag sizes there is no room beside the name: every card puts its prices under the name. */
export const STACKED_FROM_SIZES = 3;

/**
 * Fits a product name in the space beside its prices (or above them, on a stacked offer), without ever moving the
 * prices (owner, 2026-11-17): the first size from NAME_FITS where the name is not wider than its space and takes
 * at most that many lines.
 */
function fitName(card: HTMLElement): void {
  const name = card.querySelector<HTMLElement>('.offer-product-name');
  const product = card.querySelector<HTMLElement>('.offer-product');
  if (!name || !product) return;
  const lineHeight = (pt: number) => pt * (4 / 3) * 1.15; // pt → px; line-height 1.15 (style.css)
  for (const [pt, lines] of NAME_FITS) {
    name.style.fontSize = `${pt}pt`;
    // A single long word cannot wrap: it makes the name, or the bean + name, wider than their space.
    const fitsWidth = name.scrollWidth <= name.clientWidth + 1 && product.scrollWidth <= product.clientWidth + 1;
    if (fitsWidth && name.offsetHeight <= lineHeight(pt) * lines + 2) return;
  }
}

/**
 * Puts the offer into `holder` (which must be on the screen, so sizes can be measured): products go onto a page
 * until it is full, then onto a new one; the banner goes at the bottom of the last page (or onto its own page).
 */
export function showOfferPages(holder: HTMLElement, offer: OfferDocument): void {
  const stacked = offer.cards.some((c) => c.blocks.length >= STACKED_FROM_SIZES);
  const doc = el('div', { class: stacked ? 'offer-doc offer-stacked' : 'offer-doc' });
  holder.replaceChildren(doc);
  const pages: ReturnType<typeof pageNode>[] = [];
  const newPage = () => {
    const page = pageNode(offer, pages.length === 0);
    pages.push(page);
    doc.append(page.page);
    return page;
  };
  let current = newPage();
  for (const card of offer.cards) {
    const node = cardNode(card);
    current.grid.append(node);
    fitName(node);
    // A card that does not fit moves to a new page (unless it is alone on its page: then it stays, cut off).
    if (overflows(current.content) && current.grid.childElementCount > 1) {
      node.remove();
      current = newPage();
      current.grid.append(node);
    }
  }
  const banner = bannerNode(offer);
  current.content.append(banner);
  if (overflows(current.content)) {
    banner.remove();
    // The banner does not fit under the last products: it goes onto a new page, and takes the last product with it
    // (if that page has more than one), so no page holds only the banner.
    const last = current.grid.childElementCount > 1 ? current.grid.lastElementChild : null;
    last?.remove();
    current = newPage();
    if (last) current.grid.append(last);
    current.content.append(banner);
  }
  if (pages.length > 1) pages.forEach((p, i) => (p.pageNumber.textContent = `Strona ${i + 1} z ${pages.length}`));
}
