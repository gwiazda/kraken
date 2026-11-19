# Status

_Last updated: 2026-11-18_

Snapshot of where work stopped. Rewritten at the end of each session; see `CLAUDE.md` for lasting decisions.

## Done (all merged and live at https://gwiazda.github.io/kraken/)
- Sign-in, choose/create the Kraken sheet, versioned migrations with backup (sheet is at **data version 9**).
- **Lots:** list, add, edit, delete/restore, stock left (prices are no longer on this page).
- **Roasts and "Sync with RoasTime"** (PR #19): lots and roasts in one step; stock left per lot (oldest delivery
  first). Roasts with no coffee, or whose coffee has no delivery in RoasTime, are samples and are not tracked.
  Owner synced the real data: 89 roasts, 54 samples removed; stock Santa Barbara 21,457 kg, Kenya Kegwa 31,2 kg,
  Burunga 30,4 kg (matches the owner's numbers).
- **Costs & prices** (PRs #20, #22: short answer first, "Show calculation", suggested prices in whole złoty): sub-tabs "Prices per lot" (lot price edited here, roast loss, cost of one bag,
  suggested prices at the price multipliers) and "Bag costs & settings" (fixed sizes 250 g / 500 g / 1 kg, items the
  same for every coffee, VAT, multipliers, default loss 15 %). Owner tested it locally.
- The owner deleted the unused "Bag sizes" tab from their sheet (fine: nothing reads it).

## In progress
- **Sales** (branch `claude/sales`, data version **10**: "Sales" and "Sale lines" tabs): sales with lines and
  invoice status, samples (client or a place), own use. Owner to test locally.
- Done before: Clients (PR #31); the owner's 7 clients were added straight into the sheet.

## Next steps
1. **Offer templates** (owner, 2026-11-17, later): e.g. a Christmas one with Santa, chosen per offer.
2. Offer PDF straight to Google Drive (later iteration; needs a PDF library).
3. Prices later: customers (name, NIP, own discount), special prices, hand overrides.
4. Roasts filters and paging (later).
5. **Translate all of Kraken to Polish** (owner, 2026-11-17: later).

## Open questions for the owners
- Share the Kraken sheet with the partner (owner decides when).

## Reminders
- Both owners must have 2-Step Verification on their Gmail accounts before real data goes in.
- Never commit real roast files or business data (public repo). Use made-up test data.
