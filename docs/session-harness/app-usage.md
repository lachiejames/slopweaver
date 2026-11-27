# Reading an app session's usage

A child of [the session harness](../session-harness.md). `cmux usage --harness app [--json]` asks the app
`usage.read` and prints, for each session this run of the app hosted (closed and failed ones included), the model
asked for against the one the vendor named, the models each turn was charged to, its tokens in that vendor's own
categories, and tokens per hour since its first ready. An app from before this refuses `usage.read` as
`BAD_REQUEST`, which the verb reports as an app to update.

- **Spend lands at a turn's END**, so a session mid-turn has not counted that turn: poll until idle. Each worker
  sends its turn's OWN tokens ahead of `turn-ended`, over ordered IPC, so the registry counts it before it releases
  the next turn (`desktop/src/sessionUsage.ts`). Claude's comes from the SDK result's cumulative per-model count,
  differenced against the previous result's, so subagent and compaction calls are in it; Codex's from the prompt
  response's `_meta.quota`, read strictly against the pinned adapter's shape
  (`desktop/src/sessionWorker/claudeUsage.ts`, `codexUsage.ts`).
- **A floor says so.** A turn that ends, fails or is cut off with no readable report is MISSING, never zero. A
  Claude turn with no baseline to difference from (the first after a resume, after a `conversation_reset`, or after
  a cumulative count that went backwards) is counted from the main loop alone and is PARTIAL. A total with either
  behind it prints as a floor, as does one read while a turn is under way, and a missing fact prints `unknown` or
  `not-reported`. A report that lands after its session went (a stop racing the worker's last send) takes that turn's
  missing count over, so the turn is still counted once.
- **Codex's `usage_update` is context occupancy**, how full the window is, kept beside spend and never added to it.
- **A session names its plan by its STORE** (the Codex home, or the Claude login's store, or a setup token's
  directory), and the CLI resolves that to an alias from the plans register: a plan of the same vendor whose
  `storeDir` is that path, else `unregistered`. Tokens are summed per plan only, never across vendors.
- **Nothing persists**: a restarted app starts every session's window again. The whole report is one socket line
  under the protocol's 1 MiB cap, with no paging; a run hosting thousands of sessions would outgrow it.
