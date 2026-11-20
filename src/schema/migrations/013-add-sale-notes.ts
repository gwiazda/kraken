// Version 13: adds the "Sale notes" tab (owner, 2026-11-20): a dated follow-up log on a sample ("called, they liked
// the Kenia"). Never edit a migration after it has been released: add a new one instead.

import type { Migration } from '../migrationTypes';

const SAFETY = ['created_at', 'updated_at', 'created_by', 'deleted_at'];

export const addSaleNotes: Migration = {
  toVersion: 13,
  description: 'adds the Sale notes tab (follow-up notes on samples)',
  steps: [{ kind: 'add-tab', tab: 'Sale notes', headers: ['id', 'sale_id', 'date', 'text', ...SAFETY] }],
};
