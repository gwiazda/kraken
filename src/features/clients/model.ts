// Clients (owner, 2026-11-19): the businesses Krak works with, as in the owner's old sheet: the short name used day
// to day, NIP (tax ID), email, the registered name (CEIDG) and their wholesale discount (one of those set under
// Packaging & discounts). Pure: no Google, no screen. Real client data is never in the code or tests.

import { parseDecimal, toDecimalText } from '../../core/numbers';

type Fields = Readonly<Record<string, string>>;

export const CLIENTS_TAB = 'Clients';
export const CLIENT_COLUMNS = ['name', 'nip', 'email', 'registered_name', 'discount_percent'] as const;

export interface Client {
  readonly id: string;
  readonly row: number;
  /** The short name used day to day, e.g. "Café Nowa". */
  readonly name: string;
  /** 10 digits, as stored; '' when not given. */
  readonly nip: string;
  readonly email: string;
  /** The official name in CEIDG (the business register). */
  readonly registeredName: string;
  /** Tenths of a percent (150 = 15 %); null for no discount, or when the cell cannot be read. */
  readonly discountTenths: number | null;
  readonly discountText: string;
  /** Cells Kraken could not read, one sentence each. */
  readonly problems: readonly string[];
  readonly deletedAt: string;
  readonly source: Fields;
}

const text = (fields: Fields, name: string) => (fields[name] ?? '').trim();

/** A NIP with spaces and dashes taken out ("123-456-32-18" → "1234563218"). */
export const cleanNip = (value: string) => value.replace(/[\s-]/g, '');

/** True for a valid Polish NIP: 10 digits whose last one is the check digit (weights 6 5 7 2 3 4 5 6 7, mod 11). */
export function isValidNip(value: string): boolean {
  const nip = cleanNip(value);
  if (!/^\d{10}$/.test(nip)) return false;
  const weights = [6, 5, 7, 2, 3, 4, 5, 6, 7];
  const sum = weights.reduce((total, w, i) => total + w * Number(nip[i]), 0) % 11;
  return sum !== 10 && sum === Number(nip[9]);
}

/** "123-456-32-18" for the screen (the usual way of writing a NIP). */
export function formatNip(nip: string): string {
  const n = cleanNip(nip);
  return /^\d{10}$/.test(n) ? `${n.slice(0, 3)}-${n.slice(3, 6)}-${n.slice(6, 8)}-${n.slice(8)}` : nip;
}

/** A discount percentage in tenths, 1 to 99,9 % ("15", "12.5"); a "15%" cell arrives as 0.15 and is refused. */
function discountTenths(value: string): number | null {
  const tenths = parseDecimal(value, 1);
  return typeof tenths === 'number' && tenths >= 10 && tenths < 1000 ? tenths : null;
}

export function clientFromFields(fields: Fields, row: number): Client {
  const name = text(fields, 'name');
  const problems: string[] = [];
  const nip = text(fields, 'nip');
  if (nip !== '' && !isValidNip(nip)) problems.push(`The NIP "${nip}" of ${name || `row ${row}`} is not a valid Polish tax ID. Edit the client to correct it.`);
  const discountText = text(fields, 'discount_percent');
  const discount = discountText === '' ? null : discountTenths(discountText);
  if (discountText !== '' && discount === null) problems.push(`The discount "${discountText}" of ${name || `row ${row}`} cannot be read. Edit the client to correct it.`);
  return {
    id: text(fields, 'id'),
    row,
    name,
    nip,
    email: text(fields, 'email'),
    registeredName: text(fields, 'registered_name'),
    discountTenths: discount,
    discountText,
    problems,
    deletedAt: text(fields, 'deleted_at'),
    source: fields,
  };
}

export const isDeleted = (client: Client) => client.deletedAt !== '';

/** Active clients by name (Polish alphabetical order), then deleted ones. */
export function sortClients(clients: readonly Client[]): Client[] {
  return [...clients].sort((a, b) => Number(isDeleted(a)) - Number(isDeleted(b)) || a.name.localeCompare(b.name, 'pl') || a.row - b.row);
}

// ---- The form ----

export interface ClientForm {
  name: string;
  nip: string;
  email: string;
  registeredName: string;
  /** The discount chosen, as tenths in text ("150"), or '' for none. */
  discount: string;
}

export type ClientFormErrors = Partial<Record<keyof ClientForm, string>>;

export const emptyClientForm = (): ClientForm => ({ name: '', nip: '', email: '', registeredName: '', discount: '' });

export const formFromClient = (c: Client): ClientForm => ({
  name: c.name,
  nip: c.nip,
  email: c.email,
  registeredName: c.registeredName,
  discount: c.discountTenths === null ? '' : String(c.discountTenths),
});

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Checks the form; on success gives every column to store. `others`: the other clients, deleted ones included (a
 * name or NIP can be there only once, so a client is never added twice by mistake).
 */
export function validateClientForm(form: ClientForm, others: readonly Client[]): { ok: true; fields: Record<string, string> } | { ok: false; errors: ClientFormErrors } {
  const errors: ClientFormErrors = {};
  const name = form.name.trim().replace(/\s+/g, ' ');
  if (name === '') errors.name = 'Enter the name you use for this client, e.g. Café Nowa.';
  else if (name.length > 100) errors.name = 'At most 100 characters.';
  else if (others.some((c) => c.name.toLowerCase() === name.toLowerCase())) errors.name = 'Another client already has this name.';
  const nip = cleanNip(form.nip);
  if (nip !== '' && !isValidNip(nip)) errors.nip = 'This is not a valid NIP: 10 digits, e.g. 123-456-32-18. Check it, or leave it empty.';
  else if (nip !== '' && others.some((c) => cleanNip(c.nip) === nip)) errors.nip = 'Another client already has this NIP.';
  const email = form.email.trim();
  if (email !== '' && !EMAIL.test(email)) errors.email = 'Enter an email address, e.g. kawiarnia@example.com, or leave it empty.';
  const registeredName = form.registeredName.trim().replace(/\s+/g, ' ');
  if (registeredName.length > 200) errors.registeredName = 'At most 200 characters.';
  const discount = form.discount === '' ? null : Number(form.discount);
  if (discount !== null && !(Number.isInteger(discount) && discount >= 10 && discount < 1000)) errors.discount = 'Choose a discount from the list.';
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    fields: { name, nip, email, registered_name: registeredName, discount_percent: discount === null ? '' : toDecimalText(discount, 1) },
  };
}

/** Only the columns whose value differs from the client as loaded (an edit writes only what changed). */
export function changedClientFields(client: Client, fields: Readonly<Record<string, string>>): Record<string, string> {
  const changed: Record<string, string> = {};
  for (const [column, value] of Object.entries(fields)) if (text(client.source, column) !== value) changed[column] = value;
  return changed;
}
