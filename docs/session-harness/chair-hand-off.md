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
- **Overrides**: `hand-off hold|release`, `--now --reason`, `--plan`. A cmux chair is refused, `--now` or not,
  because cmux cannot hold a `later` line.

Whether a hand-off is due is the watch's call, never the model's:
[chair-watch](../../skills/supervisor/reference/chair-watch.md).
