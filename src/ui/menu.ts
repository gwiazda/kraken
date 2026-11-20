// The menu button (☰) on a phone (owner, 2026-11-20).

import { el, menuIcon } from './dom';

/**
 * On a phone the menu is a ☰ button at the right of the logo bar that opens the list of tabs (`links`); tapping
 * outside it or Esc closes it. On a computer the button is hidden and the tabs show in one row (style.css).
 */
export function phoneMenuButton(links: HTMLElement): HTMLElement {
  const toggle = el('button', { type: 'button', class: 'nav-toggle', 'aria-controls': links.id, 'aria-expanded': 'false', 'aria-label': 'Menu' });
  const setOpen = (open: boolean) => {
    toggle.closest('.app-nav')?.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.replaceChildren(menuIcon(open));
    if (open) {
      document.addEventListener('click', outside, true);
      document.addEventListener('keydown', escape);
    } else {
      document.removeEventListener('click', outside, true);
      document.removeEventListener('keydown', escape);
    }
  };
  const outside = (event: MouseEvent) => {
    if (!(event.target instanceof Node && toggle.closest('.app-nav')?.contains(event.target))) setOpen(false);
  };
  const escape = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    setOpen(false);
    toggle.focus();
  };
  toggle.addEventListener('click', () => setOpen(toggle.getAttribute('aria-expanded') !== 'true'));
  // A tab opens its page and a new menu is drawn, so the listeners of this one are removed first.
  links.addEventListener('click', (event) => {
    if (event.target instanceof Element && event.target.closest('button')) setOpen(false);
  });
  setOpen(false);
  return toggle;
}
