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

**[R] Lots tab (confirmed by the owner, 2026-11-15).** One row = one delivery = one RoasTime container.

| Column (shown as) | Stored header | Filled by | Notes |
|---|---|---|---|
| Code | `code` | Kraken suggests | `COUNTRY-YY-MM` in capitals, e.g. `KENYA-26-11`; a second lot in the same month gets `-B`; spaces become dashes. Editable, unique |
| Name | `name` | RoasTime / owner | e.g. Kenya Kegwa |
| Country | `country` | RoasTime / owner | |
| Region | `region` | RoasTime / owner | optional |
| Altitude | `altitude` | owner | optional, text (a range like "1600–1800" works) |
| Process | `process` | RoasTime / owner | optional |
| Variety | `variety` | owner | optional (RoasTime has only codes) |
| Supplier | `supplier` | owner | optional; filled in automatically for lots with a RoasTime supplier code already named once |
| Delivery date | `delivery_date` | RoasTime suggests / owner | suggested from when the container was created |
| Quantity delivered (kg) | `quantity_kg` | RoasTime / owner | the container's starting amount |
| Coffee price, net (PLN) ⓘ | `coffee_price_net_pln` | owner only | whole delivery. Tooltip: "Entered by hand. Not imported from RoasTime." |
| Delivery cost, net (PLN) ⓘ | `delivery_cost_net_pln` | owner only | whole delivery; 0 if none. Same tooltip |
| Notes | `notes` | owner | optional |

Background columns (not shown as normal columns): `id`, `roastime_container_id`, `roastime_bean_id`, `roastime_supplier_code`,
`created_at`, `updated_at`, `created_by`, `deleted_at` (empty = active; a date = deleted then).

- **[R]** No product name on lots: one product can be a blend of several lots (designed with section 6).
- **[R]** Deleted lots are hidden behind a "Show deleted" switch, greyed out, with "Restore".
- **[R]** An imported lot without a price shows a small "Price missing" marker; the Costs & prices page shows "missing" instead of numbers.
- **[R] Import from RoasTime (built 2026-11-15).** Button "Import from RoasTime" on the Lots page. The owner chooses the
  `roast-time` folder each time (Chrome refuses to remember folders inside `~/Library`, "system files"); the screen
  shows the path with a Copy button and the steps. Kraken reads only `containers/` (deliveries) and `beans/` (coffees).
  A **preview** comes first; nothing is saved until "Import selected":
  - deliveries not imported yet: "Add as a new lot" (suggested code, no prices, so "Price missing") or "Skip";
  - lots imported before (matched by RoasTime's delivery ID): differences in name, country, region, process and kg
    are shown as tick boxes (RoasTime is the source of truth, but nothing changes unticked; an empty RoasTime value never
    empties a Kraken field);
  - deleted in RoasTime: only a note, Kraken deletes nothing; lots deleted in Kraken are left alone.
- **[R] (owner, 2026-11-15)** Lots entered by hand are never matched with or changed by an import. Every lot shows its
  **Source**: "RoasTime" or "By hand".
- **[R]** Prices, delivery cost, supplier, notes, code, altitude, variety and an existing lot's delivery date are never
  changed by an import. A new lot gets the supplier already known for the same RoasTime supplier code.
- **[R] Built (2026-11-15):** the Lots tab (migration to data version 2) and the Lots screen: list (newest delivery first,
  green price per kg, "Price missing", a "Check" marker for unreadable cells), add and edit. The form has sections Coffee,
  Delivery, Price (with the calculated green price per kg) and Notes (owner's request). Delete asks once on a full-width
  line under the lot; "Show deleted (N)" lists deleted lots greyed out with Restore; a spinner shows while Google works.
  The RoasTime import is described below.
- **[R] Prices moved (owner, 2026-11-16):** the Lots page shows the lot itself (description, delivery, stock left);
  the coffee price and delivery cost are edited on the lot's card under **Costs & prices** ("Edit price", with the
  green price per kg shown while typing). The data stays in the same Lots columns.

**[R] Computed by the app (never stored)**
- Green price per kg = (coffee price + delivery cost) ÷ quantity delivered.
- Green stock left (kg) = delivered − green weight of the roasts of that lot. Roasts are allocated to lots **oldest lot
  first** (FIFO), splitting a roast when a lot runs out, because RoasTime records only the bean, not the container.
  The owner can override the allocation, and assign or mark roasts that have no bean (comes with the roasting log).
- No low-stock warning (owner, 2026-11-15: would not be used).

---

## 2. Bag sizes (bag stock deferred)

**[R] Bag sizes are fixed (owner, 2026-11-16): 250 g, 500 g and 1 kg.** They are set in the code (no editor), and
used by the cost calculation (section 6), and later by invoice requests (section 4) and price lists (section 5).

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

**[R] Built (2026-11-15): Roasts tab (data version 3), "Sync with RoasTime", stock left, Roasts page.**
- **Roasts tab** stores what RoasTime gives (`roasted_at`, `roast_name`, `green_g`, `roasted_g`, `roastime_roast_id`,
  `roastime_bean_id`) plus the owner's own fields: `lot_id` (only to override the automatic choice), `sample`, `notes`.
  Weights in grams (green whole grams; roasted may have one decimal, e.g. 132.5).
- **One "Sync with RoasTime"** (owner, 2026-11-15: lots and roasts in one place, one step), on the Lots and Roasts pages:
  choose the folder once, one preview, one "Sync". Roasts: new ones are added (no choice per roast); roasts with no
  green weight (or no time) are skipped and listed; roasts changed in RoasTime (time, name, coffee, weights) are listed
  and updated with one tick box; a roast no longer in RoasTime stays in Kraken (only a note). A sync never changes the
  lot, sample mark or notes, and never empties a value. RoasTime's comment becomes the notes of a new roast.
- **Which lot a roast used (calculated, never stored):** a lot chosen by the owner wins (reserved first); otherwise the
  lots of the roast's RoasTime coffee, **oldest delivery first**, splitting a roast when a lot runs out. If all lots of a
  coffee run out, the rest goes on the newest lot, which then shows below zero. Deleted lots are skipped. Lots entered by
  hand are only used when chosen. A roast without a coffee and without a chosen lot is not counted.
- **Samples (owner, 2026-11-15):** a sample with a coffee or a chosen lot counts in stock; without one it does not.
  RoasTime has no sample mark that Kraken can read, so samples are marked in Kraken.
- **Roasts with no coffee chosen in RoasTime, or whose coffee has no delivery in RoasTime, are samples and are not
  tracked** (owner, 2026-11-15): the sync does not import them (listed in the preview with the reason). One imported
  earlier is soft-deleted by the sync unless the owner gave it something in Kraken (a chosen lot, a sample mark or own
  notes; those are listed as kept). When a deleted one becomes a real roast (a coffee chosen, or its coffee's first
  delivery comes in the same sync), the preview offers to bring it back (own tick box, ticked; untick it if the roast
  was deleted on purpose). Risk accepted: a real roast saved without a coffee, or roasted before its delivery is entered
  in RoasTime, is left out of stock until that is fixed in RoasTime.
- **Stock left** per lot = delivered − green used, shown on the Lots page (below zero in yellow, with a note). A roast
  dated before the delivery of a lot it uses is marked "Before delivery".
- **Later (owner, 2026-11-16):** filters on the Roasts page (e.g. by coffee, lot, date, samples) and paging, so
  long lists are easy to sort out. Not urgent; after Costs & prices.
- **Roasts page:** newest first, roast loss %, the lot(s) used, marks (Sample, Needs a lot, Chosen, Before delivery);
  "Only roasts that need a lot"; Edit (lot, sample, notes; date and weights only for roasts entered by hand);
  Add roast by hand; Delete / Show deleted / Restore.
- Checked on the owner's real RoasTime data (2026-11-15): stock left matches the owner's estimate (21,5 / 31,2 / 30,4 kg).
- Not yet: "last sync" record in the sheet, CSV import of older roasts.

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

**[R] Decided with the owner (2026-11-19):**
- **Clients** tab (built first): short name, NIP (checked: 10 digits with a valid check digit), email, registered
  name (CEIDG), wholesale discount chosen from Packaging & discounts. A name or NIP can be there only once. The owner
  adds the existing clients by hand (real client data never goes into the code or tests).
- **Sales** tab (built, data version 10: "Sales" and "Sale lines" tabs): one record per entry, added by either owner: a **sale** to a client (lines: product, size,
  number of bags; a line can be free),
  a **sample** left somewhere (a client, or a place typed in), or **own use** (one of us took a bag, with a reason).
  Invoice status for sales: **To be issued → Issued (date) → Paid**; both owners can change
  it. Sales do not change stock (not now). The old sales stay in the old sheet as history.
  The list opens on **Invoice to be issued** (filters: all first, then to be issued, issued, paid, samples, own use, with counts). The status
  is changed with **one dropdown** in the Invoice column, any status to any other (owner, 2026-11-19: simpler than
  separate buttons). **Two dates** (owner, 2026-11-19): the entry's date and the date the invoice was issued
  ("Issued on" column). Choosing Issued opens a small date box (today, or the date it already has); Paid has no date
  of its own and keeps the issue date (it asks for it only when there is none yet). Opening an entry shows these dates in a box
  at the top (owner, 2026-11-19): date of the sale, added to Kraken (day and by whom), invoice status, invoice issued on. The list then switches to **All** so the entry stays in view. No invoice number (owner, 2026-11-19): the
  `invoice_number` and `paid_date` columns stay in the sheet, unused.
- **No prices in Sales** (owner, 2026-11-19): it records only how much went out (bags, and which are free). The owner
  takes the prices from the client's offer when issuing the invoice; the partner does not need to know them. The
  `unit_price_net_pln` column of the Sale lines tab stays (migration 10) but is left empty.

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
- **Special prices (optional):** replaced by the proposal "Special prices per client" below (2026-11-20).
- **Price history:** when prices change, the old ones are kept, so past invoice requests still show the price that applied then.
- **[R]** Discounts are taken off the **retail price**.
  (A percentage discount gives the same result whether it is applied to net or gross; only rounding can differ.)
- **[R]** No rounding: discounted prices are shown to the grosz (0.01 PLN).
- **[R]** Every discounted price can be **overridden by hand**. An overridden price is clearly marked,
  and can be reset to the calculated value.

**[R] Merged into Products (owner, 2026-11-18):** the Price list page is gone; **Products** is the one place for
prices (section 6, "Products and offers"). The rules below about wholesale rounding and discounts still apply; the
per-coffee prices and their history do not (a product keeps only its current price). The "Price list" sheet tab is no
longer read; the owner may delete it by hand (Kraken never deletes tabs). New sheets still get it, empty, because
migration 005 cannot be changed.

**[R] Decided with the owner (2026-11-16), Price list part 1 (replaced 2026-11-18, see above):**
- A **Price list** menu tab and sheet tab. It holds the **main price** per coffee and bag size: **gross**, set by
  clicking one of the suggested prices from Costs & prices or by typing one. Retail customers pay it.
  Each price is saved as a new row with a **valid from** date (today); old prices stay in the tab (price history);
  the newest row wins, also when a price is changed twice on one day.
- **Per coffee, not per lot:** lots with the same country and coffee name (e.g. "Kenya · Kegwa") are the same coffee,
  so a new delivery keeps the price. The suggestions come from the newest lot of that coffee.
- **Wholesale** prices are **net**, rounded to **whole złoty** (half up): main gross ÷ (1 + VAT), minus the
  discount, rounded (74 zł gross → 60,16 net → −15 % = 51,14 → **51 zł net**; gross for the invoice = 51 × 1,23).
  This replaces the "no rounding" rule above for wholesale.
- **Discounts:** 15 %, 25 % and 30 % from the start (a setting the owner can extend), plus any % typed once.
- Later (2026-11-20: customers are built as Clients, the offer PDF as the Offer page): special prices (proposal
  below), hand overrides of a discounted price.

**[P] Special prices per client (owner, 2026-11-20: "I will get back to that as one of the next steps"; not built,
not decided).** A deal agreed with one client: a fixed price for one product and one bag size, e.g. "Café Nowa
pays 38 zł for KENIA 250 g". Kraken remembers it and uses it on that client's offers.
- **Where it is set: on the client.** A client's page gets a **Special prices** section, one row per deal:
  product, size, their price, and next to it what they would pay otherwise (with their discount: "instead of 41 zł
  at their −15 %"; a client without a discount: "instead of 48 zł", the retail price without VAT) and what you earn
  on one bag with the gross margin, so the cost of the deal is visible. Add a row by choosing the product and size
  and typing the price.
- **One deal per client, product and size.** Adding a second one is refused ("Café Nowa already has a price for
  KENIA 250 g: change that one"); so is restoring a deleted deal while another one exists.
- **Where it is used: the Offer.** On the Offer page the customer can be **picked from Clients**; typing a name stays
  possible (an offer for a café that is not a client yet). For a picked client, wherever they have a deal the
  special price is shown (how it sits next to the discount lines: question 4). On the PDF it looks like any other
  price (the client does not see it is special). Whether the client's own discount is used: question 3.
- **Safety:**
  - A special price **does not change** when the product's retail price changes (it is an agreed deal). Each deal
    stores the retail price of that product and size **at the time it was set**; when today's retail price differs,
    the client's page marks the deal ("retail was 59 zł when this deal was set, now 64 zł") so the owner can decide
    to update it.
  - A deal that loses money is shown in red (as everywhere: below 0 % gross margin).
  - A deal whose client or product is deleted, or whose product no longer has a price for that size, is **not used**
    on offers; the client's page shows it greyed with the reason. It comes back into use when the product (or the
    size's price) comes back.
  - Deleting a deal is a soft delete (can be restored), as everywhere.
- **Sheet:** a new **Special prices** tab: `client_id`, `product_id`, `bag_size_g`, the price, `retail_gross_pln_at_deal`
  (the retail price when the deal was set), plus the usual id / times / deleted; added by a data-version update with
  a backup first.
- **[Q] Before building, the owner decides:**
  1. Is the special price **net** (like the wholesale prices) or gross?
  2. Does a deal have an **end date** (e.g. "until 31.12"), or does it stay until deleted?
  3. When a client is picked on the Offer, is **their discount always used**, or can the discounts still be ticked
     by hand?
  4. An offer can show up to 4 discount lines per product. Where there is a deal: does the product show **only the
     deal price**, or the deal price **as an extra line** next to the discount lines?

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

**[R] Decided with the owner (2026-11-16)**
- The retail price is set **per lot** (delivery), as in the original sheet; the price list later uses the newest lot of each coffee.
- **Roast loss** = the average of the lot's roasts (weighted by the green coffee each took from the lot; a roast
  split over two lots counts with its part), unless the owner types their own % for the lot. A lot with no roasts
  with both weights yet uses the **default 15 %** (a setting).
- **All costs are net** (lot prices, delivery, bag items). Markup × cost of one bag = net price; gross = net × (1 + VAT).
- Amounts are exact during the calculation and rounded to the grosz (half up) only on the screen.

**Built (part 1, 2026-11-16):** a "Costs & prices" menu tab with two parts:
- **Prices per lot:** one card per lot: its price ("Edit price"), green price per kg, roast loss with its source and
  "Change", roasted from 1 kg, cost of 1 kg roasted, and for 250 g, 500 g and 1 kg: coffee, items, cost of one bag,
  net and gross price at each markup.
- **Bag costs & settings:** the cost items of each bag size (add, edit, delete); VAT, markups, default loss.
- **Made simpler (2026-11-16):** a card shows only the lot price, the cost of one bag and the suggested prices
  (gross in whole złoty, with their net) per size; the rest folds away under "Show calculation".
Tabs (data version 4): `Cost settings` (name, value), `Bag costs` (bag_size_id = the size in grams, item,
cost_net_pln), `Lot costs` (lot_id, roast_loss_percent). (A first test of version 4 on the owner's sheet also made a
"Bag sizes" tab; the owner deleted it, and Kraken never reads it.)
**Next (part 2):** the final gross price per lot and bag size (typed), with the net price and B2B −15 %; old prices kept.

**[R] Goal of Costs & prices (owner, 2026-11-16):** an easy way to check roughly what the price for the customer
should be. It must stay **simple**: the owner finds it already crowded ("too much data will kill us").
**[R] Two kinds of customers:** **retail** customers pay the retail price; **wholesale** customers get a discount
in percent off the retail price (see section 5).
**[P] Where it goes (Claude's advice, not decided yet):**
- *Costs & prices* answers only "what does a bag cost us, and what retail price makes sense". Each lot card shows the
  short answer (cost of one bag and the suggested prices); the step-by-step calculation folds away under
  "Show calculation".
- The **chosen retail prices** and the **wholesale view** (pick or type a discount %, see every coffee and size at
  that price) go to one separate **Price list** tab (section 5). That tab is what the partner uses day to day, and
  what an offer is made from.

**[R] Rounding of suggested prices (owner, 2026-11-16):** the suggested **gross** price is rounded to **whole
złoty** by the usual rule (half up: 74,50 → 75 zł); the net price is calculated from the rounded gross. The exact
amounts stay visible in the step-by-step calculation. (Built 2026-11-16.)

**[R] Costs & prices removed (owner, 2026-11-18):** the page is gone; what it held moved to where it is looked for:
- **Lots:** the lot's price and delivery cost are in the lot form again (section "Price (what you paid, without VAT)",
  with "= 77,00 zł for 1 kg of green coffee" while typing), plus an optional roast loss % (empty: the average of the
  lot's roasts, else the usual loss). The list shows **Price / kg** and **Roast loss**.
- **Packaging & discounts** (new menu tab; Settings stays technical): packaging items per bag size (net, the same for
  every product), **wholesale discounts with a short name** for the offer (at most 12 characters; add or remove any;
  "Discounts" tab, data version 7; the template's 15 / 25 / 30 % until the first change), VAT and the usual roast loss.
- The **multipliers are fixed** at 2×, 2,5× and 3× (no setting).
- **Offer:** tick which discounts to include, **at most 4 per offer** (each adds a price line to every card); names
  come from Packaging & discounts. If the banner does not fit under the last products, the last product moves to the
  next page with it, so no page holds only the banner. Checked with 4 discounts, 12-character names and 3 sizes.
- Short plain-language tooltips next to every number, in normal letters, floating above the page (owner, 2026-11-18).
- **Sync with RoasTime** is under Settings (owner, 2026-11-18), not on the Lots or Roasts page.
- The product page shows a column per discount from Packaging & discounts (no "Another discount" box).

**[R] A product's beans (owner, 2026-11-18; built, data version 8):** goal: "when I think about buying some beans I
need to know what price to put on my product".
- A product is made of **up to 3 beans**: a **lot** (its price per kg from Lots, its roast loss) or a **planned
  bean** not bought yet (a name, the quoted price per kg with delivery and without VAT, an optional roast loss;
  empty: the usual loss). Saved with the product ("Product beans" tab).
- Each bean has a **share of the bag** (whole percent), set on **one bar** (owner, 2026-11-19): drag the white divider
  between two colours, or type the percentage; the total is always 100 % (each at least 1 %). The colours are easy
  to tell apart (lime, orange, sky blue).
- In the form, the beans are on the left and the prices on the right (staying in view while the shares change);
  stacked on a narrow screen.
- Live under the beans, per size: **cost of one bag** (coffee + packaging), **suggested prices** at 2×, 2,5×, 3×
  (with VAT, whole złoty) as buttons with **what each earns per bag**, and what the typed price earns ("You earn" /
  "You lose" in red when it does not cover the cost). Earnings = the price without VAT minus the cost of one bag.
- Rule: roasted price per kg of a bean = green price per kg ÷ (1 − roast loss); the blend's = each bean's, weighted
  by its share of the coffee in the bag.
- The product page shows **Cost and earnings** (made of …, cost of one bag, what the retail price earns).
- **Suggestions (owner, 2026-11-19):** only the **250 g** bag gets 2× / 2,5× / 3× its cost (with VAT, whole złoty).
  **500 g and 1 kg follow the 250 g price** the owner set: as many 250 g bags as fit (2 or 4), without their
  packaging, plus the packaging of the one big bag (packaging with VAT), rounded to whole złoty. Example: 250 g at
  45 zł, packaging 6,48 zł with VAT: 1 kg = 180 − 25,93 + 6,48 = 160,55 → 161 zł. Without a 250 g price the bigger
  sizes say "Set the 250 g price first".
- **Product planner** (owner, 2026-11-19; was "Planner"). Below the beans and prices it also shows the **wholesale
  prices** of the typed prices (the same table as a product's page, with what each price earns per bag; red when it
  loses money) and **Compare with your products**: the plan next to every product for one bag size (cost of a bag,
  retail price, what it earns, and what it earns at **each wholesale discount** set under Packaging & discounts,
  one column each with its name), sorted by what they earn. The product form
  stays without these. A product's page shows the earnings under its prices too (same table).
- **Gross margin next to every earning** (owner, 2026-11-19): wherever Kraken says what a bag earns (a product's
  Cost and earnings and its prices table, the Product planner's prices, suggestions, wholesale prices and comparison)
  it also shows the gross margin: the part of the price without VAT left after the cost of the bag, in whole
  percent (rule in `domain/prices.ts`). Every place has the same plain-words tooltip, and "How is this worked out?"
  explains it with the real numbers. Red below 0 %.
- **Product planner tab** (owner, 2026-11-19): the same beans-and-prices tool as in the product form, as a scratchpad:
  try beans (lots or planned), shares and prices, nothing saved. "Try in Product planner" on a product's page copies its
  beans and prices there (the product is not changed); "Create product from this" opens Add product with them
  filled in. One shared piece of code for both places, so they never differ.
- **Every number is explained** (owner, 2026-11-19): "Why … per kg?" (each bean's green price, how roasting makes
  it lighter, how the beans are mixed) and, per size, "How is this worked out?" (coffee, packaging, cost of one bag,
  what your price earns after VAT, how each suggested price is reached), in plain sentences with the real numbers.
  Folded by default; they stay open while the shares or prices change.

**[R] Blend calculator (owner, 2026-11-17, later):** an easy way to see what a blend costs: pick coffees from the
lots, set each one's share with a slider, and see the cost of one bag of the blend (250 g, 500 g, 1 kg) and the
prices and earnings at the markups (2×, 2,5×, 3×, …). Nothing is saved, for now.

**[R] Products and offers (owner, 2026-11-17; built):**
- A **Products** page and tab: products named however the owner likes (e.g. "Kenia", "Gwatemala Espresso"),
  **not linked to lots**. Each has the details shown on the offer (country, region, altitude, processing, variety,
  flavour profile, brew method such as Espresso / Filtr) and its own **main gross price** per bag size (250 g, 500 g,
  1 kg; empty = not offered in that size). Only the current price is kept (owner, 2026-11-18).
- **Products is the one place for prices** (owner, 2026-11-18): the list stays simple (name, brew method, origin,
  main prices); clicking a product shows its main gross prices and its **wholesale prices at each discount** (net,
  whole złoty, with the gross), plus "Another discount" for any %. The offer uses the same prices.
- In the product form, suggested prices from a chosen lot (Costs & prices: cost of one bag × markup + VAT, whole
  złoty) are buttons that fill the price in; a price can also be typed. Only the price is saved, not the lot.
- An **Offer** page, in **Polish** (for Polish customers): customer name, date, **valid for 14 days** (the "valid
  until" date is on the offer), ticked products, ticked bag sizes and ticked discounts (from the discount setting),
  each with a name such as "Do 10 kg" (default names for 15 / 25 / 30 %: "Do 10 kg", "10–20 kg", "20+ kg").
  Prices on the offer: wholesale **net**, rounded to whole złoty (as on the product page), one block per size;
  "Sugerowana cena detaliczna brutto" (the main gross price) under **250 g only**.
- The owner sets the **order** of the products on the offer (↑ ↓). Empty product details are left out.
- **Product order** (owner, 2026-11-19): drag and drop on the Products page (a ⠿ grip on each row; mouse or finger;
  the arrow keys on a focused grip; owner found ↑ ↓ buttons clumsy) saves the order in the sheet in the background
  (owner, 2026-11-20: no reload, page not locked; the new order shows at once, saves run one after another) (`position` column of
  the Products tab, data version 11). The Offer page starts in that order, and ↑ ↓ there still changes it for that
  one offer only (not saved). Other lists of products (Product planner, Sales) use the same order. Products without
  a position (new ones) come last, by name.
- The **yellow banner** text is made from the ticked discounts and sizes, and can be changed per offer (title, main
  line, small print; "Back to the standard text"). "Sugerowana cena…" stays on one line.
- **Prices never move under a product name** (owner, 2026-11-17): a long name gets smaller (22 → 16 pt) on one line,
  then wraps onto two lines (18 → 16 pt), and only a very long one takes more. With all three bag sizes ticked there
  is no room beside any name, so every card on that offer puts its prices under the name (one layout for the offer).
- The design is the owner's HTML template (logo, crack, lime bean icon, cards, yellow banner), A4; products flow onto
  more pages as needed. The page background is pure black (#000, template #0a0a0a) so the logo's black background
  does not show as a box.
- **PDF:** "Save as PDF" opens Chrome's print window with the file name filled in, e.g. "Oferta dla Kawiarnia Pod
  Lipą 16.11.2026". No new library. Offers are **not stored** in Kraken (owner: keep it simple; the PDF is the record).
- **Later: more offer templates** (owner, 2026-11-17), e.g. a Christmas one (with Santa), chosen per offer.
- **Later:** Kraken makes the PDF itself and puts it on Google Drive (shared "Kraken offers" folder) — needs a PDF
  library (a picture of the page, or the design redrawn in code). Until then, Google Drive for desktop can make the
  saved PDF appear on Drive.

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

**[R] Built (2026-11-09):** Kraken creates the spreadsheet with a `_meta` tab (`app` = `Kraken`, `schema_version`,
`created_at`) and checks it every time it opens a sheet.

**[R] (owner, 2026-11-15)** Creating a sheet is owner-only and rare: the button "Create Kraken sheet" appears only on
`https://gwiazda.github.io/kraken/?new-sheet`. Everyone else sees only "Choose existing sheet"; Google's file window has
"All spreadsheets" and "Shared with me" tabs. New sheets are named "Kraken YYYY-MM-DD" (Drive allows duplicate names).

**[R] Built (2026-11-15): migrations.** When Kraken opens a sheet with an older data version, it shows what will change
and the backup's name, and does nothing until someone clicks **Update now**. Then, in the browser: (1) a full copy named
"Kraken backup YYYY-MM-DD (before vN)" is made in Google Drive and checked against the sheet (same tabs, same number of rows, same header rows; not
every cell, because formulas like `=TODAY()` can show a different value in the copy); (2) the
migration runs; (3) Kraken checks every old tab has the same number of rows and the new headers are there; (4) only then
`schema_version` is raised. A failure at any point leaves the version as it was; clicking Update now again is safe (steps
already done are recognised). A tab with the same name that Kraken did not make is never touched. Old backups stay in
Drive until the owner deletes them. A brand-new sheet is created in one all-or-nothing request with every tab the
migrations describe (a test checks it equals an updated old sheet).

**[R] Tabs:** one tab per kind of record, with row 1 as column headers, each added by a migration when its feature
is built. Today (data version 11): `_meta`, Lots, Roasts, Cost settings, Bag costs, Lot costs, Price list (no longer
read), Products, Discounts, Product beans, Clients, Sales, Sale lines. Planned: Special prices (section 5, proposal).
- **[P]** You can still open and read the sheet directly. Editing it by hand is possible, but the app is the preferred way.
