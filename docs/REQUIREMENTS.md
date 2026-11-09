# Kraken – Requirements

Functional requirements for Kraken, the internal inventory system of Krak Coffee Roastery.
Source: the owner's brief of 2026-11-06 (originally partly in Polish, translated here).
Polish column names from the brief are kept in brackets so they can be matched to the
spreadsheets the owners use today.

Status legend: **[R]** stated requirement · **[P]** Claude's proposal, awaiting confirmation · **[Q]** open question.

---

## 0. General

- **[R] Language:** the whole app is in **English**. When the owners paste Polish text
  (column names, notes, product names), translate it to English for the UI and code.
  Polish proper names stay as they are (for example coffee names on the labels, such as "Gwatemala Espresso").
- **[R] Users:** two owners, signing in with Google (see `CLAUDE.md`).
- **[R] Storage:** all data lives in one Google Sheet (see section 7).

---

## 1. Green coffee inventory

Record every delivery of green (unroasted) coffee and know how much is left.

**[R] Data per green-coffee lot**
- Coffee / lot name (for example "Kenia Kirinyaga")
- Origin: country, region (from the labels: country, region, altitude, process, variety)
- Altitude (m a.s.l.), process (washed / natural / ...), variety
- Supplier: where the coffee was bought from
- Delivery date
- Quantity delivered (kg)
- Price: price per sack and delivery cost (also feeds section 6)

**[P] Computed by the app**
- Green stock left (kg) = delivered − green weight of all roasts of that lot.
- Warn when a lot runs low (threshold set per lot, optional).
- **[P]** Each lot gets a short internal code (for example `KEN-2611`) so roasts and bags can refer to it unambiguously.

---

## 2. Bag sizes (bag stock deferred)

**[R] Bag sizes:** **250 g** and **1 kg** for now, but other sizes must be possible.
**[P]** Bag sizes are a configurable list (a "Bag sizes" tab), not hard-coded. They are used by invoice
requests (section 4), price lists (section 5) and the cost calculation (section 6).

**[R] Out of scope:** web shop sales (krakshop.pl) and cash register sales are **not** recorded in Kraken.
Only invoice requests are (section 4).

**[R] Decision (2026-11-06): no bag stock in the first version.** Kraken does not track how many packed
bags are on the shelf, because most sales are not recorded in it and the number would be wrong.
It tracks green coffee, roasts, invoice requests and prices.

**Possible later:** a stock count (enter the current number of bags per coffee and size when you count;
Kraken shows that count plus bags invoiced since), or quick "−N bags" stock-out entries.
Keep the data design open for this: the Bag sizes list and invoice lines already give what it would need.

---

## 3. Roasting log

**[R] Fields** (from the brief):
| English | Polish (original) |
|---|---|
| Coffee (green lot used) | Ziarna |
| Roast date | Data |
| Weight before roasting (g) | Masa przed wypałem (gramy) |
| Weight after roasting (g) | Masa po wypale (gramy) |
| Notes | Uwagi |

**[P] Computed:** roast loss % = (before − after) / before. The average loss per lot feeds the cost calculation (section 6).

**[R] Input:** manual entry **and** import from a file.

### Import from the Aillio Bullet R2 PRO (research, 2026-11-06)
The Bullet is used with Aillio's **RoasTime** software, which stores one **JSON file per roast**.
Locally they are in `~/Library/Application Support/roast-time/roasts/` (macOS) or
`%APPDATA%\roast-time\roasts\` (Windows). Roasts can also be exported as JSON from Roast World.

**Confirmed from two real roast files (RoasTime 4, Bullet R2 PRO, 2026-11-06).** Each file in
`roast-time/roasts/` is JSON with no file extension, named by the roast's `uid`, about 100–130 KB
(mostly per-second temperature curves). Fields Kraken uses:
| Kraken field | RoasTime JSON field | Notes |
|---|---|---|
| Roast date and time | `dateTime` | Unix time in **milliseconds**, UTC. Show in local time (Europe/Warsaw); a late-night roast can fall on the next calendar day |
| Coffee | `beanId` (+ `roastName`) | `beanId` points to a file in `roast-time/beans/`. `roastName` looks like `"<Coffee> <DD.MM.YYYY>-<batch>"`, for example `"Kenia 01.01.2026-3"` |
| Weight before (g) | `weightGreen` | grams, for example `1200` |
| Weight after (g) | `weightRoasted` | grams, for example `1026` |
| Notes | **not in the samples** | The partner (who roasts) sometimes writes notes in RoasTime; field name to be confirmed from a roast that has one |
| Duplicate check | `uid` | unique per roast |
| Change check | `updatedAt` | ms timestamp; changes when the roast is edited in RoasTime |
| Optional extras | `roastNumber`, `totalRoastTime` (s), `beanChargeTemperature`, `beanDropTemperature`, `indexFirstCrackStart`, `sampleRate` | stored only if useful later |

Kraken stores only these summary fields, never the temperature curves.
`roast-time/db.sqlite3` also exists, but its structure is undocumented and reading it in the browser
would need a large extra library, so Kraken reads the JSON files instead (same data).

**Ways to get the data out** (from forum posts, some years old; menus may have changed):
- **Roast World web (roast.world), single roast:** the roast's actions menu offers an export as **JSON**,
  and later posts also mention a **CSV** option.
- **The Roast World CSV** has a header block (bean name, green weight, date) and then a per-second
  temperature log. It does not appear to contain the roasted weight, so JSON is the better source.
- **The RoasTime desktop app** keeps every roast as a JSON file in the folder above. That gives
  **all roasts in bulk** without exporting one by one.
- No official bulk "roast history to CSV" export was found; it is a long-standing feature request.

**[P] Import design: "Sync roasts" button**
- **[R] Both owners use it the same way**, each on their own computer, with **Chrome**.
- **[R] Each person sets up their folder once**; after that, syncing needs no picking.
  - The first time, you pick the `roast-time/roasts` folder. Chrome remembers it in that browser.
  - Chrome can grant "allow on every visit"; then Kraken **syncs automatically when opened**.
    Otherwise Chrome asks "allow viewing files?" once per visit and **Sync roasts** is one click.
  - Browsers do not let a web page open a folder from a typed path, so the folder cannot be stored in the
    Google Sheet and reused on another computer. Each person picks it once on their own computer.
  - **[P]** The sheet records **when each person last synced** and how many roasts were found, so both can
    see whether Kraken is up to date (for example, "Last sync: partner, 2 hours ago, 3 new roasts").
- Safari and Firefox are not supported for syncing (they cannot remember folders). Manual entry works in any browser.
- Each sync reads **all** roast files and then:
  - adds roasts whose `uid` is not in Kraken yet;
  - updates roasts whose `updatedAt` changed (for example, roasted weight entered later), after showing what changes;
  - never deletes roasts from Kraken, even if a file is gone from the folder;
  - leaves Kraken-only fields (notes, lot link) untouched.
- **Coffee matching:** the first time a RoasTime `beanId` appears, you pick which green lot it is.
  Kraken remembers that, so later syncs match automatically. Unmatched roasts are listed for you to assign.
- Show a summary before saving: N new, N updated, N unchanged, N needing a lot, N missing roasted weight.
- Also accept a simple CSV with our five columns, for older roast history kept elsewhere.
- Files are read in the browser only; nothing is uploaded anywhere except the summary rows written to the Google Sheet.
- **[R] Notes:** keep a Notes column. Import RoasTime notes when present, and allow adding or editing notes in Kraken.
- **[Q]** Send one roast file that has a note written in RoasTime, so its field name is known. Not urgent.

---

## 4. Invoice requests

**[R]** A place where the partner records which invoices the owner needs to issue.

**[R] Fields:** number of bags, sizes, coffees, discount (if relevant), date, and a status showing whether the invoice has been issued.

**[P] Structure**
- One invoice request = header + one or more line items (an order often has several coffees and sizes).
  - Header: date, customer (from the contractor list, section 5), discount, status, notes, created by.
  - Line: coffee, bag size, number of bags, unit price (pre-filled from the price list, editable).
- **[R] Status:** `To issue` → `Issued` (with the invoice number and date issued) → `Paid`.
  Payment is tracked in Fakturownia today, so `Paid` is optional to use; it becomes useful once Kraken connects to the Fakturownia API.
- Totals net / VAT / gross calculated by the app.
- **[R]** Invoices are issued in **Fakturownia.pl**. Kraken only tracks the request and its status.
- **[P] Later, optional:** Fakturownia has an API. Kraken could then create a draft invoice in Fakturownia
  from a request with one click, and fill in the invoice number automatically. Not in the first version.
  It would need a Fakturownia API token, which must never be committed (see `CLAUDE.md`).

---

## 5. Price lists for contractors

**[R]** Per coffee: retail price, and prices with a discount, easy to look up when issuing an invoice.
Flexible enough to generate prices for any discount.

**[P] Proposal**
- **Retail price list:** one row per coffee × bag size, with net and gross price and a
  "valid from" date. The final prices come from the cost calculation (section 6) or are entered by hand.
- **Contractors:** name, tax ID (NIP), contact, and **default discount %**.
- **Price list view (computed, not stored):** pick a contractor (or type any discount %) and see
  the full price list with discounted net and gross prices, ready to copy or print.
- **Discount presets:** a short list (for example 10%, 15%, 20%) as quick buttons. B2B 15% is the current standard.
- **Special prices (optional):** a per-contractor override for a specific coffee and size, for negotiated deals.
- **Price history:** when prices change, the old ones are kept, so past invoice requests still show the price that applied then.
- **[R]** Discounts are taken off the **retail price**.
  (A percentage discount gives the same result whether it is applied to net or gross; only rounding can differ.)
- **[R]** No rounding: discounted prices are shown to the grosz (0.01 PLN).
- **[R]** Every discounted price can be **overridden by hand**. An overridden price is clearly marked,
  and can be reset to the calculated value.

---

## 6. Cost calculation and pricing

**[R]** Calculate what one bag of coffee costs to make, to set the retail price.

**[R] Columns from the brief** (one row per green-coffee delivery or lot):
| # | English | Polish (original) | Input or computed |
|---|---|---|---|
| 1 | Coffee | Ziarna | input (lot) |
| 2 | Delivery date | Data dostawy | input (lot) |
| 3 | Price per sack incl. proportional delivery cost | Cena ziarna za worek + dostawa proporcjonalnie | input |
| 4 | Quantity (kg) | Ilość kg | input |
| 5 | Unit price (per kg green) | Cena jednostkowa | = 3 ÷ 4 |
| 6 | Roast loss (%) | Strata na wypale | input, or average from the roasting log |
| 7 | Roasted weight from 1 kg green | Masa po wypale 1kg | = 1 kg × (1 − 6) |
| 8 | Cost of 1 kg roasted coffee | Koszt 1kg wypalonego ziarna | = 5 ÷ 7 |
| 9 | Cost of 250 g roasted coffee | Koszt wypalenia 250g ziarna | = 8 × 0.25 |
| 10 | 250 g bag (packaging) unit cost | Cena jednostkowa opakowania 250g | input (setting) |
| 11 | Label cost per 250 g bag | Koszt naklejek na opak 250g | input (setting) |
| 12 | Total cost of one 250 g pack | Koszt jednej paczki 250g | = 9 + 10 + 11 |
| 13–18 | Net and gross price at markup 2×, 2.5×, 3× | Cena netto/brutto (2x, 2.5x, 3x) | = 12 × markup; gross = net × (1 + VAT) |
| 19–20 | Final gross price (250 g / 1 kg) | Cena brutto końcowa (250g / 1kg) | input: the price you decide |
| 21–22 | Final net price (250 g / 1 kg) | Cena netto końcowa (250g / 1kg) | = gross ÷ (1 + VAT) |
| 23–24 | B2B 15% price (250 g / 1 kg) | B2b 15% (250g / 1kg) | = final price × 0.85 |

**[P] Make it flexible**
- **[R]** VAT rate is **23%** (default setting, editable).
- Packaging, labels, VAT rate and markups (2×, 2.5×, 3×) are **settings**, not fixed columns, so they can change.
- **[R]** Packaging and label costs must be **easy to add and change** in the app, per bag size.
  The 1 kg costs are not known yet; until they are entered, the 1 kg calculation shows "missing cost" instead of a wrong number.
- Calculate for **every bag size** in the size list, not only 250 g and 1 kg (packaging and label cost per size).
- **[R]** The cost of a bag must include **all costs that make up the bag** (beans after roast loss,
  packaging, labels, and any other per-bag item such as a valve or stamp). Other per-bag costs can be
  added as extra lines per bag size.
- **[R]** Energy is **not** included as a separate cost (too hard to measure).
- Final prices chosen here become the **retail price list** in section 5 (one source of truth).

---

## 7. Data storage and schema changes (Google Sheets)

**[R]** Everything is stored in a Google Sheet. Requirements will change over time, and **no data may ever be lost** during a schema change.

**[R] Data safety rules (confirmed by the owner, 2026-11-09).** Everything Kraken builds must be migration-proof:
- **Structure changes** (new tab, new or renamed column) go through **versioned migrations**. A `_meta` tab holds the
  schema version. Before a migration the app (1) makes a **full copy of the spreadsheet** in Google Drive as a backup,
  (2) runs the migration, (3) checks that all data is still there (row counts match), and only then (4) updates the version.
  If any step fails, the version stays as it was and the backup copy remains.
- Migrations only **add or rename** columns and tabs. Old columns are kept until the owner confirms they can go.
- **Everyday edits** (add, change, delete a record) do not make a full copy each time. They are protected by:
  **no hard deletes** (rows get a `deleted` flag, so a mistake can be undone), `created_at`, `updated_at` and
  `created_by` on every row, and Google Sheets' own **version history**.
- **The app reads columns by header name, not by position**, so adding or reordering columns never breaks anything.
- **Every row has a permanent ID.**
- **Only inputs are stored.** Stock levels, costs and discounted prices are calculated by the app,
  so changing a formula needs no data migration.
- An app version that finds a sheet with a **newer** schema version than it knows refuses to write to it
  (an old open browser tab must not damage data written by a newer Kraken).
- **Every migration has automated tests** that prove no data is lost.
- **Why not a new file for each version:** a new file gets a new ID and needs re-sharing, and data
  could be split across files. Updating in place with a backup copy first is safer.

**[R] Built (2026-11-09):** Kraken creates the spreadsheet with a `_meta` tab (`app` = `Kraken`, `schema_version` = `1`,
`created_at`) and checks it every time it opens a sheet.

**[P] Tabs:** one tab per kind of record (Lots, Roasts, Bag sizes, Contractors, Prices, Invoice requests,
Invoice lines, Settings), with row 1 as column headers. Each tab is added by a migration when its feature is built.
- **[P]** You can still open and read the sheet directly. Editing it by hand is possible, but the app is the preferred way.
