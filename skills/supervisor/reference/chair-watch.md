# The chair watch, and where the chair's successor lands

A child of [plan-routing.md](plan-routing.md) § The chair's hand-off cadence, which owns the judgement itself.

## Where the successor lands

A hand-off's `--driver claude|codex` is the plan register's, read only on a hand-off (one plan of either provider):
[chairSuccessor.ts](../../../src/supervisor/chairSuccessor.ts), Claude only on a route that PICKS, a Codex or
ambient-Claude pick confirmed by the spawn's own live read; no seatable host keeps the sweep prompt under
`HAND-OFF TARGET UNAVAILABLE — <why>`. The successor owns the re-arm. A chair SEATED on Codex is judged on stale
canon alone: the other five read Claude sessions only.

## `slopweaver supervisor chair-watch [--json]`

The control plane's ONE read-only pass of the same judgement, on RECORDED readings only (each plan's last
`claude gauge` snapshot, fresh within the hour and its window not reset; never a probe). It prints one status line,
then each section that has something to say:

- **STAY**, **HAND-OFF** (naming the successor's plan and host), **HELD** (`supervisor hand-off hold|release
--reason`), **UNMEASURED** or **UNSUPPORTED** (a cmux or Codex chair, which the control plane cannot hand off from).
- Every reason, each plan's reading, the notes and the overrides.
- Each app session's asked-against-ran model and tokens per hour, and each plan's app total beside the model host's
  own reading, never added to it.

**What it reads, and that it writes nothing.** The pin and chain journal, then the pinned chair (cmux's workspaces,
`ps`, its transcript, the app's `session.origin`); transcripts for auto-compactions; `git log origin/main` against
the last fetch for canon (no fetch); `ps`/`lsof` for boot plans; `claude --version`; the plan register; the hold
journal; the snapshot and spend records; the app's `usage.read`. A **Codex** successor is named as chosen at
hand-off time, no alias, with a note: its live seat read files sign-ins and the fleet-cap record, so `supervisor
hand-off`'s own fresh pass makes it (`handOffChairWatchDeps`, [chairWatchRun.ts](../../../src/cli/commands/supervisor/chairWatchRun.ts)).
Every register read is read-only (`readOnlyPlanRegisterPort`): a `behind` store or an unimported register file
reads as an unread register rather than being caught up or imported.

Never a loop: the control plane calls it on its own timer. What acts on a `hand-off` report:
[the chair hand-off](../../../docs/session-harness/chair-hand-off.md).
