// Version 14: adds the "status" column to the Products tab (owner, 2026-11-26): on sale (empty), trial ("trial") or
// withdrawn ("retired"). Empty for every product, so the products already there stay on sale.
// Never edit a migration after it has been released: add a new one instead.

import type { Migration } from '../migrationTypes';

export const addProductStatus: Migration = {
  toVersion: 14,
  description: 'adds the status column to the Products tab (on sale, trial or withdrawn)',
  steps: [{ kind: 'add-columns', tab: 'Products', columns: ['status'] }],
};
