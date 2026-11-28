// Talking to Fakturownia through Kraken's middleman (docs/FAKTUROWNIA.md): Kraken never has the Fakturownia token. Each
// call sends the signed-in owner's Google access token, which the middleman checks with Google; the middleman answers
// in Polish ({ error }) when it refuses, and those words are shown as they are.

import { FAKTUROWNIA_PROXY_URL } from '../config';
import { SheetsError, type SheetsClient } from './sheets';

export type FakturowniaRole = 'owner' | 'partner';

/** An invoice Kraken made: Fakturownia's id, its number ("12/11/2026") and its own page in Fakturownia. */
export interface IssuedInvoice {
  readonly id: number;
  readonly number: string;
  readonly url: string;
}

export interface InvoiceState {
  readonly id: number;
  readonly number: string;
  /** Fakturownia's invoice status: "issued", "sent", "paid", "partial", "rejected". */
  readonly status: string;
  readonly paidDate: string | null;
  readonly ksefStatus: string | null;
}

export interface InvoiceLine {
  readonly name: string;
  readonly quantity: number;
  /** Net price of one, in złoty as text: "112", "30.5". */
  readonly priceNet: string;
  /** The line's gross total (quantity × net price + VAT, to the grosz), in złoty as text: "1102.08". */
  readonly totalGross: string;
  readonly tax: number;
}

export interface NewInvoice {
  /** The sale's id: the invoice's mark, so it is never made twice. */
  readonly orderId: string;
  readonly clientId: number;
  readonly sellDate: string;
  readonly issueDate: string;
  readonly paymentDays: number;
  readonly positions: readonly InvoiceLine[];
}

/** What Kraken can ask Fakturownia (the middleman allows exactly these). */
export interface Fakturownia {
  whoAmI(): Promise<FakturowniaRole>;
  /** Fakturownia's clients with exactly this NIP, with the e-mail on their card ('' when none). */
  findClient(nip: string): Promise<{ id: number; name: string; email: string }[]>;
  createClient(client: { name: string; nip: string; email: string }): Promise<number>;
  createInvoice(invoice: NewInvoice): Promise<IssuedInvoice>;
  /** The invoice Kraken made for a sale, if Fakturownia has it (after an answer that was lost). */
  findInvoice(orderId: string): Promise<IssuedInvoice | null>;
  readInvoices(ids: readonly number[]): Promise<InvoiceState[]>;
}

/** A refusal or error from the middleman or Fakturownia, with the words to show. */
export class FakturowniaError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function fakturowniaClient(client: SheetsClient, url = FAKTUROWNIA_PROXY_URL): Fakturownia {
  async function call<T>(action: string, data: Record<string, unknown> = {}): Promise<T> {
    const token = client.getToken(); // signed out: its own error (sign in), not "no internet"
    let response: Response;
    try {
      response = await client.fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...data }),
      });
    } catch {
      throw new FakturowniaError(0, 'Nie udało się połączyć z Fakturownią (brak internetu?). Spróbuj ponownie.');
    }
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    // The Google sign-in expired or is missing: the same as for Sheets, Kraken asks to sign in again.
    if (response.status === 401) throw new SheetsError('signed-out', 401, typeof body['error'] === 'string' ? body['error'] : 'Zaloguj się ponownie.');
    if (!response.ok) throw new FakturowniaError(response.status, typeof body['error'] === 'string' ? body['error'] : `Fakturownia: błąd ${response.status}.`);
    return body as T;
  }
  return {
    whoAmI: async () => (await call<{ role: FakturowniaRole }>('whoAmI')).role,
    findClient: async (nip) => (await call<{ clients: { id: number; name: string; email: string }[] }>('findClient', { nip })).clients,
    createClient: async (c) => (await call<{ id: number }>('createClient', { name: c.name, nip: c.nip, email: c.email })).id,
    createInvoice: (invoice) => call<IssuedInvoice>('createInvoice', { ...invoice }),
    findInvoice: async (orderId) => (await call<{ invoice: IssuedInvoice | null }>('findInvoice', { orderId })).invoice,
    readInvoices: async (ids) => (await call<{ invoices: InvoiceState[] }>('readInvoices', { ids })).invoices,
  };
}
