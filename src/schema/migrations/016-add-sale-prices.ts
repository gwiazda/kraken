// Version 16: prices saved with each sale (owner, 2026-11-27). The price itself goes in the "unit_price_net_pln"
// column the Sale lines tab already has (migration 10, empty until now). Added: "price_kind" on Sale lines (whether
// the price is the client's special price or the discounted one) and "discount_percent" on Sales (the discount the
// sale's weight got), so a saved sale can always show why its prices are what they are.
// Never edit a migration after it has been released: add a new one instead.

import type { Migration } from '../migrationTypes';

export const addSalePrices: Migration = {
  toVersion: 16,
  description: 'adds price_kind to Sale lines and discount_percent to Sales (prices saved with each sale)',
  steps: [
    { kind: 'add-columns', tab: 'Sales', columns: ['discount_percent'] },
    { kind: 'add-columns', tab: 'Sale lines', columns: ['price_kind'] },
  ],
};
