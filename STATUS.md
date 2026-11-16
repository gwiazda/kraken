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
- **Costs & prices, part 1** (PR #20): sub-tabs "Prices per lot" (lot price edited here, roast loss, cost of one bag,
  suggested prices at the price multipliers) and "Bag costs & settings" (fixed sizes 250 g / 500 g / 1 kg, items the
  same for every coffee, VAT, multipliers, default loss 15 %). Owner tested it locally.
- The owner deleted the unused "Bag sizes" tab from their sheet (fine: nothing reads it).

## In progress
- **Simpler Costs & prices** (branch `claude/simpler-costs`): each lot card shows the short answer (lot price, cost of
  one bag, suggested prices per size); the steps fold away under "Show calculation"; suggested gross prices are
  rounded to whole złoty (half up) and their net is worked out from the rounded gross. Owner to test locally.

## Next steps
1. **Price list** tab (REQUIREMENTS sections 5 and 6): chosen retail prices; wholesale view with a discount %.
   Agree the details with the owner first.
2. **Offer PDF** on Google Drive (REQUIREMENTS section 6): test both ways (PDF library vs Google Docs export) on a
   sample offer before choosing; shared "Kraken offers" folder.
3. Roasts filters and paging (later).

## Open questions for the owners
- Price list details (when we get there): rounding of discounted prices, presets, special prices per customer.
- Offer: which way to make the PDF, and whether to keep an editable Google Doc next to it.
- Share the Kraken sheet with the partner (owner decides when).

## Reminders
- Both owners must have 2-Step Verification on their Gmail accounts before real data goes in.
- Never commit real roast files or business data (public repo). Use made-up test data.
