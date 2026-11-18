// Shared price rules (owner, 2026-11-16/17; docs/REQUIREMENTS.md sections 5 and 6), used by the cost calculation,
// Products and the Offer, so every page calculates a price the same way. Pure: no Google, no screen.
// Amounts are in grosze; calculations stay exact and are rounded only where a rule says so.
//
//   gross             = net × (1 + VAT)
//   suggested price   = a calculated gross rounded to whole złoty (half up)
//   wholesale net     = main gross ÷ (1 + VAT) × (1 − discount), rounded to whole złoty (half up)
//   wholesale gross   = wholesale net × (1 + VAT) (for the invoice)

/** Gross from net: net × (1 + VAT). VAT in tenths of a percent (230 = 23 %). */
export const grossOf = (net: number, vatTenths: number) => (net * (1000 + vatTenths)) / 1000;

/** Net from gross: gross ÷ (1 + VAT). */
export const netOf = (gross: number, vatTenths: number) => (gross * 1000) / (1000 + vatTenths);

/** A calculated amount rounded to the grosz, half up (for the screen). */
export const roundGrosze = (amount: number) => Math.round(amount + 1e-9);

/**
 * An amount in grosze rounded to whole złoty, half up (74,50 → 75 zł; 74,49 → 74 zł). Gives grosze. It first rounds to
 * the grosz, as the screen shows it, so an amount shown as 74,50 zł always becomes 75 zł.
 */
export const roundToZloty = (amount: number) => roundGrosze(roundGrosze(amount) / 100) * 100;

/** A wholesale price: net rounded to whole złoty (what the customer is offered), and its gross for the invoice. */
export interface WholesalePrice {
  /** Grosze, a multiple of 100. */
  readonly net: number;
  /** Grosze, not rounded. */
  readonly gross: number;
}

/** The wholesale price from a main (retail) gross price, a discount and VAT (both in tenths of a percent). */
export function wholesalePrice(mainGrossGrosze: number, discountTenths: number, vatTenths: number): WholesalePrice {
  // Rounded once, from the exact amount (no amount before rounding is shown, so none to agree with).
  const net = roundGrosze((netOf(mainGrossGrosze, vatTenths) * (1000 - discountTenths)) / 100000) * 100;
  return { net, gross: grossOf(net, vatTenths) };
}
