// Version 7: adds the "Discounts" tab (owner, 2026-11-18): the wholesale discounts with their names, e.g.
// "Do 10 kg" = 15 %. Never edit a migration after it has been released: add a new one instead.
// While the tab has no rows, Kraken uses the template's discounts (15 / 25 / 30 %); the first change writes them.

import type { Migration } from '../migrationTypes';

const SAFETY = ['created_at', 'updated_at', 'created_by', 'deleted_at'];

export const addDiscounts: Migration = {
  toVersion: 7,
  description: 'adds the Discounts tab',
  steps: [{ kind: 'add-tab', tab: 'Discounts', headers: ['id', 'percent', 'name', ...SAFETY] }],
};
