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

/** A name in a list that opens its page (Products, Clients): reads like the text around it (left-aligned, wraps). */
export function nameLink(label: string, onClick: () => void): HTMLButtonElement {
  const b = button(label, onClick, 'link');
  b.classList.add('name-link');
  return b;
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
