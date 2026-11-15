// Date helpers. Pure functions: no browser, no Google.

/** The local calendar date as YYYY-MM-DD (what the user sees on their computer's calendar). */
export function localDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
