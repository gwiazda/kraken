import { describe, expect, it } from 'vitest';
import { FakturowniaError, fakturowniaClient } from './fakturownia';
import { SheetsError } from './sheets';

// A fake middleman: records what Kraken sends and answers as told.
function fake(status: number, body: unknown) {
  const sent: { url: string; init: RequestInit }[] = [];
  const client = {
    getToken: () => 'google-token-1',
    fetch: async (url: string, init: RequestInit = {}) => {
      sent.push({ url, init });
      return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    },
  };
  return { sent, api: fakturowniaClient(client as never, 'https://middleman.example') };
}

describe('fakturowniaClient', () => {
  it('sends the action with the Google sign-in to the middleman, never anything about Fakturownia', async () => {
    const { sent, api } = fake(200, { id: 345, number: '12/11/2026', url: 'https://x.example/invoice/t' });
    const invoice = { orderId: 'S1', clientId: 12, sellDate: '2026-11-27', issueDate: '2026-11-28', paymentDays: 14, positions: [{ name: 'KENIA 1 kg', quantity: 8, priceNet: '112', tax: 23 }] };
    expect(await api.createInvoice(invoice)).toEqual({ id: 345, number: '12/11/2026', url: 'https://x.example/invoice/t' });
    expect(sent[0]?.url).toBe('https://middleman.example');
    expect(sent[0]?.init.method).toBe('POST');
    expect((sent[0]?.init.headers as Record<string, string>)['Authorization']).toBe('Bearer google-token-1');
    expect(JSON.parse(String(sent[0]?.init.body))).toEqual({ action: 'createInvoice', ...invoice });
  });

  it('reads each answer', async () => {
    expect(await fake(200, { role: 'partner' }).api.whoAmI()).toBe('partner');
    expect(await fake(200, { clients: [{ id: 7, name: 'Nowa Kawa' }] }).api.findClient('9876543210')).toEqual([{ id: 7, name: 'Nowa Kawa' }]);
    expect(await fake(200, { id: 12 }).api.createClient({ name: 'N', nip: '9876543210', email: '' })).toBe(12);
    expect(await fake(200, { invoice: null }).api.findInvoice('S1')).toBeNull();
    expect(await fake(200, { invoices: [{ id: 1, number: '1/11/2026', status: 'paid', paidDate: '2026-12-01', ksefStatus: null }] }).api.readInvoices([1])).toHaveLength(1);
  });

  it("shows the middleman's own words when it refuses, and asks to sign in again on 401", async () => {
    await expect(fake(403, { error: 'To może zrobić tylko właściciel.' }).api.whoAmI()).rejects.toEqual(new FakturowniaError(403, 'To może zrobić tylko właściciel.'));
    const signedOut = await fake(401, { error: 'Logowanie Google wygasło albo jest nieważne: zaloguj się ponownie.' }).api.whoAmI().catch((e: unknown) => e);
    expect(signedOut).toBeInstanceOf(SheetsError);
    expect((signedOut as SheetsError).kind).toBe('signed-out');
  });

  it('says so when the middleman cannot be reached', async () => {
    const api = fakturowniaClient({ getToken: () => 't', fetch: async () => Promise.reject(new TypeError('Failed to fetch')) } as never, 'https://middleman.example');
    await expect(api.whoAmI()).rejects.toEqual(new FakturowniaError(0, 'Nie udało się połączyć z Fakturownią (brak internetu?). Spróbuj ponownie.'));
  });
});
