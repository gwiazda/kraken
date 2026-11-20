// Polish words that change with a number (owner, 2026-11-20: Kraken in Polish): 1 wypał, 2 wypały, 5 wypałów,
// 22 wypały, 12 wypałów. Pure: no screen.

/**
 * The form of a word for a number: `one` for 1, `few` for 2–4, 22–24, 32–34… (but not 12–14), `many` for the rest
 * (0, 5–21, 25–31…). E.g. plural(5, 'torebka', 'torebki', 'torebek') → 'torebek'.
 */
export function plural(n: number, one: string, few: string, many: string): string {
  if (!Number.isInteger(n)) return few; // 1,5 torebki
  const whole = Math.abs(n);
  if (whole === 1) return one;
  const last = whole % 10;
  const lastTwo = whole % 100;
  return last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14) ? few : many;
}

/** The number with its word, with a Polish decimal comma: count(5, …) → "5 torebek", count(1.5, …) → "1,5 torebki". */
export const count = (n: number, one: string, few: string, many: string) => `${String(n).replace('.', ',')} ${plural(n, one, few, many)}`;
