# Kraken

Internal management system for **Krak Coffee Roastery**. Kraken is the app name.

## Purpose
Track the roastery's operations: green coffee inventory, roasting log (manual entry and import from the
Aillio Bullet R2 PRO), invoice requests, contractor price lists and the cost calculation
that sets retail prices.

**Full requirements: `docs/REQUIREMENTS.md`.** Read it before building any feature. When the owners add or
change a requirement, update that file in the same PR. Items marked [P] are proposals and [Q] are open questions:
do not treat them as decided until the owner confirms.

## Language
- The app (UI, code, data column names, docs) is in **English**.
- When the owners write or paste Polish, translate it to English. Keep Polish proper names
  (such as coffee names on the labels) as they are.

## Users
Internal only. Exactly two users: the owner and their business partner, both on Gmail accounts.
No public access. Sign-in is with Google. Access is enforced by Google: the spreadsheet is shared only with the two Gmail accounts.

## Architecture (decided so far)
- Front-end: a static site hosted on **GitHub Pages**
- Database: **Google Sheets**
- Authentication: **Google Identity Services (OAuth 2.0) in the browser**. The page calls the Google Sheets API
  directly with the signed-in user's access token. No backend and no Apps Script.
  Reason: Google enforces access through sheet sharing, there are no secrets to store, and there is nothing to host.
- The repo is **public**, because GitHub Pages on the Free plan requires it. The code is public; the data is not.
- Front-end stack (decided 2026-11-06): **TypeScript + Vite, no UI framework** (no React).
  Reason: TypeScript is readable and catches bugs; Vite is mainstream and outputs static files. A framework can be added later if screens get complex.
  Strict `tsconfig.json`; keep dependencies minimal (only `vite`, `typescript` and `vitest`, exact versions).
- OAuth scope (decided 2026-11-06): **`drive.file`**. Reason: least access, Kraken sees only its own sheet.
  Each user opens the shared sheet once through the Google Picker (needs a Picker API key restricted to the Picker API
  and the site's origins; such a key is public by design and may be committed).
- Published at `https://gwiazda.github.io/kraken/` (the address follows the repo name, `gwiazda/kraken`). Vite `base: './'` (relative links).
- CSP is a `<meta>` tag in `index.html`. Scripts: only self, `accounts.google.com` (sign-in) and `apis.google.com` (Picker).
  Inline styles are allowed because the Google Picker injects its own (checked in Chrome); inline scripts are not.
  `connect-src`: `sheets.googleapis.com`, `www.googleapis.com` (Drive copy for backups) and `accounts.google.com`.
- Google Cloud project `kraken` (owner's account, no billing): Sheets, Drive and Picker APIs enabled; OAuth consent screen
  External, in **Testing** with both owners as test users; Client ID, Picker key and project number are in `src/config.ts`.
  Picker key website restrictions must be `http://localhost:5173/*` and `https://gwiazda.github.io/*` (no `/kraken/` path):
  Chrome sends only the origin as referrer to Google, so a path rule fails with "The API developer key is invalid".
- Sign-in: GIS token client, popup style. The token (about 1 hour) lives only in memory. **Renew on the next click**
  (owner's choice B, 2026-11-09): every button that talks to Google is wrapped in `withFreshToken`; with under 5 minutes left
  it opens Google's popup first (closes by itself after the first consent), then runs the action. Popups need a click,
  so silent background renewal is impossible without a server. Nothing new is stored (no email hint).
  If renewal fails while the old token still has minutes left, the action runs with the old token.
  A page reload asks for one "Sign in with Google" click: the owner chose to keep the token in memory only, not in
  sessionStorage (2026-11-15, option A).
  "Sign out" only forgets the token in the tab; it does not revoke at Google (revoking removes the consent and the
  drive.file grant for picked sheets). Full removal: myaccount.google.com/connections.
- Known Google issue (diagnosed 2026-11-09): on a person's **first** sign-in, GIS reports `popup_closed` during the
  "unverified app" / allow screens and never delivers the token; the consent is still saved, so the second click works.
  Owner chose to handle it with a clear "click again" message (option A), not a redirect flow or publishing the app.
  `npm run dev` shows a sign-in log under the page (`src/ui/devLog.ts`, never in the live build) for diagnosing sign-in.

## Code structure (owner agreed 2026-11-15)
Modules with small public interfaces, like Java packages. Enforced by `src/architecture.test.ts` (an ArchUnit-style
test that reads every import line), so CI fails if a rule is broken.
- `core/`: shared toolbox, knows nothing about Kraken's tabs. `sheets.ts` Sheets API calls, `storage.ts` remembered sheet ID,
  `picker.ts` file picker, `loadScript.ts`. `dates.ts` local date. `numbers.ts` exact money (grosze) and weight (grams),
  `drive.ts` backup copy and `whoAmI` (signed-in email for `created_by`; works with `drive.file`, checked live 2026-11-15),
  `records.ts` a tab as a table of records (by header name; IDs, times, soft delete; an edit writes only the changed cells
  and is refused if someone changed the record or those cells meanwhile).
- `domain/`: shared business constants used by several features, pure (no Google, no screen): `bagSizes.ts` the fixed
  bag sizes (250 g, 500 g, 1 kg) and how a size is written. Added 2026-11-17 so a size is defined in one place.
- `auth/`: sign-in. `auth.ts` Google glue, `token.ts`, `signInFlow.ts` (keeps a token Google delivers late), `session.ts` renew-on-click.
- `schema/`: the sheet's structure. `meta.ts` schema version check, `connect.ts` create, open, check and update a sheet, `migrate.ts` backup and migrations.
- `features/<name>/` (built: `lots`: list, add, edit, delete, show deleted, restore, stock left (no prices: those are
  under Costs & prices); `present.ts` = pure text for the screen;
  `roasts`: roasting log, `allocation.ts` which lot each roast used and stock left (pure, oldest delivery first), Roasts page;
  `roastime`: "Sync with RoasTime" (lots and roasts in one step; roasts with no coffee, or a coffee with no delivery, are samples, not tracked), `model.ts` reads the files, `plan.ts` / `roastPlan.ts` the
  preview (pure), `apply.ts` saves (at most 4 requests: lot adds, lot updates, roast adds, roast edits incl. removals and restores);
  `costs`: "Costs & prices" (sub-tabs "Prices per lot" and "Bag costs & settings"; lot prices are edited here, stored
  on the Lots tab; bag sizes fixed at 250 g, 500 g, 1 kg; settings and bag cost items; a lot card shows the short answer, the steps fold
  under "Show calculation"; suggested gross prices rounded to whole złoty, net from the rounded gross;
  `modelCalc.ts` the calculation, pure, exact until rounded for the screen; also the **Price list** page
  (`pricesPage.ts`, `modelPrices.ts`, `presentPrices.ts`): a main gross price per coffee (= country + coffee name of
  its lots) and bag size, picked from the suggestions or typed, saved from today (older rows are the history);
  wholesale = main gross ÷ (1 + VAT) − discount, net rounded to whole złoty; discount buttons from the
  `wholesale_discounts_percent` setting (15; 25; 30) plus any typed %);
  `products`: Products page (named freely, not linked to lots; offer details and main gross price per size);
  `offers`: Offer page in Polish (customer, date, valid 14 days, ticked products / sizes / discounts; live preview of
  the owner's A4 template in `document.ts`, measured pagination; "Save as PDF" = Chrome's print window with the file
  name "Oferta dla … DD.MM.YYYY"; nothing stored; offer styles in style.css all start with `offer-`);
  lots get stock through `LotsPageDeps.loadStock`, so `lots` never imports `roasts`; see `ui/` below): `model.ts` types, validation and calculations (pure: no Google, no screen),
  `repo.ts` reads/writes its tab behind an interface (fake in tests), `page.ts` the screen, `index.ts` the public interface.
- `ui/`: shared screen helpers (`dom.ts` el/button/message/ⓘ tooltip/busy spinner, `googleErrors.ts` explains Google errors
  the same way on every screen, `history.ts` browser Back/Forward between Lots, Roasts, their forms, Sync, Costs & prices, Price list, Products (and its form), Offer and Settings (owner's
  request 2026-11-15; while saving, Back and the menu wait), `devLog.ts` dev-only sign-in log).
  Pages get what they need through a small deps interface (e.g. `LotsPageDeps`), filled in by `main.ts`. After connecting,
  the app shows the Lots page with a menu (Lots, Roasts, Costs & prices, Price list, Products, Offer, Settings); Change sheet and Sign out are under Settings. `main.ts`: start file and wiring; `config.ts`: public IDs. New sheets are named "Kraken YYYY-MM-DD" (Drive allows duplicate names; owner, 2026-11-15).
  "Create Kraken sheet" is hidden (owner, 2026-11-15: the partner should only see "Choose existing sheet"); it shows only
  when the address has the `new-sheet` parameter, e.g. `https://gwiazda.github.io/kraken/?new-sheet` (then Kraken also
  skips the remembered sheet and goes straight to that screen). The file picker has
  "All spreadsheets" and "Shared with me" tabs.
- Rules: imports only point down (feature → ui/schema/auth/domain → core → config); pure files (`features/*/model*.ts`
  and all of `domain/`) may use only their own model files, `core/numbers`, `core/dates` and `domain/`; `auth`, `schema` and each feature are imported
  only through their `index.ts`; nothing imports `main.ts`; app code imports no npm packages; test helpers (`src/testing/`) only in tests.

- RoasTime files are read with the classic folder chooser (`<input webkitdirectory>`): Chrome's File System Access
  picker refuses folders inside `~/Library` ("contains system files", checked 2026-11-15), so a folder cannot be
  remembered; the import screen shows the path with a Copy button instead.

## Commands
- `npm install`: once after cloning, and after `package.json` changes.
- `npm run dev`: local test server at **http://localhost:5173/** (fixed port; it is an OAuth origin). The Live Server extension is not used.
- `npm test`: run the automated tests once (`npm run test:watch` re-runs on every save).
- `npm run build`: type check (`tsc`) and build to `dist/`. `npm run typecheck`: type check only.

## Working process
Branch `claude/<topic>` → PR → CI (`.github/workflows/ci.yml`: tests + type check + build) must pass →
**Claude runs the `code-review` skill on the PR (level high: reviewer subagents; owner's choice 2026-11-09),
fixes real findings with tests and tells the owner which findings were skipped and why,** before asking the owner → owner tests locally if the PR says so, then merges →
`.github/workflows/deploy.yml` publishes `main` to GitHub Pages.

## Testing (owner's rule, 2026-11-06)
**Every calculation and every data operation must have automated tests**, so later changes can't silently break them.
- Covered: all calculations (stock, roast loss, costs, prices, discounts, VAT, totals), and adding, editing,
  deleting (soft-delete) and importing records (RoasTime import, CSV), including reading and writing rows by header name and migrations.
- Tool: **Vitest** (made for Vite). Tests sit next to the code as `*.test.ts`; `src/testing/fakeGoogle.ts` fakes single Sheets replies; `src/testing/fakeGoogleDrive.ts` is an in-memory Sheets + Drive for whole flows.
  CI and the deploy workflow run them, so failing tests block a PR and are never published.
- Keep logic in plain functions separate from the UI and from the Google API, so it can be tested without a browser or network
  (Sheets calls are faked in tests). Use made-up test data only.
- A bug fix comes with a test that would have caught it. Never delete or weaken a test to make it pass without the owner's OK.

## Data safety (owner's rule, 2026-11-09)
Everything must be **migration-proof**; full rules in `docs/REQUIREMENTS.md` section 7. In short:
- Structure changes only through versioned migrations: full backup copy of the spreadsheet first, then migrate, then check
  no rows were lost, and only then raise `schema_version` in `_meta`. Only add or rename; never drop columns without the owner's OK.
- Everyday edits: soft delete only, row IDs, `created_at` / `updated_at` / `created_by`; read columns by header name.
- Migrations run in the browser when a user clicks "Update now" (never on merge; GitHub has no access to the sheet).
  One file per migration in `src/schema/migrations/` (`NNN-what.ts`, listed in `index.ts`); steps are data
  (`migrationTypes.ts`: only `add-tab` so far, no delete step exists). The runner is `src/schema/migrate.ts`. Never edit a
  released migration: add a new one. New sheets are built from the same migration steps in one request (`initialTabs`).
- Raise `APP_SCHEMA_VERSION` in `src/schema/meta.ts` only together with a migration and its tests (a test checks they match).
  An app that sees a newer schema version than it knows must not write.

## Security rules
- Never commit secrets, API keys with write power, or OAuth client secrets. The OAuth Client ID is public by design and is fine.
- Never commit real business data, Gmail addresses or the spreadsheet ID. Test and sample data must be made up.
  The spreadsheet ID is entered in the app and stored in the browser (localStorage).
- Keep access tokens in memory only, never in localStorage.
- Keep third-party scripts to a minimum and use a strict Content Security Policy (XSS is the main risk).

## Branding
Brand assets are in **`assets/brand/`**. Read `assets/brand/README.md` before any UI work: it lists the logos,
colours (lime `#CAD401`, yellow `#F3E838`, black) and fonts. Use the provided logos as they are; never redraw them.
The label font (Erbaum) is commercial: never commit its font files without a web licence.

## Working with the owner
- The owner is not a developer. Give step-by-step instructions with exact clicks and commands, and explain
  what each PR changes in plain language.
- **One step at a time:** give one action per message and wait for the owner's "done" before the next. Answer only what
  was asked; if you spot a problem, explain it and ask before fixing it. Never push or open a PR the owner didn't agree to.
- The owner prefers accuracy over speed: check things rather than guess, and say clearly when something is unverified.
- The owner reviews and merges PRs in VS Code (GitHub Pull Requests extension) or GitHub Mobile.
- Setup: MacBook, Chrome, VS Code with the official Claude Code extension, repo cloned at `~/IdeaProjects/Kraken/kraken`.
  Homebrew, Node.js and the GitHub CLI (`gh`, signed in) are installed.
  The business partner also uses Chrome and does the roasting (RoasTime on his computer).
- Cloud sessions (from the Claude iPhone app) can't use `gh pr create` (GitHub GraphQL is blocked there);
  open PRs with the REST API instead: `gh api -X POST repos/gwiazda/kraken/pulls -f title=... -f head=... -f base=main -f body=...`.

## Open decisions
- The list of tabs and their columns (`docs/REQUIREMENTS.md` section 7, [P]): confirmed per feature as each one is built

## Rules for Claude
- **Keep this file up to date yourself, without being asked.** After any change that affects
  architecture, data model, commands, conventions, decisions or project status, update the
  relevant section of this file in the same commit. The user should never have to remind you.
- Record decisions in this file when they are made, with a one-line reason.
- Keep this file concise. Replace outdated information instead of appending to it.
- Ask before changing how data is read from or written to Google Sheets, or how authentication works.
- Commit and push work regularly. Sessions are temporary and unpushed work is lost.
- `main` is protected: never push to it. Every change goes on a branch and through a pull request
  that the user reviews and merges.

## Session status: `STATUS.md`
This file holds only lasting project knowledge. The current state of work (what was done last,
what is in progress, next steps, open questions) lives in **`STATUS.md`**.
- At the start of every session, read `STATUS.md` to pick up where the last session stopped.
- When the user ends a session ("Let's call it a day", "that's all for today", "koniec na dziś"
  or similar), rewrite `STATUS.md` with the current situation, commit it and open (or update) a PR.
  Tell the user it was saved and give the PR link.
- `STATUS.md` is a snapshot: rewrite it each time instead of appending a log. Git history keeps old versions.
- Lasting decisions still go in this file, not in `STATUS.md`.
