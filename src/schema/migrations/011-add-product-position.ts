// Version 11: adds the "position" column to the Products tab (owner, 2026-11-19): the order of the products, set
// with ↑ ↓ on the Products page and used by the Offer page. Empty for every product until the first move.
// Never edit a migration after it has been released: add a new one instead.

import type { Migration } from '../migrationTypes';

export const addProductPosition: Migration = {
  toVersion: 11,
  description: 'adds the position column to the Products tab (the order of the products)',
  steps: [{ kind: 'add-columns', tab: 'Products', columns: ['position'] }],
};
