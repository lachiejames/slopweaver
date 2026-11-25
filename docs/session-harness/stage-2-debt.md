# Stage-2 debt, and the chair the app can hold

Child of [the session harness](../session-harness.md) § "Which verbs go through it".

## The raw cmux operations

The host surface forwards cmux's raw operations unchanged (`CmuxHostRawOperations`): screen reads and grids, the
process tree and `workspaceTop`, a raw `sendLine` and `submitComposer`, pin, rename, close and the strict listings;
beside it, `CmuxHostReach`'s `reachSession`, which never interrupts and keeps cmux's own error so a talk delivery can
still tell a keystroke that may have landed from one that did not. Each is cmux-only, reachable only over a
connection the seam opened, and is what a second implementation has to answer before it can stand behind these
verbs. Stage 1 is done: no caller outside the seam constructs a client.

## The supervisor pin, without a cmux pin

The raw pin is cmux's own, and nothing in the app stands in for it. An app-hosted chair is recorded in the
supervisor pin record's app arm (`src/sessions/supervisorPin.ts`, the collision rule in `src/supervisor/appPin.ts`).
A cmux record reads exactly as it always did, so no record is migrated.

- **`cmux pin` inside an app session** records that session, pinning nothing in cmux. The app must first vouch for
  it: the verb sends `session.origin` with the app session id the app set in its environment
  (`SLOPWEAVER_APP_SESSION_ID`) and the vendor session id it runs as, and the app answers only when that app session
  runs exactly that vendor session (`src/sessionHarness/appSessionOrigin.ts`, `desktop/src/sessionOrigin.ts`).
- **`cmux takeover`** hands the seat across either host (`src/cli/commands/cmux/takeoverHosts.ts`), and closes an app
  predecessor only through the harness, never through cmux and never by a kill.
- **The chair gate** reads an app chair through the app and judges that one session's transcript. An app that does
  not answer is `app-chair-unread`, which never opens the cmux-silent caller-only pass.

**Residue, stated.** The origin check shows the caller holds both ids, not that no other process run by the same
user rewrote both. A same-user process that sets both can claim to be the session.
