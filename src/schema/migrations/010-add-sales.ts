// Version 10: adds the "Sales" and "Sale lines" tabs (owner, 2026-11-19): what went out (a sale to a client, a
// sample left somewhere, or own use), its lines (product, bag size, bags, net price, free) and, for a sale, the
// invoice status. Never edit a migration after it has been released: add a new one instead.

import type { Migration } from '../migrationTypes';

const SAFETY = ['created_at', 'updated_at', 'created_by', 'deleted_at'];

export const addSales: Migration = {
  toVersion: 10,
  description: 'adds the Sales and Sale lines tabs',
  steps: [
    { kind: 'add-tab', tab: 'Sales', headers: ['id', 'date', 'kind', 'client_id', 'place', 'reason', 'invoice_status', 'invoice_number', 'invoice_date', 'paid_date', 'notes', ...SAFETY] },
    { kind: 'add-tab', tab: 'Sale lines', headers: ['id', 'sale_id', 'position', 'product_id', 'bag_size_g', 'bags', 'unit_price_net_pln', 'free', ...SAFETY] },
  ],
};
