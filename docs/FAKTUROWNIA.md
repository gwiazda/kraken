# Connecting Kraken to Fakturownia (decided plan, not built yet)

_Decided with the owner on 2026-11-27. Nothing is built yet; when the owner asks for it, build exactly this._

## Goal

Kraken talks to the Fakturownia API (for example: create an invoice for a sale, read an invoice's status), and the
Fakturownia API token is **never visible to anyone**: not in the public code, not in the browser, not in the sheet.

## What was checked (2026-11-26)

- The API uses **one account-wide token** (Ustawienia → Ustawienia konta → Integracja → Kod autoryzacyjny API). It is
  like a password to the whole account (read, create, delete invoices and clients). No read-only or limited token
  and no OAuth were found in the docs. Fakturownia's advice: never e-mail it, commit it or put it in a page's code.
- Recommended way to send it: the header `Authorization: Bearer API_TOKEN`. The old ways (`?api_token=` in the
  address, or in the request body) still work but are discouraged (addresses end up in logs) and marked
  deprecated (`Deprecation` header).
- Their server allows calls from web pages (CORS `Access-Control-Allow-Origin: *`), but **not the `Authorization`
  header** (allowed headers: `X-Requested-With, Content-Type, Accept`). So a page like Kraken could only use the
  deprecated ways. This, plus the token being visible to the browser, is why Kraken does not call Fakturownia
  directly.
- Not checked yet: whether Fakturownia gives each person their own user and token.

Sources: https://github.com/fakturownia/API, https://fakturownia.pl/api, and a test request (no token, no data)
to the API on 2026-11-26.

## The decision: a small "middleman" on Cloudflare Workers

Options considered: token typed into Kraken each session, token in the Kraken sheet, a middleman holding the token.
The owner chose **the middleman** (the only option where nobody can see the token). Hosts considered: Cloudflare
Workers, Google Apps Script (code outside the repo, no tests or PR review, slower, manual deploys), Vercel /
Netlify (no advantage), Google Cloud Functions (needs billing, which the `kraken` Google project has none of).
Chosen: **Cloudflare Workers**: the least setup and the least maintenance.

- **Language: TypeScript**, like Kraken. It is translated into JavaScript and runs on Cloudflare's V8 engine (the
  same engine as Chrome and Node.js). Tests with Vitest, like the rest of Kraken.
- **Same repository (monorepo):** the app stays in `src/`, the middleman goes in its own folder `worker/`.
- **Deploy with GitHub Actions** after a merge: the app to GitHub Pages as today; `worker/` to Cloudflare, only when
  something in `worker/` changed. The Cloudflare deploy key is stored in GitHub's encrypted Secrets (it can only
  publish the worker; it gives no access to Fakturownia).
- **Cost: the Cloudflare Workers free plan** (100,000 requests a day, 10 ms of computing per request (waiting for
  Google or Fakturownia does not count), 50 outgoing calls per request; secrets included). On the free plan going
  over a limit only refuses calls until the next day, it never charges. Still to check at sign-up: whether a card
  is asked for.
- This is the one planned exception to "no backend" (`CLAUDE.md`, Architecture): the browser can never keep a secret.

## The flow (no redirects: the middleman makes its own new request)

1. **Kraken → middleman:** what it wants (e.g. "create this invoice") plus the owner's **Google sign-in** (the access
   token Kraken already has). No Fakturownia token.
2. **Middleman → Google:** "whose sign-in is this?" Google answers with the email.
3. **Middleman checks:** the email is one of the two owners' (a Cloudflare setting, never in the public code) and the
   action is on the **allowed list** (e.g. create invoice, read an invoice's status, list clients). Anything else
   is refused, so even a valid sign-in cannot delete invoices or download the whole account unless we add it on purpose.
4. **Middleman → Fakturownia:** a new request with the **secret token** in the `Authorization: Bearer` header.
5. **Fakturownia → middleman → Kraken:** only what Kraken needs (e.g. invoice number, status, PDF link) is passed
   back. The token never reaches the browser.

| | Browser | Cloudflare | Public code (GitHub) |
|---|---|---|---|
| Fakturownia token | never | only here (Worker secret) | never |
| Google sign-in | in memory, as today | passes through for the check | never |
| The two allowed emails | | setting | never |

## Who does what: a "thin" middleman

- **Kraken** builds the invoice exactly as Fakturownia expects it (buyer, items, quantities, net prices, VAT): pure
  functions with tests, next to the existing price, client and sales logic. Business rules stay in one place.
- **The middleman is a gatekeeper, not a translator** (about 100–150 lines, written once, rarely changed):
  1. check the Google sign-in belongs to one of the two owners;
  2. check the action is on the allowed list;
  3. check the data has the expected shape (e.g. an invoice has a buyer and 1–50 items; nothing unexpected attached);
  4. add the secret token and forward to Fakturownia;
  5. pass back only what Kraken needs.
- It does not re-check prices: only the two owners use Kraken. (Re-checking would be needed only if someone not fully
  trusted used it.)

## One-time setup (when it is built; Claude guides the owner step by step)

1. Create a free Cloudflare account.
2. In Fakturownia, create the API token; paste it once into the Worker's Secrets in Cloudflare (it cannot be read back).
3. Add the two owners' emails as a Worker setting.
4. Create a Cloudflare deploy key; save it in the GitHub repo's Secrets.
5. Add the worker's address to Kraken's Content Security Policy (`connect-src` in `index.html`).

To cut off access at any time: create a new token in Fakturownia and paste it into Cloudflare (the old one stops working).

## Still to decide when it is built

- What Kraken does with Fakturownia first (e.g. create an invoice from a sale, read whether it is paid), which sets
  the allowed list.
