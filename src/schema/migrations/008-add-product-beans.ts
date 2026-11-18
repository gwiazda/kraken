// Version 8: adds the "Product beans" tab (owner, 2026-11-18): what a product is made of, up to 3 beans each with
// its share of the bag. Never edit a migration after it has been released: add a new one instead.
// A bean is either a lot (lot_id) or a planned bean not bought yet (planned_name, its price per kg with delivery,
// and optionally its roast loss; empty: the usual loss).

import type { Migration } from '../migrationTypes';

const SAFETY = ['created_at', 'updated_at', 'created_by', 'deleted_at'];

export const addProductBeans: Migration = {
  toVersion: 8,
  description: 'adds the Product beans tab',
  steps: [
    {
      kind: 'add-tab',
      tab: 'Product beans',
      headers: ['id', 'product_id', 'position', 'lot_id', 'planned_name', 'planned_price_per_kg_pln', 'planned_roast_loss_percent', 'share_percent', ...SAFETY],
    },
  ],
};
