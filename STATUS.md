# Status

_Last updated: 2026-11-20_

Snapshot of where work stopped. Rewritten at the end of each session; see `CLAUDE.md` for lasting decisions.

## Done (all merged and live at https://gwiazda.github.io/kraken/)
- Sign-in, choose/create the Kraken sheet, versioned migrations with backup (sheet needs **data version 13**:
  "Special prices" (#36) and "Sale notes" tabs; the owner clicks "Aktualizuj teraz" once if Kraken asks).
- Lots, Roasts and Sync with RoasTime (lots and roasts in one step, stock left per lot).
- Products (the one place for prices, beans, cost of one bag), Product planner, Packaging & discounts.
- Clients with special prices; Sales (sale / sample with any grams and follow-up notes / own use, invoice status);
  Offer (A4 preview, Save as PDF, "Use their special prices").
- Every list opens by clicking a row; ⚙ Settings on the right of the menu; Kraken opens on Sales, the first tab.
- Roasts: search, a filter under every column, pages. Sales works on a phone.
- **Polish screens**, steps 1–3 merged (#41, #42, #43).

## In progress
- **Polish, step 4** (branch `claude/polish-4`): Dostawy, Wypały, Synchronizacja z RoasTime. Also fixes the
  numbering of the folder steps on the sync screen (it showed 1, 2, 4).

## Next steps (owner decides the order)
1. Filters and pages on the other lists (owner wants Roasts first, then the rest once happy).
2. Phone layout for the other tabs (only Sales is done).
3. Offer templates (e.g. a Christmas one).
4. Offer PDF straight to Google Drive (needs a PDF library).
5. Hand overrides of a discounted price (requirements section 5).

## Open questions for the owners
- Share the Kraken sheet with the partner (owner decides when).

## Reminders
- Both owners must have 2-Step Verification on their Gmail accounts before real data goes in.
- Never commit real roast files or business data (public repo). Use made-up test data.
