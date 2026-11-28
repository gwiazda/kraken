// The Fakturownia middleman (owner, 2026-11-27/28; docs/FAKTUROWNIA.md): a Cloudflare Worker that keeps the Fakturownia
// API token secret. A gatekeeper, not a translator. For every request it:
// 1. answers the browser's CORS check, for Kraken's own addresses only;
// 2. checks the Google sign-in was made for Kraken (its OAuth client) and asks Drive whose it is;
// 3. checks the action is allowed for that person (the owner: everything listed; the partner: reading only);
// 4. checks the data has the expected shape and builds Fakturownia's request only from the allowed fields;
// 5. adds the token (Authorization: Bearer) and passes back only what Kraken needs.
// Never: deleting, sending to KSeF (gov_save_and_send / send_to_ksef), listing all clients or invoices. Every invoice
// it creates carries the sale's mark (oid "KR-<sale id>", unique), so a retry never makes a second invoice and an
// invoice made by hand in Fakturownia is never passed back. Messages are in Polish: Kraken shows them as they are.
// Runs on Cloudflare's servers; the secrets come in `env` (Cloudflare: Settings → Variables and Secrets).

import { GOOGLE_CLIENT_ID } from '../../src/config';

export interface Env {
  /** Fakturownia's API token ("Kod autoryzacyjny API"): a secret, never in the code. */
  FAKTUROWNIA_TOKEN: string;
  /** The account's address without ".fakturownia.pl", e.g. "example-roastery": a secret (not in the public code). */
  FAKTUROWNIA_DOMAIN: string;
  /** The owner's Gmail: may issue invoices. A secret. */
  OWNER_EMAIL: string;
  /** The partner's Gmail: may only read. A secret. */
  PARTNER_EMAIL: string;
  /**
   * Optional (owner, 2026-11-28): the bank account for Krak's invoices, typed exactly as Fakturownia shows the saved
   * account, when it is not the account's default. A secret (not in the public code). Empty: the default account.
   */
  FAKTUROWNIA_BANK_ACCOUNT?: string;
}

/**
 * The bank account to put on invoices: the secret as typed (only trimmed, so Fakturownia can match its saved account),
 * when it is a real Polish account number: 26 digits (spaces of any kind allowed, "PL" first optional) whose check
 * digits are right (IBAN mod 97, like the NIP's check digit), so a mistyped digit never reaches an invoice. null if not.
 */
export function bankAccount(value: string | undefined): string | null {
  const typed = (value ?? '').trim();
  const digits = typed.replace(/^PL/i, '').replace(/\s/g, '');
  if (!/^\d{26}$/.test(digits)) return null;
  // IBAN: the country (P = 25, L = 21) and the 2 check digits go to the end; the whole number mod 97 must be 1.
  const rearranged = `${digits.slice(2)}2521${digits.slice(0, 2)}`;
  let rest = 0;
  for (const d of rearranged) rest = (rest * 10 + Number(d)) % 97;
  return rest === 1 ? typed : null;
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
  findInvoice: ['owner'],
  readInvoices: ['owner', 'partner'],
  whoAmI: ['owner', 'partner'],
};

/** The mark of the invoices Kraken makes: "KR-" + the sale's id (Fakturownia's oid, unique; at most 40 characters). */
const ORDER_PREFIX = 'KR-';

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
  if (!ALLOWED_ORIGINS.includes(origin)) return new Response(JSON.stringify({ error: 'Tylko Kraken może tu pytać.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
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
    if (request.method !== 'POST') throw new Refused(405, 'Tylko POST.');
    if (!env.FAKTUROWNIA_TOKEN || !env.FAKTUROWNIA_DOMAIN || !env.OWNER_EMAIL || !env.PARTNER_EMAIL) throw new Refused(500, 'Pośrednik nie jest jeszcze ustawiony (brakuje sekretów w Cloudflare).');
    if (!/^[a-z0-9-]{1,63}$/.test(env.FAKTUROWNIA_DOMAIN)) {
      throw new Refused(500, 'Adres Fakturowni w Cloudflare jest źle wpisany: tylko nazwa konta, np. „mojafirma”, bez „.fakturownia.pl”.');
    }
    const role = await whoIsAsking(request.headers.get('Authorization') ?? '', env, fetchFn);
    const body = await readJson(request);
    const action = typeof body['action'] === 'string' ? body['action'] : '';
    const allowed = ACTIONS[action];
    if (!allowed) throw new Refused(400, 'Nieznane działanie.');
    if (!allowed.includes(role)) throw new Refused(403, 'To może zrobić tylko właściciel.');
    if (action === 'whoAmI') return reply(200, { role }); // so Kraken shows "Wystaw fakturę" only to the owner
    return reply(200, await run(action, body, env, fetchFn));
  } catch (error) {
    if (error instanceof Refused) return reply(error.status, { error: error.message });
    return reply(502, { error: 'Fakturownia albo Google nie odpowiedziały tak, jak powinny. Spróbuj ponownie za chwilę.' });
  }
}

/**
 * Whose Google sign-in this is: it must have been made for Kraken (`azp` / `aud` is Kraken's OAuth client, so a token
 * from any other app is refused) and belong to the owner or the partner. Kraken's sign-in has only the drive.file
 * permission, so the email comes from Drive (as `whoAmI` in src/core/drive.ts). Anything unclear: refused.
 */
async function whoIsAsking(header: string, env: Env, fetchFn: Fetch): Promise<Role> {
  const token = /^Bearer ([\w.~+/=-]{10,4096})$/.exec(header)?.[1];
  if (!token) throw new Refused(401, 'Najpierw zaloguj się przez Google.');
  const info = await fetchFn(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`);
  if (!info.ok) throw new Refused(401, 'Logowanie Google wygasło albo jest nieważne: zaloguj się ponownie.');
  const claims = (await info.json()) as Record<string, unknown>;
  if (claims['azp'] !== GOOGLE_CLIENT_ID && claims['aud'] !== GOOGLE_CLIENT_ID) throw new Refused(401, 'To logowanie nie pochodzi z Krakena.');
  const about = await fetchFn('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)', { headers: { Authorization: `Bearer ${token}` } });
  if (!about.ok) throw new Refused(401, 'Google nie podał, kto jest zalogowany.');
  const email = ((await about.json()) as { user?: { emailAddress?: unknown } }).user?.emailAddress;
  const same = (a: string) => typeof email === 'string' && email.trim().toLowerCase() === a.trim().toLowerCase();
  if (same(env.OWNER_EMAIL)) return 'owner';
  if (same(env.PARTNER_EMAIL)) return 'partner';
  throw new Refused(403, 'To konto Google nie ma dostępu do Fakturowni.');
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.length > 50_000) throw new Refused(413, 'Za dużo danych.');
  try {
    const value: unknown = JSON.parse(text);
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch {
    // falls through
  }
  throw new Refused(400, 'Nieprawidłowe dane.');
}

// ---- The data, checked ----

const fail = (what: string): never => {
  throw new Refused(400, `Nieprawidłowe dane: ${what}.`);
};
const str = (v: unknown, what: string, max: number, min = 1): string => (typeof v === 'string' && v.trim().length >= min && v.length <= max ? v.trim() : fail(what));
const int = (v: unknown, what: string, min: number, max: number): number => (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : fail(what));
/** A real date as YYYY-MM-DD (2026-02-30 is refused, not moved to March). */
const date = (v: unknown, what: string): string => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return fail(what);
  const [y, m, d] = v.split('-').map(Number) as [number, number, number];
  const real = new Date(Date.UTC(y, m - 1, d));
  return real.getUTCFullYear() === y && real.getUTCMonth() === m - 1 && real.getUTCDate() === d ? v : fail(what);
};
/** A sale's id, as Kraken's records have them (letters, digits, "-", "_"). */
const orderId = (v: unknown): string => (typeof v === 'string' && /^[A-Za-z0-9_-]{1,37}$/.test(v) ? v : fail('sprzedaż'));
/** A line's gross total in złoty as text, e.g. "1102.08": above 0, at most 2 decimals (999 × 100 000 zł + 30 % fits). */
const total = (v: unknown, what: string): string => (typeof v === 'string' && /^\d{1,9}(\.\d{1,2})?$/.test(v) && Number(v) > 0 ? v : fail(what));
/** Złoty as text ("112.5") in grosze, exactly. */
const grosze = (v: string): number => {
  const [whole = '0', part = ''] = v.split('.');
  return Number(whole) * 100 + Number(part.padEnd(2, '0'));
};
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
          .map((c) => ({ id: c['id'], name: c['name'], email: typeof c['email'] === 'string' ? c['email'] : '' })),
      };
    }
    case 'createClient': {
      // The owner's defaults (2026-11-28): 14 days to pay, VAT 23 %; always with an e-mail (the invoice goes to it).
      const client = {
        name: str(body['name'], 'nazwa', 200),
        tax_no: nip(body['nip']),
        email: typeof body['email'] === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body['email'].trim()) && body['email'].length <= 200 ? body['email'].trim() : fail('e-mail'),
        company: true,
        payment_to_kind: 14,
        default_tax: 23,
      };
      const made = (await api('/clients.json', { method: 'POST', body: JSON.stringify({ client }) })) as Record<string, unknown>;
      return { id: made['id'] };
    }
    case 'createInvoice': {
      // Only invoices need the bank account: a typo there never stops anything else (e.g. the partner's reading).
      const account = bankAccount(env.FAKTUROWNIA_BANK_ACCOUNT);
      if ((env.FAKTUROWNIA_BANK_ACCOUNT ?? '').trim() !== '' && account === null) {
        throw new Refused(500, 'Numer konta w Cloudflare (FAKTUROWNIA_BANK_ACCOUNT) jest źle wpisany: 26 cyfr z poprawnymi cyframi kontrolnymi, tak jak w Fakturowni.');
      }
      const lines = Array.isArray(body['positions']) ? (body['positions'] as unknown[]) : fail('pozycje');
      if (lines.length < 1 || lines.length > 50) fail('pozycje');
      const invoice = {
        kind: 'vat',
        // The sale's mark: Fakturownia refuses a second invoice with the same one (a retried "Wystaw").
        oid: ORDER_PREFIX + orderId(body['orderId']),
        oid_unique: 'yes',
        client_id: int(body['clientId'], 'klient', 1, Number.MAX_SAFE_INTEGER),
        sell_date: date(body['sellDate'], 'data sprzedaży'),
        issue_date: date(body['issueDate'], 'data wystawienia'),
        payment_to_kind: int(body['paymentDays'], 'termin płatności', 0, 120),
        payment_type: 'transfer',
        buyer_company: true,
        // Krak's own account (owner, 2026-11-28): Fakturownia uses the saved account with this number (only this one).
        ...(account ? { bank_accounts: [{ bank_account_number: account }] } : {}),
        positions: lines.map((raw) => {
          const line = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : fail('pozycja');
          const quantity = int(line['quantity'], 'ilość', 1, 999);
          const priceNet = money(line['priceNet'], 'cena netto');
          const tax = int(line['tax'], 'VAT', 0, 30);
          // Fakturownia requires it (seen 2026-11-28: "positions.total_price_gross: pole nie może być puste"), and must
          // be exactly quantity × net + VAT (to the grosz), so it can never change what the owner checked.
          const totalGross = total(line['totalGross'], 'wartość brutto');
          if (grosze(totalGross) !== Math.round((grosze(priceNet) * quantity * (100 + tax)) / 100)) fail('wartość brutto (nie zgadza się z ceną netto i VAT)');
          return { name: str(line['name'], 'nazwa pozycji', 200), quantity, quantity_unit: 'szt.', price_net: priceNet, total_price_gross: totalGross, tax };
        }),
      };
      // Never sent to KSeF from here: the owner sends it in Fakturownia (docs/FAKTUROWNIA.md).
      const made = (await api('/invoices.json', { method: 'POST', body: JSON.stringify({ invoice }) })) as Record<string, unknown>;
      return { id: made['id'], number: made['number'], url: viewUrl(env, made['token']) };
    }
    case 'findInvoice': {
      // After a "Wystaw" whose answer was lost: the invoice Kraken made for this sale, if Fakturownia has it. Only the
      // one with exactly this sale's mark is passed back (never an invoice made by hand).
      const oid = ORDER_PREFIX + orderId(body['orderId']);
      const found = (await api('/invoices.json?period=last_30_days&per_page=100&order=updated_at.desc')) as unknown;
      const match = (Array.isArray(found) ? (found as Record<string, unknown>[]) : []).find((i) => i['oid'] === oid);
      return { invoice: match ? { id: match['id'], number: match['number'], url: viewUrl(env, match['token']) } : null };
    }
    case 'readInvoices': {
      // One by one (KSeF.md documents the KSeF fields only when one invoice is read): only the invoices asked for,
      // Kraken's own. At most 40 (2 calls to Google + 40 stay under Cloudflare's free 50 per request). An invoice
      // deleted in Fakturownia is simply left out.
      const ids = Array.isArray(body['ids']) ? (body['ids'] as unknown[]) : fail('faktury');
      if (ids.length < 1 || ids.length > 40) fail('faktury');
      const wanted = [...new Set(ids.map((id) => int(id, 'id', 1, Number.MAX_SAFE_INTEGER)))];
      const fields = 'id,number,status,paid_date,gov_status,gov_id,gov_error_messages';
      // Four at a time (gentle on Fakturownia, whose limits are not documented); an invoice whose answer fails is
      // left out (asked again next time) instead of failing the others. A wrong token still fails it all.
      const found: unknown[] = [];
      for (let i = 0; i < wanted.length; i += 4) {
        const batch = await Promise.all(
          wanted.slice(i, i + 4).map((id) =>
            fakturownia(env, fetchFn, `/invoices/${id}.json?fields[invoice]=${fields}`, {}, true).catch((error: unknown) => {
              if (error instanceof Refused && error.message.startsWith('Fakturownia nie przyjęła klucza API')) throw error;
              return null;
            }),
          ),
        );
        found.push(...batch);
      }
      return {
        invoices: found
          .filter((i): i is Record<string, unknown> => i !== null && typeof i === 'object' && typeof (i as Record<string, unknown>)['id'] === 'number' && wanted.includes((i as Record<string, unknown>)['id'] as number))
          .map((i) => ({
            id: i['id'],
            number: i['number'],
            status: i['status'],
            paidDate: i['paid_date'] ?? null,
            ksefStatus: i['gov_status'] ?? null,
            ksefNumber: i['gov_id'] ?? null,
          })),
      };
    }
    default:
      return fail('działanie');
  }
}

/**
 * The invoice's own page in Fakturownia (its public link, from the invoice's token; Fakturownia shows its PDF only once
 * it has its KSeF number). '' when Fakturownia gave no token.
 */
const viewUrl = (env: Env, token: unknown): string =>
  typeof token === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(token) ? `https://${env.FAKTUROWNIA_DOMAIN}.fakturownia.pl/invoice/${token}` : '';

/** One call to Fakturownia with the secret token in the header (never in the address). `missing`: a 404 gives null. */
async function fakturownia(env: Env, fetchFn: Fetch, path: string, init: RequestInit, missing = false): Promise<unknown> {
  // FAKTUROWNIA_DOMAIN was checked in handle (letters, digits and "-" only).
  const response = await fetchFn(`https://${env.FAKTUROWNIA_DOMAIN}.fakturownia.pl${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${env.FAKTUROWNIA_TOKEN}`, 'Content-Type': 'application/json', Accept: 'application/json' },
  });
  if (response.status === 401) throw new Refused(502, 'Fakturownia nie przyjęła klucza API (zmieniony albo źle wpisany w Cloudflare?).');
  if (missing && response.status === 404) return null;
  if (response.status === 422) {
    // Fakturownia says what is wrong with the data (e.g. a missing field); passed on so the owner can see it.
    const detail = await response.text();
    throw new Refused(422, `Fakturownia tego nie przyjęła: ${detail.slice(0, 500)}`);
  }
  if (!response.ok) throw new Refused(502, `Fakturownia odpowiedziała błędem ${response.status}.`);
  return response.json();
}
