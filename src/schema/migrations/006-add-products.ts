// Version 6: adds the "Products" tab (docs/REQUIREMENTS.md section 5, owner's answers of 2026-11-17).
// Never edit a migration after it has been released: add a new one instead.
// One row per product, named however the owner likes and not linked to lots: the details shown on an offer
// (country, region, altitude, processing, variety, flavour profile, brew method) and its main gross price per bag
// size (empty: no price for that size).

import type { Migration } from '../migrationTypes';

const SAFETY = ['created_at', 'updated_at', 'created_by', 'deleted_at'];

export const addProducts: Migration = {
  toVersion: 6,
  description: 'adds the Products tab',
  steps: [
    {
      kind: 'add-tab',
      tab: 'Products',
      headers: [
        'id',
        'name',
        'country',
        'region',
        'altitude',
        'processing',
        'variety',
        'flavour_profile',
        'brew_method',
        'price_250_gross_pln',
        'price_500_gross_pln',
        'price_1000_gross_pln',
        ...SAFETY,
      ],
    },
  ],
};
