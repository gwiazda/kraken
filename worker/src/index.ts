// The Fakturownia middleman (owner, 2026-11-27/28; docs/FAKTUROWNIA.md): a Cloudflare Worker that keeps the Fakturownia
// API token secret. A gatekeeper, not a translator. For every request it:
// 1. answers the browser's CORS check, for Kraken's own addresses only;
// 2. checks the Google sign-in was made for Kraken (its OAuth client) and asks Drive whose it is;
// 3. checks the action is allowed for that person (the owner: everything listed; the partner: reading only);
// 4. checks the data has the expected shape and builds Fakturownia's request only from the allowed fields;
// 5. adds the token (Authorization: Bearer) and passes back only what Kraken needs.
// Never: deleting, sending to KSeF (gov_save_and_send / send_to_ksef), listing all clients or invoices.
// Runs on Cloudflare's servers; the secrets come in `env` (Cloudflare: Settings → Variables and Secrets).

import { GOOGLE_CLIENT_ID } from '../../src/config';

export interface Env {
  /** Fakturownia's API token ("Kod autoryzacyjny API"): a secret, never in the code. */
  FAKTUROWNIA_TOKEN: string;
  /** The account's address, e.g. "krakcoffee" for krakcoffee.fakturownia.pl: a secret (not in the public code). */
  FAKTUROWNIA_DOMAIN: string;
  /** The owner's Gmail: may issue invoices. A secret. */
  OWNER_EMAIL: string;
  /** The partner's Gmail: may only read. A secret. */
  PARTNER_EMAIL: string;
}

/** Kraken's own addresses: the only pages that may call the middleman. */
export const ALLOWED_ORIGINS = ['https://gwiazda.github.io', 'http://localhost:5173'];

type Role = 'owner' | 'partner';
type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** What each action needs; the partner may only read. */
const ACTIONS: Readonly<Record<string, readonly Role[]>> = {
  findClient: ['owner'],
  createClient: ['owner'],
  createInvoice: ['owner'],
  readInvoices: ['owner', 'partner'],
};

class Refused extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export default {
  fetch: (request: Request, env: Env): Promise<Response> => handle(request, env, (input, init) => fetch(input, init)),
};

/** The whole request, with `fetchFn` for Google and Fakturownia (a fake one in tests). */
export async function handle(request: Request, env: Env, fetchFn: Fetch): Promise<Response> {
  const origin = request.headers.get('Origin') ?? '';
  // Another page (or no page): refused, without CORS headers, so a browser does not even show it the answer.
  if (!ALLOWED_ORIGINS.includes(origin)) return new Response(JSON.stringify({ error: 'Only Kraken may call this.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  const cors = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
  try {
    if (request.method !== 'POST') throw new Refused(405, 'Only POST.');
    if (!env.FAKTUROWNIA_TOKEN || !env.FAKTUROWNIA_DOMAIN || !env.OWNER_EMAIL || !env.PARTNER_EMAIL) throw new Refused(500, 'The middleman is not set up yet (missing secrets).');
    const role = await whoIsAsking(request.headers.get('Authorization') ?? '', env, fetchFn);
    const body = await readJson(request);
    const action = typeof body['action'] === 'string' ? body['action'] : '';
    const allowed = ACTIONS[action];
    if (!allowed) throw new Refused(400, 'Unknown action.');
    if (!allowed.includes(role)) throw new Refused(403, 'Not allowed for this person.');
    return reply(200, await run(action, body, env, fetchFn));
  } catch (error) {
    if (error instanceof Refused) return reply(error.status, { error: error.message });
    return reply(502, { error: 'Fakturownia or Google did not answer as expected.' });
  }
}

/**
 * Whose Google sign-in this is: it must have been made for Kraken (`azp` / `aud` is Kraken's OAuth client, so a token
 * from any other app is refused) and belong to the owner or the partner. Kraken's sign-in has only the drive.file
 * permission, so the email comes from Drive (as `whoAmI` in src/core/drive.ts). Anything unclear: refused.
 */
async function whoIsAsking(header: string, env: Env, fetchFn: Fetch): Promise<Role> {
  const token = /^Bearer ([\w.~+/=-]{10,4096})$/.exec(header)?.[1];
  if (!token) throw new Refused(401, 'Sign in with Google first.');
  const info = await fetchFn(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`);
  if (!info.ok) throw new Refused(401, 'The Google sign-in is not valid (expired?).');
  const claims = (await info.json()) as Record<string, unknown>;
  if (claims['azp'] !== GOOGLE_CLIENT_ID && claims['aud'] !== GOOGLE_CLIENT_ID) throw new Refused(401, 'This sign-in was not made for Kraken.');
  const about = await fetchFn('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)', { headers: { Authorization: `Bearer ${token}` } });
  if (!about.ok) throw new Refused(401, 'Google did not say who is signed in.');
  const email = ((await about.json()) as { user?: { emailAddress?: unknown } }).user?.emailAddress;
  const same = (a: string) => typeof email === 'string' && email.trim().toLowerCase() === a.trim().toLowerCase();
  if (same(env.OWNER_EMAIL)) return 'owner';
  if (same(env.PARTNER_EMAIL)) return 'partner';
  throw new Refused(403, 'This Google account may not use Fakturownia.');
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.length > 50_000) throw new Refused(413, 'Too much data.');
  try {
    const value: unknown = JSON.parse(text);
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch {
    // falls through
  }
  throw new Refused(400, 'Not JSON.');
}

// ---- The data, checked ----

const fail = (what: string): never => {
  throw new Refused(400, `Bad ${what}.`);
};
const str = (v: unknown, what: string, max: number, min = 1): string => (typeof v === 'string' && v.trim().length >= min && v.length <= max ? v.trim() : fail(what));
const int = (v: unknown, what: string, min: number, max: number): number => (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : fail(what));
const date = (v: unknown, what: string): string => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : fail(what));
const nip = (v: unknown): string => (typeof v === 'string' && /^\d{10}$/.test(v) ? v : fail('NIP'));
/** A net price in złoty as text, e.g. "112" or "30.50": above 0, at most 100 000 zł, at most 2 decimals. */
const money = (v: unknown, what: string): string => (typeof v === 'string' && /^\d{1,6}(\.\d{1,2})?$/.test(v) && Number(v) > 0 && Number(v) <= 100_000 ? v : fail(what));

// ---- The actions ----

async function run(action: string, body: Record<string, unknown>, env: Env, fetchFn: Fetch): Promise<unknown> {
  const api = (path: string, init: RequestInit = {}) =>
    fakturownia(env, fetchFn, path, init);
  switch (action) {
    case 'findClient': {
      // Only clients with exactly this NIP (Fakturownia's search may also match partly).
      const wanted = nip(body['nip']);
      const found = (await api(`/clients.json?tax_no=${wanted}`)) as unknown;
      const list = Array.isArray(found) ? (found as Record<string, unknown>[]) : [];
      return {
        clients: list
          .filter((c) => typeof c['tax_no'] === 'string' && c['tax_no'].replace(/\D/g, '') === wanted)
          .map((c) => ({ id: c['id'], name: c['name'] })),
      };
    }
    case 'createClient': {
      // The owner's defaults (2026-11-28): 14 days to pay, VAT 23 %.
      const client = {
        name: str(body['name'], 'name', 200),
        tax_no: nip(body['nip']),
        email: body['email'] === '' || body['email'] === undefined ? '' : str(body['email'], 'email', 200),
        company: true,
        payment_to_kind: 14,
        default_tax: 23,
      };
      const made = (await api('/clients.json', { method: 'POST', body: JSON.stringify({ client }) })) as Record<string, unknown>;
      return { id: made['id'] };
    }
    case 'createInvoice': {
      const lines = Array.isArray(body['positions']) ? (body['positions'] as unknown[]) : fail('positions');
      if (lines.length < 1 || lines.length > 50) fail('positions');
      const invoice = {
        kind: 'vat',
        client_id: int(body['clientId'], 'client', 1, Number.MAX_SAFE_INTEGER),
        sell_date: date(body['sellDate'], 'sell date'),
        issue_date: date(body['issueDate'], 'issue date'),
        payment_to_kind: int(body['paymentDays'], 'payment days', 0, 120),
        payment_type: 'transfer',
        buyer_company: true,
        positions: lines.map((raw) => {
          const line = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : fail('position');
          return {
            name: str(line['name'], 'position name', 200),
            quantity: int(line['quantity'], 'quantity', 1, 999),
            quantity_unit: 'szt.',
            price_net: money(line['priceNet'], 'net price'),
            tax: int(line['tax'], 'VAT', 0, 30),
          };
        }),
      };
      // Never sent to KSeF from here: the owner sends it in Fakturownia (docs/FAKTUROWNIA.md).
      const made = (await api('/invoices.json', { method: 'POST', body: JSON.stringify({ invoice }) })) as Record<string, unknown>;
      return { id: made['id'], number: made['number'], token: made['token'] };
    }
    case 'readInvoices': {
      const ids = Array.isArray(body['ids']) ? (body['ids'] as unknown[]) : fail('ids');
      if (ids.length < 1 || ids.length > 100) fail('ids');
      const list = ids.map((id) => int(id, 'id', 1, Number.MAX_SAFE_INTEGER)).join(',');
      const found = (await api(`/invoices.json?period=all&per_page=100&invoice_ids=${list}`)) as unknown;
      return {
        invoices: (Array.isArray(found) ? (found as Record<string, unknown>[]) : []).map((i) => ({
          id: i['id'],
          number: i['number'],
          status: i['status'],
          paidDate: i['paid_date'],
          ksefStatus: i['gov_status'] ?? null,
          ksefNumber: i['gov_id'] ?? null,
          token: i['token'],
        })),
      };
    }
    default:
      return fail('action');
  }
}

/** One call to Fakturownia with the secret token in the header (never in the address). */
async function fakturownia(env: Env, fetchFn: Fetch, path: string, init: RequestInit): Promise<unknown> {
  const domain = /^[a-z0-9-]{1,63}$/.test(env.FAKTUROWNIA_DOMAIN) ? env.FAKTUROWNIA_DOMAIN : fail('Fakturownia address (secret)');
  const response = await fetchFn(`https://${domain}.fakturownia.pl${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${env.FAKTUROWNIA_TOKEN}`, 'Content-Type': 'application/json', Accept: 'application/json' },
  });
  if (response.status === 401) throw new Refused(502, 'Fakturownia refused the token (changed or wrong?).');
  if (response.status === 422) {
    // Fakturownia says what is wrong with the data (e.g. a missing field); passed on so the owner can see it.
    const detail = await response.text();
    throw new Refused(422, `Fakturownia did not accept it: ${detail.slice(0, 500)}`);
  }
  if (!response.ok) throw new Refused(502, `Fakturownia answered ${response.status}.`);
  return response.json();
}
