// Version 15: adds the "from_kg" column to the Discounts tab (owner, 2026-11-27): the weight of coffee on one invoice
// from which a discount applies (e.g. 10 for −25 % from 10 kg), so Kraken can pick an invoice's discount from its
// weight. Empty for every discount until the owner types it on the Packaging & discounts page.
// Never edit a migration after it has been released: add a new one instead.

import type { Migration } from '../migrationTypes';

export const addDiscountFromKg: Migration = {
  toVersion: 15,
  description: 'adds the from_kg column to the Discounts tab (the weight on an invoice from which a discount applies)',
  steps: [{ kind: 'add-columns', tab: 'Discounts', columns: ['from_kg'] }],
};
