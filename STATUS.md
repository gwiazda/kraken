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
- **Polish screens**: every screen (#41–#44).

## In progress
- **Phone layout for every tab** (branch `claude/mobile-tabs`): lists as cards (Dostawy, Wypały, Produkty, Klienci),
  Wypały's filters behind "Filtry", Opakowania i rabaty and Planer produktu fit the screen. Price tables and the
  Oferta preview scroll sideways inside their own box.

## Next steps (owner decides the order)
1. Filters and pages on the other lists (owner wants Roasts first, then the rest once happy).
2. Offer templates (e.g. a Christmas one).
3. Offer PDF straight to Google Drive (needs a PDF library).
4. Hand overrides of a discounted price (requirements section 5): probably not needed any more (special prices
   cover it); owner to decide whether to drop it.

## Open questions for the owners
- Share the Kraken sheet with the partner (owner decides when).

## Reminders
- Both owners must have 2-Step Verification on their Gmail accounts before real data goes in.
- Never commit real roast files or business data (public repo). Use made-up test data.
