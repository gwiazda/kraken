// Version 5: adds the "Price list" tab (docs/REQUIREMENTS.md section 5, owner's answers of 2026-11-16).
// Never edit a migration after it has been released: add a new one instead.
// One row per price: the main (retail) gross price of a coffee in one bag size, from a date. A coffee is its country
// and coffee name as on the Lots tab, so a new delivery of the same coffee keeps its price. A new price adds a row;
// old rows stay as the price history.

import type { Migration } from '../migrationTypes';

const SAFETY = ['created_at', 'updated_at', 'created_by', 'deleted_at'];

export const addPriceList: Migration = {
  toVersion: 5,
  description: 'adds the Price list tab',
  steps: [{ kind: 'add-tab', tab: 'Price list', headers: ['id', 'country', 'coffee_name', 'bag_size_g', 'price_gross_pln', 'valid_from', ...SAFETY] }],
};
