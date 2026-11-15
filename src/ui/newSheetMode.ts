// "Create Kraken sheet" is hidden: it is needed once, by the owner. An address with the `new-sheet` parameter
// shows it (e.g. https://gwiazda.github.io/kraken/?new-sheet). Documented in CLAUDE.md and REQUIREMENTS section 7.

/** True when the page address has the `new-sheet` parameter (any value, any letter case). `search` is `location.search`. */
export function wantsNewSheet(search: string): boolean {
  return [...new URLSearchParams(search).keys()].some((key) => key.toLowerCase() === 'new-sheet');
}
