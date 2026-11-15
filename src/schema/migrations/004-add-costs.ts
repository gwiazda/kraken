// Version 4: adds the tabs for "Costs & prices" (docs/REQUIREMENTS.md section 6, owner's answers of 2026-11-16).
// Never edit a migration after it has been released: add a new one instead.
// "Cost settings", not "Settings": a hand-made tab with a common name would stop the update.
// - Cost settings: VAT %, markups and the default roast loss %, one row per setting (name, value).
// - Bag sizes: 250 g, 1 kg, ... (also used later by invoice requests and price lists).
// - Bag costs: what goes into one bag of a size besides the coffee (bag, label, valve, ...), net PLN.
// - Lot costs: the owner's own roast loss % for a lot (empty: the average of its roasts is used).

import type { Migration } from '../migrationTypes';

const SAFETY = ['created_at', 'updated_at', 'created_by', 'deleted_at'];

export const addCosts: Migration = {
  toVersion: 4,
  description: 'adds the Cost settings, Bag sizes, Bag costs and Lot costs tabs (for Costs & prices)',
  steps: [
    { kind: 'add-tab', tab: 'Cost settings', headers: ['id', 'name', 'value', ...SAFETY] },
    { kind: 'add-tab', tab: 'Bag sizes', headers: ['id', 'size_g', ...SAFETY] },
    { kind: 'add-tab', tab: 'Bag costs', headers: ['id', 'bag_size_id', 'item', 'cost_net_pln', ...SAFETY] },
    { kind: 'add-tab', tab: 'Lot costs', headers: ['id', 'lot_id', 'roast_loss_percent', ...SAFETY] },
  ],
};
