// Percentages as Kraken reads, stores and shows them (VAT, roast loss, discounts), in one place for every feature.
// Kept in tenths of a percent (155 = 15,5 %). Pure: no Google, no screen.

import { parseDecimal, toDecimalText } from '../core/numbers';

/** A percentage typed by a person: "23", "15,5" → tenths. Null if empty, undefined if not a valid percentage below 100. */
export function parsePercent(value: string): number | null | undefined {
  const tenths = parseDecimal(value, 1);
  if (tenths === null || tenths === undefined) return tenths;
  return tenths < 1000 ? tenths : undefined;
}

/**
 * A percentage as Kraken stores and accepts it: 0, or at least 1 % (e.g. "15.5"). A cell typed by hand as "20%" in
 * Google Sheets arrives as 0.2, which would silently read as 0,2 %; so values between 0 and 1 % are refused (the page
 * says the cell cannot be read, and the forms ask for e.g. 15 instead of 0,15).
 */
export function percentFromCell(value: string): number | null | undefined {
  const tenths = parsePercent(value);
  return typeof tenths === 'number' && tenths > 0 && tenths < 10 ? undefined : tenths;
}

export const percentText = (tenths: number) => toDecimalText(tenths, 1);
/** For the screen: "23 %", "15,5 %". */
export const formatPercent = (tenths: number) => `${percentText(tenths).replace('.', ',')} %`;
