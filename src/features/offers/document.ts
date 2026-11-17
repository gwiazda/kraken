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

function bannerNode(offer: OfferDocument): HTMLElement {
  return el(
    'div',
    { class: 'offer-banner' },
    offer.banner.title,
    el('br'),
    offer.banner.line,
    ...(offer.banner.note ? [el('br'), el('span', { class: 'offer-banner-note' }, offer.banner.note)] : []),
  );
}

const overflows = (content: HTMLElement) => content.scrollHeight > content.clientHeight + 1;

/**
 * Puts the offer into `holder` (which must be on the screen, so sizes can be measured): products go onto a page
 * until it is full, then onto a new one; the banner goes at the bottom of the last page (or onto its own page).
 */
export function showOfferPages(holder: HTMLElement, offer: OfferDocument): void {
  const doc = el('div', { class: 'offer-doc' });
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
    current = newPage();
    current.content.append(banner);
  }
  if (pages.length > 1) pages.forEach((p, i) => (p.pageNumber.textContent = `Strona ${i + 1} z ${pages.length}`));
}
