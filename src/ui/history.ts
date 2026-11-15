// The browser's Back and Forward buttons move between Kraken's screens (owner's request, 2026-11-15).
// Each screen is an entry in the browser history with a small marker; the page itself stays one page.

export type Screen = 'lots' | 'lot-form' | 'roasts' | 'roast-form' | 'sync' | 'costs' | 'settings';

const SCREENS: readonly Screen[] = ['lots', 'lot-form', 'roasts', 'roast-form', 'sync', 'costs', 'settings'];

/** The history marker Kraken stores for a screen. */
export const stateFor = (screen: Screen) => ({ kraken: screen });

/** Which screen a history entry belongs to; anything unknown (or no marker) means the Lots list. */
export function screenOf(state: unknown): Screen {
  const value = (state as { kraken?: unknown } | null)?.kraken;
  return SCREENS.includes(value as Screen) ? (value as Screen) : 'lots';
}
