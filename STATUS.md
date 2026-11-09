# Status

_Last updated: 2026-11-09 (end of the Google sign-in session)_

Snapshot of where work stopped. Rewritten at the end of each session; see `CLAUDE.md` for lasting decisions.

## Done
- Repo, branch protection, brand assets, requirements, made-up RoasTime samples, owner's Mac set up.
- Google Cloud project `kraken` set up (APIs, consent screen in Testing, Client ID, Picker key).
- Data safety rules confirmed (REQUIREMENTS section 7, `CLAUDE.md`). Code review by reviewer agents is a required PR step.
- PR #10 merged and live at https://gwiazda.github.io/kraken/: Google sign-in (renew on next click), create or choose
  the Kraken sheet, `_meta` tab with schema version 1, 90 tests in CI. Owner tested it locally and on the live site.
- The owner's real Kraken sheet exists (created from Kraken, with `_meta`). It is **not shared with the partner yet**
  (owner's decision, 2026-11-09).

## In progress
- Nothing. This PR only records the session.

## Next steps
1. Green coffee lots, the first real feature:
   a. Agree the Lots tab columns with the owner (start from REQUIREMENTS section 1; confirm each column).
   b. Build the migration framework first (backup copy of the spreadsheet via the Drive API, migrate, check row
      counts, then raise `schema_version`), with tests. Migration 1 -> 2 adds the Lots tab.
      The Drive copy call will need `https://www.googleapis.com` in the CSP `connect-src`.
   c. Lots screen: list, add, edit, soft delete; reading and writing rows by header name; tests for every operation.
2. Later: share the sheet with the partner (partner signs in and picks it once), when the owner decides.
3. Then the roasting log and RoasTime import.

## Open questions for the owners
- Columns of the Lots tab (to agree at the start of the next session).
- A RoasTime roast file that contains a note (to learn the notes field name). Not urgent.

## Reminders
- Both owners must have 2-Step Verification on their Gmail accounts before real data goes in.
- Never commit real roast files or business data (public repo). Use made-up test data.
