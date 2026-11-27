# Status

_Last updated: 2026-11-27_

Snapshot of where work stopped. Rewritten at the end of each session; see `CLAUDE.md` for lasting decisions.

## Done (all merged and live at https://gwiazda.github.io/kraken/)
- Sign-in, choose/create the Kraken sheet, versioned migrations with backup (sheet needs **data version 14**:
  "Special prices" (#36), "Sale notes" tabs and the products' status column; the owner clicks "Aktualizuj teraz" once if Kraken asks).
- Lots, Roasts and Sync with RoasTime (lots and roasts in one step, stock left per lot).
- Products (the one place for prices, beans, cost of one bag), Product planner, Packaging & discounts.
- Clients with special prices; Sales (sale / sample with any grams and follow-up notes / own use, invoice status);
  Offer (A4 preview, Save as PDF, "Use their special prices").
- Every list opens by clicking a row; ⚙ Settings on the right of the menu; Kraken opens on Sales, the first tab.
- Roasts: search, a filter under every column, pages. Sales works on a phone.
- **Polish screens**: every screen (#41–#44).

- **Phone layout for every tab** (#45), own use without "Po co?" (#46), offer discounts per invoice (#47), the 250 g
  price fills in 500 g and 1 kg (#48), sample sizes and client details in Sales (#49), general offer, product status
  W sprzedaży / Próbne / Wycofane (data version 14; only products on sale on the Offer) and Sales opening on
  "Faktura do wystawienia" (#50).

## In progress
- Branch `claude/client-discount-removal`: the client "Rabat" field removed (the discount depends on each invoice's
  weight); special prices compare with every discount; price rules for invoices written down (REQUIREMENTS
  section 4, "Prices on an invoice").

## Next steps (owner decides the order)
1. Filters and pages on the other lists (owner wants Roasts first, then the rest once happy).
2. Offer templates (e.g. a Christmas one).
3. Offer PDF straight to Google Drive (needs a PDF library).
4. Hand overrides of a discounted price (requirements section 5): probably not needed any more (special prices
   cover it); owner to decide whether to drop it.
5. Connect to Fakturownia: decided how (`docs/FAKTUROWNIA.md`, 2026-11-27) and the invoice price rules (REQUIREMENTS
   section 4), not built; first decide what it should do, and how each discount's starting weight is stored.

## Open questions for the owners
- Share the Kraken sheet with the partner (owner decides when).

## Reminders
- Both owners must have 2-Step Verification on their Gmail accounts before real data goes in.
- Never commit real roast files or business data (public repo). Use made-up test data.
