// Version 12: adds the "Special prices" tab (owner, 2026-11-20; docs/REQUIREMENTS.md section 5): a fixed net price
// agreed with one client for one product and bag size, with the retail price at the time it was set.
// Never edit a migration after it has been released: add a new one instead.

import type { Migration } from '../migrationTypes';

const SAFETY = ['created_at', 'updated_at', 'created_by', 'deleted_at'];

export const addSpecialPrices: Migration = {
  toVersion: 12,
  description: 'adds the Special prices tab (prices agreed with one client)',
  steps: [{ kind: 'add-tab', tab: 'Special prices', headers: ['id', 'client_id', 'product_id', 'bag_size_g', 'price_net_pln', 'retail_gross_pln_at_deal', ...SAFETY] }],
};
