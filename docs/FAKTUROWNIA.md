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
  3. check the action is on the allowed list **for that email** (creating an invoice: the owner's email only);
  4. check the data has the expected shape (e.g. an invoice has a buyer and 1–50 items; nothing unexpected attached);
  5. add the secret token and forward to Fakturownia;
  6. pass back only what Kraken needs.
- It does not re-check prices: only the two owners use Kraken. (Re-checking would be needed only if someone not fully
  trusted used it.)

## The code (built 2026-11-28)

`worker/src/index.ts` (with `worker/src/index.test.ts`, run with the app's tests and type check in CI;
`vite.config.ts` and `tsconfig.json` include `worker/`). One endpoint: `POST` with JSON `{ action, … }` and the
Google access token in `Authorization: Bearer`. Actions: `findClient` (`nip`), `createClient` (`name`, `nip`,
`email`), `createInvoice` (`clientId`, `sellDate`, `issueDate`, `paymentDays`, `positions`: `name`, `quantity`,
`priceNet` as "112.5", `totalGross` (the line's quantity × net + VAT, to the grosz, which Fakturownia requires:
"positions.total_price_gross: pole nie może być puste", seen on the first real try 2026-11-28), `tax`, and
`orderId`: the sale's id; the middleman refuses a `totalGross` that is not exactly quantity × net + VAT. Not yet
checked on a real invoice: whether Fakturownia also rounds per line rather than per unit, to see on the first
invoice with prices in grosze), `findInvoice` (`orderId`), `readInvoices` (`ids`, up to
100). Every invoice carries the sale's mark (`oid` "KR-<sale id>", at most 40 characters as Fakturownia allows, with `oid_unique: yes`, documented in the API
README), so a retried "Wystaw" never makes a second invoice; `findInvoice` finds the invoice of a sale whose answer
was lost (among the last 30 days, exact mark only). `readInvoices` passes back only the ids asked for, even if
Fakturownia answers with more. Errors come back as `{ error }` in Polish (shown as they are): 400 bad data, 401
sign-in, 403 not allowed or another page, 405 not POST, 413 too much data, 422 Fakturownia's own message, 500 the
middleman's secrets missing or the Fakturownia address mistyped, 502 Fakturownia or Google did not answer.
`worker/wrangler.toml` names it `kraken-fakturownia`; `.github/workflows/worker.yml` publishes it (main only, one at a
time; tests and type check first) after a merge that changes `worker/`, or when run by hand. It uses Cloudflare's tool
`wrangler`, locked with all its parts in `worker/package.json` / `worker/package-lock.json` (install scripts not run):
only that workflow uses it, the app does not (owner informed 2026-11-28). Its address will be `https://kraken-fakturownia.<the account's workers.dev subdomain>.workers.dev`.

## One-time setup (Claude guides the owner step by step)

1. Create a free Cloudflare account (done 2026-11-28; 2-step verification on).
2. In Cloudflare, choose the account's `workers.dev` subdomain (Workers & Pages, first visit).
3. Create a Cloudflare API token that can only edit Workers ("Edit Cloudflare Workers" template), and save it with
   the account ID as the GitHub repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (done
   2026-11-28). A merge that changes `worker/` publishes the middleman; otherwise run it by hand once (Actions →
   "Publish Fakturownia middleman" → Run workflow).
4. In the Worker (Settings → Variables and Secrets), add four values of type **Secret**: `FAKTUROWNIA_TOKEN` (from
   Fakturownia: Ustawienia → Ustawienia konta → Integracja → Kod autoryzacyjny API; it cannot be read back),
   `FAKTUROWNIA_DOMAIN` (the account's address without `.fakturownia.pl`), `OWNER_EMAIL` (may also issue invoices)
   and `PARTNER_EMAIL` (reading only). Secrets, not plain variables: plain ones would be shown in Cloudflare and the
   emails must never be in the public code. Optional fifth (owner, 2026-11-28): `FAKTUROWNIA_BANK_ACCOUNT`, Krak's
   own account number, **typed exactly as Fakturownia shows the saved account** (when it is not the default one):
   the middleman puts it on every invoice as typed (`bank_accounts`, docs: API_RACHUNKI_BANKOWE.md; an existing
   number means Fakturownia uses that saved account, and only it; whether its matching ignores spaces is to check on
   the first invoice). The check digits are checked (IBAN mod 97), so a mistyped number is refused (only issuing
   stops, with a clear message). If "zabezpieczone zmiany numeru konta bankowego" is on in Fakturownia, it ignores
   this (to check).
5. Add the worker's address to Kraken (`src/config.ts`) and to its Content Security Policy (`connect-src` in
   `index.html`).
6. When the Fakturownia work is finished, remove `http://localhost:5173` from `ALLOWED_ORIGINS` in the middleman
   (owner, 2026-11-28: only the published Kraken may call it).

## In Kraken (built 2026-11-28)

- `src/core/fakturownia.ts`: talks to the middleman (`FAKTUROWNIA_PROXY_URL` in `src/config.ts`, also in the CSP's
  `connect-src`); a 401 is treated as an expired sign-in (sign in again), any other refusal shows the middleman's
  Polish words.
- `src/features/sales/invoice.ts` (pure, tested): `invoiceDraft` (the invoice from the sale as saved, or why it
  cannot be issued: not a sale, already issued, no client or no NIP, no priced lines, only free bags),
  `pricesUpToDate` (saved prices still what the sale is priced at now), `issuedFields`, `unpaidInvoiceIds`,
  `paidUpdates`.
- Sales: on a saved sale "to be issued", the owner (asked of the middleman once per visit: `whoAmI`) sees "Wystaw
  fakturę w Fakturowni…". It is refused while the form has unsaved changes or the prices changed since saving
  (save first). **Two steps only for a new client (owner, 2026-11-28, option A):** Kraken first looks the client up
  in Fakturownia by NIP. Found: straight to the check screen ("Klient jest już w Fakturowni ✓"). Not found: a
  "Nowy klient w Fakturowni" screen with its data and "Dodaj klienta do Fakturowni"; only after that the check
  screen ("Dodano klienta … ✓"). The check screen shows buyer, NIP, e-mail, dates, "przelew, 14 dni", the lines and
  the totals, and says the invoice is issued at once with a number but not sent to KSeF. "Wystaw fakturę": the
  invoice (for a client found there the check screen shows the card's name and e-mail, which the invoice uses, and
  warns when they differ from Klienci; if creating fails, `findInvoice` looks for one already made with this sale's mark), then the
  sale becomes "Faktura wystawiona" today with the number, `fakturownia_id` and `fakturownia_url` (migration 17).
  The sale's page then links to the invoice in Fakturownia. Setting the sale back to "Faktura do wystawienia" (or
  changing its kind) forgets the link, so it can be issued again after the owner deleted the invoice in Fakturownia;
  if the invoice still exists, Fakturownia refuses a second one with the sale's mark and Kraken links the old one.
- Paid: once per visit to Sales, in the background, Kraken asks about its issued, unpaid invoices and sets those
  Fakturownia shows as `paid` to "Opłacona" (keeping the issue date). If Fakturownia cannot be reached, nothing
  changes and nothing is shown.

## Cutting off access

Create a new token in Fakturownia and paste it into Cloudflare. **Not checked yet** whether the old token then stops
working by itself or has to be removed separately in Fakturownia: check this when it is built, and write the
exact steps here.

## What it does (decided with the owner on 2026-11-28)

Checked first in the API docs (https://github.com/fakturownia/API, its `KSeF.md`, and pomoc.fakturownia.pl):
**the API has no draft invoice** (only a real document such as `kind: "vat"`, numbered when created, or a
`proforma`); a client can be searched by NIP (`GET /clients.json?tax_no=…`); an invoice's `status` / `paid` can be
read; a public PDF link is built from the invoice's `token`.

1. **Issue a VAT invoice from a sale ("Wystaw fakturę"), owner only.** Kraken first shows a check screen with exactly
   what will be sent (buyer, lines, net / gross, VAT, payment term). Only after "Wystaw" does it create the
   `kind: "vat"` invoice (number given by Fakturownia). Kraken then saves the invoice number and Fakturownia's
   invoice id with the sale and sets it to "Faktura wystawiona" (issue date: today). The prices are the sale's
   saved prices (REQUIREMENTS section 4); the sale is saved first so they are fresh.
2. **KSeF stays manual (owner, at least at first).** Kraken never sends to KSeF: it never uses `gov_save_and_send`
   or `send_to_ksef`. In Fakturownia the switch "Automatycznie wysyłaj tworzone dokumenty do KSeF" (Ustawienia >
   Integracje i dodatki > KSeF > Ustawienia) must be **off**; then the invoice waits for "Wyślij do KSeF" in
   Fakturownia, and until it is sent it can still be edited or deleted there. Kraken may show the KSeF state
   (`gov_status`, `gov_id`). With the KSeF integration on, Fakturownia blocks the PDF and e-mail until the invoice has
   its KSeF number, so the PDF link works only after sending. To check when built: what an API-created invoice does
   with auto-send off (the docs only describe it with auto-send on), and whether the "validate for KSeF" option
   (`validate_invoices_for_gov`) refuses Kraken's invoices.
3. **Buyer: found by NIP, else created.** Kraken looks the client up by NIP (`GET /clients.json?tax_no=…`; whether the
   match is exact is to check) and uses its `client_id`, so the address on the Fakturownia card is used. With no
   such client, Kraken creates one from Klienci: `name` = the CEIDG name (the short name if empty), `tax_no` = NIP,
   `email`, `company: true`, and the owner's defaults **`payment_to_kind: 14`** (14 days) and **`default_tax: 23`**;
   the owner adds the address in Fakturownia once. **E-mail required (owner, 2026-11-28: the invoice goes to it):**
   no invoice for a client without an e-mail in Klienci; the middleman never creates a client without one; if the
   client found in Fakturownia has no e-mail on its card, Kraken stops before creating the invoice and says so. A client without a NIP: Kraken asks for one first (Klienci).
   Every invoice sends `buyer_company: true` (KSeF.md: always send it).
4. **Invoice details:** payment term **14 days** (`payment_to_kind: 14`), payment by transfer, sell date = the
   sale's date, issue date = today; VAT **23 %** (the VAT in Packaging & discounts). Lines: **"KENIA 1 kg"** (product
   name and bag size), `quantity` = bags, unit `szt.`, `price_net` = the saved net price, `tax` = VAT. Free bags are
   left off the invoice. No discount field: the discounted net price is the line's price.
5. **Paid, automatically (both owners may read).** When Sprzedaż opens, Kraken asks Fakturownia about the sales it
   issued that are not yet paid (`GET /invoices.json?invoice_ids=…`) and sets "Opłacona" for those Fakturownia shows
   as `paid`. **Only invoices Kraken itself issued** (their Fakturownia ids are saved with those sales): Kraken never
   lists, reads or imports invoices made by hand in Fakturownia, and nothing new is ever added to Kraken from
   Fakturownia (owner, 2026-11-28). The middleman has no "list all invoices" action, only "read these ids".
6. **Allowed list in the middleman:** owner: find client by NIP, create client, create invoice, read invoices;
   partner: read invoices only. Nothing else (no delete, no sending to KSeF, no client list).
