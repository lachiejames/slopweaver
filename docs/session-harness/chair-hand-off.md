# The control plane seats the chair's successor

A child of [the session harness](../session-harness.md). `supervisor hand-off` resolves the pinned app chair
through the harness and sends its note request with `later` delivery, so it lands once the chair's turn ends; then
it closes the chair's run, writes the successor doc and opens the successor through
`cmux spawn --harness app --plan <alias>` (`src/cli/commands/supervisor/chairSuccessorLaunch.ts`, the same spawn a
Recovery press runs).

- **The model only writes the note** (`supervisor hand-off note`); with none, the successor rebuilds from files.
- **Each step is journalled** under `$SLOPWEAVER_HOME/supervisor/hand-offs/`, so a crashed run resumes and
  reconciles before it spawns again: the ledger first, then the app's own session list, and an app that cannot be
  asked spawns nothing (exit 4). A journal another chair started is refused; the chair's run is closed only while
  it still re-resolves to the run the episode began over.
- **The desktop app presses it** (`desktop/src/chairWatchShell.ts`): it reads `supervisor chair-watch --json` every
  minute and runs `supervisor hand-off` AT MOST ONCE per outgoing chat on a `hand-off` reading for an app chair. Every
  pressed chat's attempt is saved before its press (`chair-hand-off.json` in the app's `userData`), so neither a
  restart nor a chat returning as the chair presses it again. Exit 4, a refusal or a failure is shown, and re-run by
  a session or the owner, never by the app. A file that will not read or save pauses every press. The journal stays
  the authority. The menu bar shows the watch's first reason, the chair's plan, the successor's plan, a hold, the
  newest attempt and a pause.
- **Overrides**: `hand-off hold|release`, `--now --reason`, `--plan`. A cmux chair is refused, `--now` or not,
  because cmux cannot hold a `later` line.

Whether a hand-off is due is the watch's call, never the model's:
[chair-watch](../../skills/supervisor/reference/chair-watch.md).
