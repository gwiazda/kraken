// Version 17: the invoice Kraken issued in Fakturownia for a sale (owner, 2026-11-28; docs/FAKTUROWNIA.md): Fakturownia's
// invoice id (to read later whether it is paid) and the link to its page there. The invoice number goes in the
// "invoice_number" column the Sales tab already has.
// Never edit a migration after it has been released: add a new one instead.

import type { Migration } from '../migrationTypes';

export const addSaleInvoiceLink: Migration = {
  toVersion: 17,
  description: 'adds fakturownia_id and fakturownia_url to Sales (the invoice Kraken issued in Fakturownia)',
  steps: [{ kind: 'add-columns', tab: 'Sales', columns: ['fakturownia_id', 'fakturownia_url'] }],
};
