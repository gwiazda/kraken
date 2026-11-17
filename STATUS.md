# Status

_Last updated: 2026-11-16 (owner paused after PR #20)_

Snapshot of where work stopped. Rewritten at the end of each session; see `CLAUDE.md` for lasting decisions.

## Done (all merged and live at https://gwiazda.github.io/kraken/)
- Sign-in, choose/create the Kraken sheet, versioned migrations with backup (sheet is at **data version 4**).
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
- **Price list, part 1** (branch `claude/price-list`, data version **5**: new "Price list" tab, added with
  "Update now"): main gross price per coffee and bag size (pick a suggestion or type; saved from today, history
  kept); wholesale view at 15 / 25 / 30 % (a setting) or any typed %, net rounded to whole złoty, with the gross.
  Owner to test locally.

## Next steps
1. **Offer PDF** on Google Drive (REQUIREMENTS section 6): test both ways (PDF library vs Google Docs export) on a
   sample offer before choosing; shared "Kraken offers" folder.
2. Price list later: customers (name, NIP, own discount), special prices, hand overrides.
3. Roasts filters and paging (later).

## Open questions for the owners
- Offer: which way to make the PDF, and whether to keep an editable Google Doc next to it.
- Share the Kraken sheet with the partner (owner decides when).

## Reminders
- Both owners must have 2-Step Verification on their Gmail accounts before real data goes in.
- Never commit real roast files or business data (public repo). Use made-up test data.
