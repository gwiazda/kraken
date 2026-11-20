// The browser's Back and Forward buttons move between Kraken's screens (owner's request, 2026-11-15).
// Each screen is an entry in the browser history with a small marker; the page itself stays one page.

export type Screen = 'lots' | 'lot-form' | 'roasts' | 'roast-form' | 'sync' | 'products' | 'product-form' | 'planner' | 'offer' | 'sales' | 'sale-form' | 'clients' | 'client-form' | 'packaging' | 'settings';

const SCREENS: readonly Screen[] = ['lots', 'lot-form', 'roasts', 'roast-form', 'sync', 'products', 'product-form', 'planner', 'offer', 'sales', 'sale-form', 'clients', 'client-form', 'packaging', 'settings'];

/** The history marker Kraken stores for a screen. */
export const stateFor = (screen: Screen) => ({ kraken: screen });

/** The screen Kraken opens on, and where an unknown history entry leads (owner, 2026-11-20: Sales). */
export const HOME_SCREEN: Screen = 'sales';

/** Which screen a history entry belongs to; anything unknown (or no marker) means the home screen (Sales). */
export function screenOf(state: unknown): Screen {
  const value = (state as { kraken?: unknown } | null)?.kraken;
  return SCREENS.includes(value as Screen) ? (value as Screen) : HOME_SCREEN;
}
