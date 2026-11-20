// Date helpers. Pure functions: no browser, no Google.

/** The local calendar date as YYYY-MM-DD (what the user sees on their computer's calendar). */
export function localDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** True for a real calendar date written as YYYY-MM-DD. */
export function isValidDate(text: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** YYYY-MM-DD plus some days (calendar days, no time zones involved). */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const result = new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, (d ?? 1) + days));
  return result.toISOString().slice(0, 10);
}

/** A YYYY-MM-DD date the Polish way, for the screen: "2026-11-20" → "20.11.2026" (other text is left as it is). */
export function formatDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : date;
}

/** A date and time the Polish way: "20.11.2026 09:30" (local time). */
export function formatDateTime(time: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${formatDate(localDate(time))} ${pad(time.getHours())}:${pad(time.getMinutes())}`;
}
