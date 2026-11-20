// Small helpers for building screens. All text is set with textContent / attributes (never innerHTML), so nothing
// from Google or the sheet can inject code.

export type Child = Node | string;

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  node.append(...children);
  return node;
}

export function button(label: string, onClick: () => void, variant: 'primary' | 'secondary' | 'link' = 'primary'): HTMLButtonElement {
  const b = el('button', { type: 'button', class: `btn btn-${variant}` }, label);
  b.addEventListener('click', onClick);
  return b;
}

/**
 * Makes a table row open its page (or its edit form) when clicked anywhere (owner, 2026-11-20: no Edit or Details
 * buttons; the same on every tab). Buttons, links, form fields, the drag grip and anything marked `no-row-click`
 * keep their own click; selecting text does not open it; nor does anything while the row is asking something
 * (`asking`, e.g. "Delete …? Yes / No" or a date box under it) or while Kraken is saving (unless `whileSaving`: the
 * page then waits by itself).
 * For the keyboard and screen readers a real button ("Open KENIA") sits in the row's first cell, shown only when
 * focused; the whole row is outlined then.
 */
export function clickableRow<T extends HTMLTableRowElement>(
  tr: T,
  open: () => void,
  label: string,
  options: { whileSaving?: boolean; asking?: () => boolean } = {},
): T {
  tr.classList.add('row-link');
  const blocked = () => (options.asking?.() ?? false) || (!options.whileSaving && tr.closest('.saving') !== null);
  const opener = el('button', { type: 'button', class: 'row-open' }, label);
  opener.addEventListener('click', (event) => {
    event.stopPropagation();
    if (!blocked()) open();
  });
  const cell = [...tr.cells].find((c) => !c.classList.contains('order-grip')) ?? tr.cells[0];
  cell?.prepend(opener);
  tr.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('button, a, input, select, textarea, label, .drag-handle, .no-row-click')) return;
    if (blocked() || (window.getSelection()?.toString() ?? '') !== '') return;
    open();
  });
  return tr;
}

/**
 * A list table that turns into cards on a phone (owner, 2026-11-20; the CSS is under `table.cards` in style.css).
 * Each cell gets its column heading as `data-label` (shown before the value on a phone), and the first column with a
 * heading becomes the card's title. Call it again after the rows change (e.g. a new page of a list).
 */
export function cardTable(table: HTMLTableElement): HTMLTableElement {
  table.classList.add('cards');
  const headings = [...(table.tHead?.rows[0]?.cells ?? [])].map(headingText);
  const title = headings.findIndex((h) => h !== '');
  const label = (row: HTMLTableRowElement) => {
    if (row.cells.length !== headings.length) return; // e.g. the full-width "Delete …?" line
    [...row.cells].forEach((cell, i) => {
      cell.dataset['label'] = headings[i] ?? '';
      cell.classList.toggle('card-title', i === title);
    });
  };
  for (const row of [...(table.tHead?.rows ?? [])].slice(1)) label(row); // the filters under the headings
  for (const body of table.tBodies) for (const row of body.rows) label(row);
  return table;
}

/** A heading's words, without its ⓘ tip or text meant only for screen readers. */
function headingText(cell: HTMLTableCellElement): string {
  const copy = cell.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('.info-tip, .visually-hidden').forEach((n) => n.remove());
  return (copy.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** A gear icon (inline SVG, drawn in the text colour), e.g. for Kraken's own settings. Hidden from screen readers. */
export function gearIcon(): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  for (const [name, value] of Object.entries({ viewBox: '0 0 24 24', width: '18', height: '18', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', class: 'icon' })) {
    svg.setAttribute(name, value);
  }
  const circle = document.createElementNS(ns, 'circle');
  for (const [name, value] of Object.entries({ cx: '12', cy: '12', r: '3' })) circle.setAttribute(name, value);
  const path = document.createElementNS(ns, 'path');
  path.setAttribute(
    'd',
    'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
  );
  svg.append(circle, path);
  return svg;
}

export function message(text: string, kind: 'info' | 'error' = 'info'): HTMLParagraphElement {
  return el('p', { class: kind === 'error' ? 'message message-error' : 'message muted', role: kind === 'error' ? 'alert' : 'status' }, text);
}

/** The one tooltip bubble of the page, floating above everything (so a table or card never cuts it off). */
let bubble: HTMLDivElement | null = null;
/** Checks while the bubble is shown, so it goes away if the page is redrawn under it (no mouseleave then). */
let watch = 0;

function showTip(target: HTMLElement, text: string): void {
  window.clearInterval(watch);
  watch = window.setInterval(() => {
    if (!target.isConnected) hideTip();
  }, 250);
  bubble ??= el('div', { class: 'tip-bubble', role: 'tooltip' });
  bubble.textContent = text;
  document.body.append(bubble);
  const spot = target.getBoundingClientRect();
  const box = bubble.getBoundingClientRect();
  const gap = 8;
  // Above the ⓘ if there is room, else below; never past the edges of the window.
  const top = spot.top - box.height - gap >= 0 ? spot.top - box.height - gap : spot.bottom + gap;
  const left = Math.min(Math.max(gap, spot.left + spot.width / 2 - box.width / 2), window.innerWidth - box.width - gap);
  bubble.style.top = `${Math.round(top)}px`;
  bubble.style.left = `${Math.round(left)}px`;
}

function hideTip(): void {
  window.clearInterval(watch);
  bubble?.remove();
}

/** A small ⓘ that shows `text` on hover, and on tap/keyboard focus (so it also works on a phone). */
export function infoTip(text: string): HTMLSpanElement {
  const tip = el('span', { class: 'info-tip', tabindex: '0', role: 'note', 'aria-label': text }, 'ⓘ');
  tip.addEventListener('mouseenter', () => showTip(tip, text));
  tip.addEventListener('focus', () => showTip(tip, text));
  tip.addEventListener('mouseleave', hideTip);
  tip.addEventListener('blur', hideTip);
  return tip;
}

if (typeof window !== 'undefined') window.addEventListener('scroll', hideTip, { passive: true, capture: true });

/** A "working on it" line with a spinning circle, e.g. busy('Deleting…'). */
export function busy(text: string): HTMLSpanElement {
  return el('span', { class: 'busy', role: 'status' }, el('span', { class: 'spinner', 'aria-hidden': 'true' }), text);
}
