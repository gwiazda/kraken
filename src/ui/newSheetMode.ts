// "Create Kraken sheet" is hidden: it is needed once, by the owner. Opening Kraken with `?new-sheet` at the end of
// the address shows it (e.g. https://gwiazda.github.io/kraken/?new-sheet). Documented in CLAUDE.md.

/** True when the page address asks for the "Create Kraken sheet" button. `search` is `location.search`. */
export function wantsNewSheet(search: string): boolean {
  return new URLSearchParams(search).has('new-sheet');
}
