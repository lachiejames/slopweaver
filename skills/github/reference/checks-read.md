# A pull request is not RAISED until its checks have been read once

Bundled reference for the `github` and `handover` skills. The rule in one line: **opening a pull request is
half the act — a session that pushed one owes GitHub's own answer about it a single look.**

## The mechanism

Three acts, each one a visible session doing something:

| Act                                                                | What it does                                              |
| ------------------------------------------------------------------ | --------------------------------------------------------- |
| `slopweaver github stack push`                                     | records the OBLIGATION and prints the exact command below |
| `slopweaver github checks --repo <owner/name> --number <n> --wait` | DISCHARGES it                                             |
| `slopweaver handover finish` / `handover settle`                   | REFUSE on that branch until it is on the record           |

The register is one append-only `ledgers/pr-checks-read.jsonl` under `$SLOPWEAVER_HOME`
(`src/outbound/github/checksReadLedger.ts`); the refusal is `src/cli/commands/handover/checksReadGate.ts`.

## Four properties that are the contract, not details

- **Scoped to the branch the run's own `started` event names.** The register is install-wide and several
  fleet sessions push at once, so an unscoped gate would refuse one session's settle over another session's
  pull request.
- **Only `github checks` discharges.** `enqueue` and `merge --admin` pull a rollup internally, and a rollup
  read buried inside a merge attempt is not a session reading its checks — counting it would re-open the
  exact hole the rule closes.
- **A read is matched to a raise by `(repo, number)` and INSTANT, never by head SHA.** Both rows carry the
  head they saw as evidence, but a session that raises, amends, force-pushes and then reads would never match
  a SHA-keyed raise again. Stated residue: a read of a head an amend has since replaced still discharges,
  because the scope is "read once", not "watched to green".
- **A register that cannot be READ refuses too.** An outage silently answering "nothing outstanding"
  reproduces the failure the gate exists to catch. Only a register that has never been written is empty.

`SLOPWEAVER_ALLOW_UNREAD_CHECKS=1` is the hatch, and it announces itself — say so in the pull request.

## Why it is a gate rather than a habit

One acme-admin pull request sat as a draft with two red checks because the session that pushed it went
straight on to building proof artifacts and never read the pull request's checks once. Nothing watched it,
and the owner was the one who found the reds. The owner and the fleet do not raise pull requests with red checks
and then leave them red.

A local lap would not have caught it. Unit tests and oxlint ran; typecheck never did, and the tests passed
against a field name TypeScript would have refused (TS2561, `longMessage` for `long_message`), because the
predicate under test only reads `code`. CI knew. Nobody asked it.

AGENTS.md rule 2 bans the resident watcher that would otherwise be the obvious answer, so the push leaves a
ROW behind instead of a process.

## Two more row kinds: `watching` and `watch-done`

A `--wait` or `--until` run is a session WATCHING a pull request, and the register is where that fact lives:
the run appends `watching` (its session, mode, head and its own `--timeout-seconds`) on its first read and
`watch-done` (its outcome word) when its loop returns. `slopweaver github watchers [--repo <owner/name>]
[--json]` folds them (`src/outbound/github/watchers.ts`): an open watcher is a `watching` with no later
`watch-done` from the same session, and one older than its own timeout with none is reported STALE — a dead
session is never a watcher. Neither row discharges a raise; only `read` does.

**The reader landed before the writer, on purpose.** The register is read by every session's build on the
machine, and the gate fails closed on a line it cannot parse — so a build that wrote a new kind before main's
reader knew it took every other session's `handover settle` down with it (measured: one `watching` row at line 807 of the shared register). A new kind is always two pull
requests: the tolerant reader first, the writer once it has merged. The writer is `github checks`
itself: a `--wait` or `--until` run appends `watching` beside its first `read` and `watch-done` with the
loop's outcome word — `done`, `stopped`, or `failed (exit n)` — as the session id it runs under, or
`unattended` from a cron or a bare shell. A one-shot read writes neither.
