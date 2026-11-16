// Exact decimal numbers. Money is kept in grosze and weight in grams (whole numbers), so 0.1 + 0.2 is never
// 0.30000000000000004 on a price. Pure functions: no browser, no Google.

/**
 * Reads a non-negative decimal typed by a person ("1234.56", "1 234,56", "60") as a whole number of its smallest unit
 * (`decimals` = 2: grosze, 3: grams). Empty text gives null. Anything else (letters, negatives, too many decimals)
 * gives undefined, so the caller can show "not a number".
 */
export function parseDecimal(text: string, decimals: number): number | null | undefined {
  const cleaned = text.replace(/[\s ]/g, '');
  if (cleaned === '') return null;
  const match = /^(\d+)(?:[.,](\d*))?$/.exec(cleaned);
  if (!match) return undefined;
  const fraction = match[2] ?? '';
  if (fraction.length > decimals) return undefined;
  const value = Number(match[1]) * 10 ** decimals + Number(fraction.padEnd(decimals, '0') || '0');
  return Number.isSafeInteger(value) ? value : undefined;
}

/** The stored form: "1234.56" for 123456 with 2 decimals, "60" for 60000 with 3 (no trailing zeros). */
export function toDecimalText(units: number, decimals: number): string {
  if (!Number.isSafeInteger(units) || units < 0) throw new Error(`Not a whole non-negative amount: ${units}`);
  const scale = 10 ** decimals;
  const whole = Math.floor(units / scale);
  const fraction = String(units % scale).padStart(decimals, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : String(whole);
}

/** a ÷ b rounded half up, for whole non-negative numbers (e.g. grosze per kg). */
export function divideRounded(a: number, b: number): number {
  if (b <= 0) throw new Error('Division by zero or a negative number');
  return Math.floor((2 * a + b) / (2 * b));
}

export const parseMoney = (text: string) => parseDecimal(text, 2);
export const moneyText = (grosze: number) => toDecimalText(grosze, 2);
export const parseKg = (text: string) => parseDecimal(text, 3);
export const kgText = (grams: number) => toDecimalText(grams, 3);

/** For the screen: "1 234,56 zł" (Polish style: space between thousands, comma before grosze). */
export function formatPln(grosze: number): string {
  const whole = Math.floor(grosze / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${whole},${String(grosze % 100).padStart(2, '0')} zł`;
}

/** For the screen, whole złoty without the grosze: "59 zł", "1 234 zł" (other amounts as formatPln). */
export function formatWholePln(grosze: number): string {
  return formatPln(grosze).replace(/,00(?=\szł$)/, '');
}

/** For the screen: "60 kg", "21,5 kg". */
export function formatKg(grams: number): string {
  return `${kgText(grams).replace('.', ',')} kg`;
}
