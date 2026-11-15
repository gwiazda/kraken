// Version 2: adds the Lots tab (green coffee deliveries). Columns agreed with the owner on 2026-11-15
// (docs/REQUIREMENTS.md section 1). Never edit a migration after it has been released: change the structure
// with a new migration instead.

import type { Migration } from '../migrationTypes';

export const addLots: Migration = {
  toVersion: 2,
  description: 'adds the Lots tab',
  steps: [
    {
      kind: 'add-tab',
      tab: 'Lots',
      headers: [
        'id',
        'code',
        'name',
        'country',
        'region',
        'altitude',
        'process',
        'variety',
        'supplier',
        'delivery_date',
        'quantity_kg',
        'coffee_price_net_pln',
        'delivery_cost_net_pln',
        'notes',
        'roastime_container_id',
        'roastime_bean_id',
        'roastime_supplier_code',
        'created_at',
        'updated_at',
        'created_by',
        'deleted_at',
      ],
    },
  ],
};
