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
- Not checked yet: whether Fakturownia gives each person their own user and token; whether it can have more than
  one API code at a time, and whether creating a new one makes the old one stop working (see "Cutting off access").
  Whether the API can create an invoice as a draft (not issued) is also to be checked.

Sources: https://github.com/fakturownia/API, https://fakturownia.pl/api, and a test request (no token, no data)
to the API on 2026-11-26.

## The decision: a small "middleman" on Cloudflare Workers

Options considered: token typed into Kraken each session, token in the Kraken sheet, a middleman holding the token.
The owner chose **the middleman** (the only option where nobody can see the token). Hosts considered: Cloudflare
Workers, Google Apps Script (code outside the repo, no tests or PR review, slower, manual deploys), Vercel /
Netlify (no advantage), Google Cloud Functions (needs billing, which the `kraken` Google project has none of).
Chosen: **Cloudflare Workers**: the least setup and the least maintenance.

- **Language: TypeScript**, like Kraken. It is translated into JavaScript and runs on Cloudflare's V8 engine (the
  same engine as Chrome and Node.js). Tests with Vitest, like the rest of Kraken. **CI must run them:** today
  `vite.config.ts` only runs `src/**/*.test.ts`, `tsconfig.json` only checks `src`, and `ci.yml` only runs the root
  `npm test`; when `worker/` is added, its tests and type check must be added to CI in the same PR (the security
  checks are the most important code to test).
- **New tools, with the owner's OK when it is built:** deploying needs Cloudflare's `wrangler` (and its Workers
  types). That is an exception to "only vite, typescript and vitest" (`CLAUDE.md`), used only for `worker/`, exact
  versions.
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

0. **The browser's permission check (CORS):** Kraken sends the Google sign-in in an `Authorization` header, so Chrome
   first asks the middleman whether this page may call it (an `OPTIONS` "preflight"). The middleman must answer it
   and allow **only** `https://gwiazda.github.io` and `http://localhost:5173` (never `*`) and the `Authorization`
   and `Content-Type` headers. (Fakturownia's own server fails exactly this check, see above.)
1. **Kraken → middleman:** what it wants (e.g. "create this invoice") plus the owner's **Google sign-in** (the access
   token Kraken already has). No Fakturownia token.
2. **Middleman → Google, two questions:**
   - **Was this sign-in made for Kraken?** Google's `tokeninfo` gives the app the token was issued to (`aud` /
     `azp`); it must be Kraken's OAuth Client ID (`src/config.ts`). Without this, a Google token of an owner taken
     from any other app or website that uses Google sign-in would get in.
   - **Whose is it?** Kraken's sign-in has only the `drive.file` permission, so `tokeninfo` / `userinfo` do **not**
     give the email. The middleman asks Drive instead (`drive/v3/about?fields=user(emailAddress)`, the same as
     `whoAmI` in `src/core/drive.ts`). Asking Google for an extra "email" permission would make both owners click
     through Google's consent again, so it is not used.
   - Anything missing or unclear (no email, wrong app, Google not answering) means **refused**, never let through.
3. **Middleman checks:** the email is one of the two owners' (a Worker **secret**, see setup; never in the public
   code) and the action is on the **allowed list**, kept as small as the chosen feature needs. Anything else is
   refused, so a valid sign-in cannot delete invoices unless we add it on purpose. Note: whatever is on the list
   can be used by anyone holding an owner's Kraken sign-in, e.g. "list clients" would give them the client list
   (NIPs, emails); so only actions the feature really needs go on it, and creating invoices should create
   **drafts** if the API allows it (to check).
   **Who may do what (owner, 2026-11-27):** the allowed list says, per action, which emails may use it. **Issuing
   (creating) an invoice: the owner only**, never the partner. Reading (e.g. whether an invoice is paid) may be
   both. Kraken also hides the invoice button from the partner, but the lock that counts is this check in the
   middleman (a screen can be got around; the middleman cannot).
4. **Middleman → Fakturownia:** a new request with the **secret token** in the `Authorization: Bearer` header.
5. **Fakturownia → middleman → Kraken:** only what Kraken needs (e.g. invoice number, status, PDF link) is passed
   back. The token never reaches the browser.

| | Browser | Cloudflare | Public code (GitHub) |
|---|---|---|---|
| Fakturownia token | never | only here (Worker secret) | never |
| Google sign-in | in memory, as today | passes through for the check | never |
| The allowed emails (owner; partner for reading only) | | secret | never |

## Who does what: a "thin" middleman

- **Kraken** builds the invoice exactly as Fakturownia expects it (buyer, items, quantities, net prices, VAT): pure
  functions with tests, next to the existing price, client and sales logic. Business rules stay in one place.
- **The middleman is a gatekeeper, not a translator** (about 100–150 lines, written once, rarely changed):
  1. answer the browser's CORS check (Kraken's addresses only);
  2. check the Google sign-in was made for Kraken and belongs to one of the two owners;
  3. check the action is on the allowed list;
  4. check the data has the expected shape (e.g. an invoice has a buyer and 1–50 items; nothing unexpected attached);
  5. add the secret token and forward to Fakturownia;
  6. pass back only what Kraken needs.
- It does not re-check prices: only the two owners use Kraken. (Re-checking would be needed only if someone not fully
  trusted used it.)

## One-time setup (when it is built; Claude guides the owner step by step)

1. Create a free Cloudflare account.
2. In Fakturownia, create the API token; paste it once into the Worker's Secrets in Cloudflare (it cannot be read back).
3. Add the two owners' emails as a Worker **secret** (not a plain "variable": a deploy from GitHub replaces plain
   variables with what the code defines, which would lock both owners out, and the emails must never be in the
   public code).
4. Create a Cloudflare deploy key; save it in the GitHub repo's Secrets.
5. Add the worker's address to Kraken's Content Security Policy (`connect-src` in `index.html`).

## Cutting off access

Create a new token in Fakturownia and paste it into Cloudflare. **Not checked yet** whether the old token then stops
working by itself or has to be removed separately in Fakturownia: check this when it is built, and write the
exact steps here.

## Still to decide when it is built

- What Kraken does with Fakturownia first, which sets the allowed list. The earlier idea (requirements section 4):
  create a **draft** invoice from a sale with one click, and fill in the invoice number in Kraken automatically;
  another: read whether an invoice is paid.
