// Version 3: adds the Roasts tab (roasting log). Columns agreed with the owner on 2026-11-15
// (docs/REQUIREMENTS.md section 3). Never edit a migration after it has been released: add a new one instead.
// RoasTime gives the roast; the owner adds the lot (only to override the automatic oldest-lot-first choice),
// the sample mark and notes.

import type { Migration } from '../migrationTypes';

export const addRoasts: Migration = {
  toVersion: 3,
  description: 'adds the Roasts tab',
  steps: [
    {
      kind: 'add-tab',
      tab: 'Roasts',
      headers: [
        'id',
        'roasted_at',
        'roast_name',
        'green_g',
        'roasted_g',
        'lot_id',
        'sample',
        'notes',
        'roastime_roast_id',
        'roastime_bean_id',
        'created_at',
        'updated_at',
        'created_by',
        'deleted_at',
      ],
    },
  ],
};
