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

export function message(text: string, kind: 'info' | 'error' = 'info'): HTMLParagraphElement {
  return el('p', { class: kind === 'error' ? 'message message-error' : 'message muted', role: kind === 'error' ? 'alert' : 'status' }, text);
}

/** A small ⓘ that shows `text` on hover, and on tap/keyboard focus (so it also works on a phone). */
export function infoTip(text: string): HTMLSpanElement {
  return el('span', { class: 'info-tip', tabindex: '0', role: 'note', 'aria-label': text, 'data-tip': text }, 'ⓘ');
}

/** A "working on it" line with a spinning circle, e.g. busy('Deleting…'). */
export function busy(text: string): HTMLSpanElement {
  return el('span', { class: 'busy', role: 'status' }, el('span', { class: 'spinner', 'aria-hidden': 'true' }), text);
}
