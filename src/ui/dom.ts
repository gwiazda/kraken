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
 * buttons; the same on every tab). Buttons, links, form fields and the drag grip inside the row keep their own click;
 * selecting text does not open it; nothing opens while Kraken is saving. Keyboard: the row can be reached with Tab and
 * opened with Enter. `label` is read out by screen readers, e.g. "Open KENIA".
 */
export function clickableRow<T extends HTMLTableRowElement>(tr: T, open: () => void, label: string): T {
  tr.classList.add('row-link');
  tr.tabIndex = 0;
  tr.setAttribute('aria-label', label);
  const blocked = (target: EventTarget | null) =>
    tr.closest('.saving') !== null || (target instanceof Element && target.closest('button, a, input, select, textarea, label, .drag-handle') !== null);
  tr.addEventListener('click', (event) => {
    if (blocked(event.target) || (window.getSelection()?.toString() ?? '') !== '') return;
    open();
  });
  tr.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.target !== tr || blocked(null)) return;
    event.preventDefault();
    open();
  });
  return tr;
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
