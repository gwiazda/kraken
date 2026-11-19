// Version 9: adds the "Clients" tab (owner, 2026-11-19): the businesses Krak works with (short name, NIP, email,
// registered name in CEIDG, wholesale discount). Never edit a migration after it has been released: add a new one.

import type { Migration } from '../migrationTypes';

const SAFETY = ['created_at', 'updated_at', 'created_by', 'deleted_at'];

export const addClients: Migration = {
  toVersion: 9,
  description: 'adds the Clients tab',
  steps: [{ kind: 'add-tab', tab: 'Clients', headers: ['id', 'name', 'nip', 'email', 'registered_name', 'discount_percent', ...SAFETY] }],
};
