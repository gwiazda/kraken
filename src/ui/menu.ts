// The menu button (☰) on a phone (owner, 2026-11-20).

import { el, menuIcon } from './dom';

/**
 * On a phone the menu is a ☰ button at the right of the logo bar that opens the list of tabs (`links`); tapping
 * outside it or Esc closes it. On a computer the button is hidden and the tabs show in one row (style.css).
 * The button must be put in the same `.app-nav` as `links`.
 */
export function phoneMenuButton(links: HTMLElement): HTMLButtonElement {
  listenOnce();
  const toggle = el('button', { type: 'button', class: 'nav-toggle', 'aria-controls': links.id, 'aria-expanded': 'false', 'aria-label': 'Menu' });
  toggle.append(menuIcon(false));
  toggle.addEventListener('click', () => {
    const nav = toggle.closest<HTMLElement>('.app-nav');
    if (nav) setOpen(nav, !nav.classList.contains('open'));
  });
  // Choosing a tab closes the list (the page usually draws a new menu anyway; while saving it stays on this one).
  links.addEventListener('click', (event) => {
    const nav = links.closest<HTMLElement>('.app-nav');
    if (nav && event.target instanceof Element && event.target.closest('button')) setOpen(nav, false);
  });
  return toggle;
}

function setOpen(nav: HTMLElement, open: boolean): void {
  nav.classList.toggle('open', open);
  const toggle = nav.querySelector('.nav-toggle');
  toggle?.setAttribute('aria-expanded', String(open));
  toggle?.replaceChildren(menuIcon(open));
}

let listening = false;

/**
 * One pair of listeners for the whole page, acting on whichever menu is open at that moment. So a menu replaced
 * while open (e.g. after Back) leaves nothing behind.
 */
function listenOnce(): void {
  if (listening) return;
  listening = true;
  // A tap outside the open list only closes it: it does not also press what is underneath (e.g. a card).
  document.addEventListener(
    'click',
    (event) => {
      const nav = document.querySelector<HTMLElement>('.app-nav.open');
      if (!nav || (event.target instanceof Node && nav.contains(event.target))) return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(nav, false);
    },
    true,
  );
  document.addEventListener('keydown', (event) => {
    const nav = document.querySelector<HTMLElement>('.app-nav.open');
    if (event.key !== 'Escape' || !nav) return;
    setOpen(nav, false);
    nav.querySelector<HTMLElement>('.nav-toggle')?.focus();
  });
}
