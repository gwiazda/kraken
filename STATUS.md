# Status

_Last updated: 2026-11-09 (Google sign-in session)_

Snapshot of where work stopped. Rewritten at the end of each session; see `CLAUDE.md` for lasting decisions.

## Done
- Repo, branch protection, brand assets, requirements, made-up RoasTime samples.
- Owner's Mac set up (VS Code + Claude Code, Node.js, GitHub CLI). TypeScript + Vite site live at https://gwiazda.github.io/kraken/.
- Google Cloud project `kraken` set up by the owner: Sheets, Drive, Picker APIs; consent screen (External, Testing,
  both owners as test users, `drive.file`); Client ID; Picker API key restricted to Picker + Kraken's addresses.
- Data safety rules confirmed by the owner and recorded (REQUIREMENTS section 7, `CLAUDE.md`).

## In progress
- PR "Google sign-in and sheet connection": sign in, create or choose the Kraken sheet, `_meta` tab with
  schema version 1, renew-on-next-click sign-in (option B), Vitest with 72 tests run in CI; first-sign-in "click again" message. Needs the owner's local test with a real Google sign-in, then merge.

## Next steps
1. Owner tests the sign-in PR locally (steps in the PR), then on the live site after merging.
2. Owner creates the real Kraken sheet and shares it with the partner; partner signs in and picks it once.
3. Migration framework (backup copy, migrate, verify, raise version) with tests, built with the first data tab.
4. Green coffee lots (first tab), then the roasting log and RoasTime import.

## Open questions for the owners
- Columns of the Lots tab (confirm when we build it).
- A RoasTime roast file that contains a note (to learn the notes field name). Not urgent.

## Reminders
- Both owners must have 2-Step Verification on their Gmail accounts before real data goes in.
- Never commit real roast files or business data (public repo). Use made-up test data.
