import { describe, expect, it } from 'vitest';
import { GOOGLE_CLIENT_ID } from '../../src/config';
import { bankAccount, handle, type Env } from './index';

// Made-up people, domain and token only (the repo is public).
const env: Env = { FAKTUROWNIA_TOKEN: 'secret-token-123', FAKTUROWNIA_DOMAIN: 'example-roastery', OWNER_EMAIL: 'owner@example.com', PARTNER_EMAIL: 'partner@example.com' };
const KRAKEN = 'https://gwiazda.github.io';

interface Call {
  url: string;
  init?: RequestInit;
}

/**
 * A fake Google and Fakturownia. `people`: Google access token → email; `clientOf`: token → the OAuth client it was
 * made for (Kraken's by default). `fakturownia`: what Fakturownia answers for a path (method + path → status, body).
 */
function fakeNet(fakturownia: Record<string, [number, unknown]> = {}, clientOf: Record<string, string> = {}) {
  const people: Record<string, string> = { 'goog-owner-token': 'owner@example.com', 'goog-partner-token': 'Partner@Example.com', 'goog-stranger-token': 'someone@example.com' };
  const calls: Call[] = [];
  const fetchFn = async (url: string, init?: RequestInit): Promise<Response> => {
    calls.push({ url, ...(init ? { init } : {}) });
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    if (url.startsWith('https://oauth2.googleapis.com/tokeninfo?access_token=')) {
      const token = decodeURIComponent(url.split('=')[1] ?? '');
      return people[token] ? json(200, { azp: clientOf[token] ?? GOOGLE_CLIENT_ID, aud: clientOf[token] ?? GOOGLE_CLIENT_ID, expires_in: 3000 }) : json(400, { error: 'invalid_token' });
    }
    if (url.startsWith('https://www.googleapis.com/drive/v3/about')) {
      const token = String((init?.headers as Record<string, string>)['Authorization']).replace('Bearer ', '');
      return people[token] ? json(200, { user: { emailAddress: people[token] } }) : json(401, {});
    }
    const key = `${init?.method ?? 'GET'} ${url.replace('https://example-roastery.fakturownia.pl', '')}`;
    const answer = fakturownia[key];
    return answer ? json(answer[0], answer[1]) : json(404, { error: 'not found' });
  };
  return { calls, fetchFn };
}

const request = (body: unknown, o: { token?: string; origin?: string; method?: string } = {}) =>
  new Request('https://kraken-fakturownia.example.workers.dev/', {
    method: o.method ?? 'POST',
    headers: { Origin: o.origin ?? KRAKEN, ...(o.token === '' ? {} : { Authorization: `Bearer ${o.token ?? 'goog-owner-token'}` }), 'Content-Type': 'application/json' },
    ...(o.method === 'OPTIONS' || o.method === 'GET' ? {} : { body: JSON.stringify(body) }),
  });

const call = async (body: unknown, o: Parameters<typeof request>[1] = {}, fakturownia: Record<string, [number, unknown]> = {}, clientOf: Record<string, string> = {}) => {
  const net = fakeNet(fakturownia, clientOf);
  const response = await handle(request(body, o), env, net.fetchFn);
  const text = await response.text();
  return { status: response.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : null, headers: response.headers, calls: net.calls };
};

describe('the gatekeeper', () => {
  it("answers the browser's CORS check only for Kraken's own addresses", async () => {
    const ok = await call(null, { method: 'OPTIONS' });
    expect(ok.status).toBe(204);
    expect(ok.headers.get('Access-Control-Allow-Origin')).toBe(KRAKEN);
    expect(ok.headers.get('Access-Control-Allow-Headers')).toBe('Authorization, Content-Type');
    expect((await call(null, { method: 'OPTIONS', origin: 'http://localhost:5173' })).status).toBe(204);
    for (const origin of ['https://evil.example', '', 'https://gwiazda.github.io.evil.example']) {
      const refused = await call({ action: 'readInvoices', ids: [1] }, { origin });
      expect(refused.status).toBe(403);
      expect(refused.headers.get('Access-Control-Allow-Origin')).toBeNull();
      expect(refused.calls).toEqual([]); // nothing asked of Google or Fakturownia
    }
  });

  it('refuses without a Google sign-in, with one Google does not know, or one made for another app', async () => {
    expect((await call({ action: 'readInvoices', ids: [1] }, { token: '' })).status).toBe(401);
    expect((await call({ action: 'readInvoices', ids: [1] }, { token: 'goog-unknown-token' })).status).toBe(401);
    const otherApp = await call({ action: 'readInvoices', ids: [1] }, { token: 'goog-owner-token' }, {}, { 'goog-owner-token': 'someone-elses-app.apps.googleusercontent.com' });
    expect(otherApp).toMatchObject({ status: 401, body: { error: 'To logowanie nie pochodzi z Krakena.' } });
    expect(otherApp.calls.some((c) => c.url.includes('fakturownia'))).toBe(false);
  });

  it('lets in only the owner and the partner (capitals ignored), and only the owner may issue', async () => {
    const stranger = await call({ action: 'readInvoices', ids: [1] }, { token: 'goog-stranger-token' });
    expect(stranger).toMatchObject({ status: 403, body: { error: 'To konto Google nie ma dostępu do Fakturowni.' } });
    for (const action of ['findClient', 'createClient', 'createInvoice', 'findInvoice']) {
      const partner = await call({ action, nip: '9876543210' }, { token: 'goog-partner-token' });
      expect(partner).toMatchObject({ status: 403, body: { error: 'To może zrobić tylko właściciel.' } });
      expect(partner.calls.some((c) => c.url.includes('fakturownia'))).toBe(false);
    }
    const reading = await call({ action: 'readInvoices', ids: [5] }, { token: 'goog-partner-token' }, { 'GET /invoices/5.json?fields[invoice]=id,number,status,paid_date,gov_status,gov_id,gov_error_messages': [200, { id: 5, number: '1', status: 'issued' }] });
    expect(reading.status).toBe(200);
  });

  it('refuses anything not on the list: deleting, sending to KSeF, listing every client', async () => {
    for (const action of ['deleteInvoice', 'sendToKsef', 'listClients', '', 42]) {
      expect(await call({ action })).toMatchObject({ status: 400, body: { error: 'Nieznane działanie.' } });
    }
    expect((await call({ action: 'readInvoices' }, { method: 'GET' })).status).toBe(405);
  });

  it('says so when its secrets are not set up, and never shows the token', async () => {
    const net = fakeNet();
    const response = await handle(request({ action: 'readInvoices', ids: [1] }), { ...env, FAKTUROWNIA_TOKEN: '' }, net.fetchFn);
    expect(response.status).toBe(500);
    // A Fakturownia address typed with ".fakturownia.pl" (or capitals) is a setup problem, not bad data from Kraken.
    for (const domain of ['example-roastery.fakturownia.pl', 'Example', 'https://x']) {
      const wrong = await handle(request({ action: 'readInvoices', ids: [1] }), { ...env, FAKTUROWNIA_DOMAIN: domain }, fakeNet().fetchFn);
      expect(wrong.status).toBe(500);
    }
    const refused = await call({ action: 'readInvoices', ids: [1] }, {}, { 'GET /invoices/1.json?fields[invoice]=id,number,status,paid_date,gov_status,gov_id,gov_error_messages': [401, {}] });
    expect(refused.status).toBe(502);
    expect(JSON.stringify(refused.body)).not.toContain('secret-token-123');
  });
});

describe('the actions', () => {
  it('finds a client by exactly this NIP, with the token in the header (never in the address)', async () => {
    const r = await call({ action: 'findClient', nip: '9876543210' }, {}, {
      'GET /clients.json?tax_no=9876543210': [200, [{ id: 7, name: 'Nowa Kawa Sp. z o.o.', tax_no: '987-654-32-10', email: 'x@example.com' }, { id: 8, name: 'Other', tax_no: '98765432101' }]],
    });
    expect(r).toMatchObject({ status: 200, body: { clients: [{ id: 7, name: 'Nowa Kawa Sp. z o.o.', email: 'x@example.com' }] } });
    const toFakturownia = r.calls.find((c) => c.url.includes('fakturownia'));
    expect(toFakturownia?.url).not.toContain('secret-token-123');
    expect((toFakturownia?.init?.headers as Record<string, string>)['Authorization']).toBe('Bearer secret-token-123');
    expect((await call({ action: 'findClient', nip: '123' })).status).toBe(400);
  });

  it("creates a client with the owner's defaults: 14 days to pay, VAT 23 %", async () => {
    const r = await call({ action: 'createClient', name: 'Nowa Kawa Sp. z o.o.', nip: '9876543210', email: 'kawa@example.com', extra: 'ignored' }, {}, { 'POST /clients.json': [201, { id: 12, name: 'Nowa Kawa Sp. z o.o.' }] });
    expect(r).toMatchObject({ status: 200, body: { id: 12 } });
    const sent = JSON.parse(String(r.calls.find((c) => c.url.endsWith('/clients.json'))?.init?.body));
    expect(sent).toEqual({ client: { name: 'Nowa Kawa Sp. z o.o.', tax_no: '9876543210', email: 'kawa@example.com', company: true, payment_to_kind: 14, default_tax: 23 } });
  });

  it('never creates a client without an e-mail (the invoice goes to it)', async () => {
    for (const email of ['', 'not-an-email', undefined]) {
      const r = await call({ action: 'createClient', name: 'Nowa Kawa', nip: '9876543210', email }, {}, { 'POST /clients.json': [201, { id: 12 }] });
      expect(r).toMatchObject({ status: 400, body: { error: 'Nieprawidłowe dane: e-mail.' } });
      expect(r.calls.some((c) => c.url.includes('/clients.json'))).toBe(false);
    }
  });

  const invoice = {
    action: 'createInvoice',
    orderId: '21d8b8fd-8b73-4b07-8ccf-38c69e53ed94',
    clientId: 12,
    sellDate: '2026-11-27',
    issueDate: '2026-11-28',
    paymentDays: 14,
    positions: [
      { name: 'KENIA 1 kg', quantity: 8, priceNet: '112', totalGross: '1102.08', tax: 23 },
      { name: 'GWATEMALA 250 g', quantity: 16, priceNet: '30', totalGross: '590.4', tax: 23 },
    ],
  };

  it('creates a VAT invoice from only the allowed fields, never sending it to KSeF', async () => {
    const r = await call({ ...invoice, gov_save_and_send: true, send_to_ksef: 'yes', kind: 'proforma' }, {}, { 'POST /invoices.json': [201, { id: 345, number: '12/11/2026', token: 'abc', price_net: '1376' }] });
    expect(r).toMatchObject({ status: 200, body: { id: 345, number: '12/11/2026', url: 'https://example-roastery.fakturownia.pl/invoice/abc' } });
    const toFakturownia = r.calls.find((c) => c.url.includes('/invoices.json'));
    expect(toFakturownia?.url).toBe('https://example-roastery.fakturownia.pl/invoices.json'); // no ?gov_save_and_send
    expect(JSON.parse(String(toFakturownia?.init?.body))).toEqual({
      invoice: {
        kind: 'vat',
        oid: 'KR-21d8b8fd-8b73-4b07-8ccf-38c69e53ed94', // 39 characters: Fakturownia allows 40
        oid_unique: 'yes',
        client_id: 12,
        sell_date: '2026-11-27',
        issue_date: '2026-11-28',
        payment_to_kind: 14,
        payment_type: 'transfer',
        buyer_company: true,
        positions: [
          { name: 'KENIA 1 kg', quantity: 8, quantity_unit: 'szt.', price_net: '112', total_price_gross: '1102.08', tax: 23 },
          { name: 'GWATEMALA 250 g', quantity: 16, quantity_unit: 'szt.', price_net: '30', total_price_gross: '590.4', tax: 23 },
        ],
      },
    });
  });

  it('refuses an invoice with odd data, and passes on what Fakturownia says is wrong', async () => {
    const bad = [
      { ...invoice, positions: [] },
      { ...invoice, positions: [{ name: 'X', quantity: 0, priceNet: '1', totalGross: '1.23', tax: 23 }] },
      { ...invoice, positions: [{ name: 'X', quantity: 1, priceNet: '-5', totalGross: '1.23', tax: 23 }] },
      { ...invoice, positions: [{ name: 'X', quantity: 1, priceNet: '1.234', totalGross: '1.23', tax: 23 }] },
      { ...invoice, positions: [{ name: 'X', quantity: 1, priceNet: '1', tax: 23 }] }, // no gross total
      { ...invoice, orderId: 'x'.repeat(38) }, // the mark would be over 40 characters
      { ...invoice, positions: [{ name: 'KENIA 1 kg', quantity: 8, priceNet: '112', totalGross: '1000', tax: 23 }] }, // does not match 8 × 112 + 23 %
      { ...invoice, positions: [{ name: 'KENIA 1 kg', quantity: 8, priceNet: '112', totalGross: '1102.09', tax: 23 }] }, // a grosz off
      { ...invoice, sellDate: '27.11.2026' },
      { ...invoice, clientId: '12' },
      { ...invoice, paymentDays: 400 },
      { ...invoice, sellDate: '2026-02-30' }, // no such day: refused, not moved to March
      { ...invoice, issueDate: '2026-13-01' },
      { ...invoice, orderId: '' },
      { ...invoice, orderId: 'S1; drop' },
    ];
    for (const body of bad) expect((await call(body)).status).toBe(400);
    const refused = await call(invoice, {}, { 'POST /invoices.json': [422, { message: { buyer_tax_no: ['nieprawidłowy'] } }] });
    expect(refused.status).toBe(422);
    expect(String(refused.body?.['error'])).toContain('buyer_tax_no');
  });

  const one = (id: number) => `GET /invoices/${id}.json?fields[invoice]=id,number,status,paid_date,gov_status,gov_id,gov_error_messages`;

  it('reads only the given invoices, one by one with their KSeF state, and passes back only what Kraken needs', async () => {
    const r = await call({ action: 'readInvoices', ids: [345, 346, 345] }, {}, {
      [one(345)]: [200, { id: 345, number: '12/11/2026', status: 'paid', paid_date: '2026-12-05', gov_status: 'ok', gov_id: 'X-1', buyer_tax_no: '9876543210', price_gross: '1692.48' }],
      [one(346)]: [200, { id: 346, number: '13/11/2026', status: 'issued', gov_status: null }],
    });
    expect(r.body).toEqual({
      missing: [],
      invoices: [
        { id: 345, number: '12/11/2026', status: 'paid', paidDate: '2026-12-05', ksefStatus: 'ok', ksefNumber: 'X-1' },
        { id: 346, number: '13/11/2026', status: 'issued', paidDate: null, ksefStatus: null, ksefNumber: null },
      ],
    });
    expect(r.calls.filter((c) => c.url.includes('/invoices/')).length).toBe(2); // 345 asked once
    expect((await call({ action: 'readInvoices', ids: [] })).status).toBe(400);
    expect((await call({ action: 'readInvoices', ids: Array.from({ length: 41 }, (_, i) => i + 1) })).status).toBe(400); // over 40
    expect((await call({ action: 'readInvoices', ids: ['1;DROP'] })).status).toBe(400);
  });

  it('one invoice that fails is left out, the others still come back; a refused token still fails it all', async () => {
    const r = await call({ action: 'readInvoices', ids: [345, 346] }, {}, {
      [one(345)]: [429, { error: 'too many' }],
      [one(346)]: [200, { id: 346, number: '13/11/2026', status: 'paid', gov_status: 'ok' }],
    });
    expect(r).toMatchObject({ status: 200, body: { missing: [], invoices: [{ id: 346, status: 'paid' }] } }); // 345 failed: not "missing"
    expect((await call({ action: 'readInvoices', ids: [345] }, {}, { [one(345)]: [401, {}] })).status).toBe(502);
  });

  it('asks at most 4 at a time', async () => {
    let open = 0;
    let most = 0;
    const answers = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [one(i + 1), [200, { id: i + 1, number: String(i + 1), status: 'issued' }] as [number, unknown]]));
    const net = fakeNet(answers);
    const slow = async (url: string, init?: RequestInit) => {
      const counted = url.includes('/invoices/');
      if (counted) most = Math.max(most, ++open);
      await new Promise((r) => setTimeout(r, 5));
      const response = await net.fetchFn(url, init);
      if (counted) open -= 1;
      return response;
    };
    const response = await handle(request({ action: 'readInvoices', ids: Array.from({ length: 10 }, (_, i) => i + 1) }), env, slow);
    expect(((await response.json()) as { invoices: unknown[] }).invoices).toHaveLength(10);
    expect(most).toBe(4);
  });

  it('says which invoices Fakturownia no longer has (deleted there), and never passes back one it was not asked about', async () => {
    const r = await call({ action: 'readInvoices', ids: [345, 347] }, {}, {
      [one(345)]: [200, { id: 999, number: 'odd', status: 'issued' }], // an answer about another invoice: dropped
      [one(347)]: [404, { error: 'not found' }],
    });
    expect(r).toMatchObject({ status: 200, body: { missing: [347], invoices: [] } });
  });

  it('finds the invoice Kraken made for a sale (after a lost answer), only by its exact mark', async () => {
    const recent: [number, unknown] = [
      200,
      [
        { id: 401, number: '13/11/2026', oid: 'KR-S-1a2b3c-old', token: 't1' },
        { id: 402, number: '14/11/2026', oid: 'KR-S-1a2b3c', token: 't2' },
        { id: 403, number: '15/11/2026', oid: '', token: 't3' },
      ],
    ];
    const found = await call({ action: 'findInvoice', orderId: 'S-1a2b3c' }, {}, { 'GET /invoices.json?period=last_30_days&per_page=100&order=updated_at.desc': recent });
    expect(found.body).toEqual({ invoice: { id: 402, number: '14/11/2026', url: 'https://example-roastery.fakturownia.pl/invoice/t2' } });
    const none = await call({ action: 'findInvoice', orderId: 'S-zzz' }, {}, { 'GET /invoices.json?period=last_30_days&per_page=100&order=updated_at.desc': recent });
    expect(none.body).toEqual({ invoice: null });
  });

  it('tells Kraken who is asking, so only the owner sees "Wystaw fakturę"', async () => {
    expect((await call({ action: 'whoAmI' })).body).toEqual({ role: 'owner' });
    expect((await call({ action: 'whoAmI' }, { token: 'goog-partner-token' })).body).toEqual({ role: 'partner' });
    const stranger = await call({ action: 'whoAmI' }, { token: 'goog-stranger-token' });
    expect(stranger.status).toBe(403);
    expect(stranger.calls.some((c) => c.url.includes('fakturownia'))).toBe(false);
  });

  it('accepts a big line within the limits (999 × 20 000 zł + 23 %)', async () => {
    const big = { ...invoice, positions: [{ name: 'X', quantity: 999, priceNet: '20000', totalGross: '24575400', tax: 23 }] };
    expect((await call(big, {}, { 'POST /invoices.json': [201, { id: 1, number: '1', token: 't' }] })).status).toBe(200);
  });

  // Made-up account numbers with right check digits (not Krak's).
  const ACCOUNT = '03 1111 2222 0000 3333 4444 5555';

  it("puts Krak's own bank account on the invoice, exactly as typed, when it is set", async () => {
    const net = fakeNet({ 'POST /invoices.json': [201, { id: 1, number: '1', token: 't' }] });
    const response = await handle(request(invoice), { ...env, FAKTUROWNIA_BANK_ACCOUNT: ` ${ACCOUNT} ` }, net.fetchFn);
    expect(response.status).toBe(200);
    const sent = JSON.parse(String(net.calls.find((c) => c.url.endsWith('/invoices.json'))?.init?.body));
    expect(sent.invoice.bank_accounts).toEqual([{ bank_account_number: ACCOUNT }]);
    // Not set: no bank_accounts, so Fakturownia's default account (as before).
    const plain = await call(invoice, {}, { 'POST /invoices.json': [201, { id: 1, number: '1', token: 't' }] });
    expect(JSON.parse(String(plain.calls.find((c) => c.url.endsWith('/invoices.json'))?.init?.body)).invoice).not.toHaveProperty('bank_accounts');
  });

  it('a mistyped bank account stops only invoices (before Fakturownia), never reading', async () => {
    const wrong = { ...env, FAKTUROWNIA_BANK_ACCOUNT: '03 1111 2222 0000 3333 4444 5556' }; // one digit off
    const net = fakeNet({ 'GET /invoices/5.json?fields[invoice]=id,number,status,paid_date,gov_status,gov_id,gov_error_messages': [200, { id: 5, number: '1', status: 'issued' }] });
    const issuing = await handle(request(invoice), wrong, net.fetchFn);
    expect(issuing.status).toBe(500);
    expect(net.calls.some((c) => c.url.includes('/invoices.json') && c.init?.method === 'POST')).toBe(false);
    const reading = await handle(request({ action: 'readInvoices', ids: [5] }, { token: 'goog-partner-token' }), wrong, net.fetchFn);
    expect(reading.status).toBe(200);
  });
});

describe('bankAccount', () => {
  it('accepts a real Polish account number as typed (any spaces, "PL" or not), and refuses a wrong check digit', () => {
    expect(bankAccount('03 1111 2222 0000 3333 4444 5555')).toBe('03 1111 2222 0000 3333 4444 5555');
    expect(bankAccount(' PL03111122220000333344445555 ')).toBe('PL03111122220000333344445555');
    expect(bankAccount('77\u00a09999\u00a08888\u00a07777\u00a06666\u00a05555\u00a04444')).toBe('77\u00a09999\u00a08888\u00a07777\u00a06666\u00a05555\u00a04444'); // spaces from a web page
    for (const bad of ['', undefined, '03 1111', '30 1111 2222 0000 3333 4444 5555', '03 1111 2222 0000 3333 4444 5556', 'ab03 1111 2222 0000 3333 4444 5555', '03-1111-2222-0000-3333-4444-5555']) {
      expect(bankAccount(bad)).toBeNull();
    }
  });
});
