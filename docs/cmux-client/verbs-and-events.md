# 3. The verb surface

Part of [The cmux client, the verbs over it, and the event model](../cmux-client.md).

Every one exists so that no session runs the `cmux` binary itself. Raw `cmux` is blocked by the admit guard by
default, with the same `SLOPWEAVER_ALLOW_RAW=1` break-glass every other raw tool has.

`cmux send`, `cmux stop`, `cmux list` and `cmux close` reach the socket through
[the session harness](../session-harness.md) rather than holding a cmux client themselves; their output and
exit codes are unchanged. The rest still hold one, until every caller goes through the seam.

| Verb                                                                                                           | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Transport                                                     |
| -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `slopweaver cmux spawn <slug> [--full]`                                                                        | Open a worktree + workspace, route it onto a plan by live gauge, boot the host, verify it, send the pickup command; a `claude` boot is judged at its composer, on SessionStart or the banner only when no grid will read, and a failed one is closed and booted once more in a fresh tab ([§ 5](spawn-witness-chain.md)). Prints one receipt line; `--full` adds the worktree and boot-and-pickup detail, which a resubmitted or unwitnessed pickup always prints                                                                                                                                                                                                                                                                                                                                                                 | socket                                                        |
| `slopweaver cmux close <workspace>`                                                                            | Close a workspace (resolving its ref to an id first); on cmux 0.65.2's running-process `confirmation_required`, re-read its screen and force once only if idle, else hold it open and exit 1                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | socket                                                        |
| `slopweaver cmux usage --harness app [--home <dir>] [--json]`                                                  | App-hosted sessions only: each session's model asked against the one that ran, its tokens counted at each turn's end in the vendor's own categories, and each plan summed; a missing or main-loop-only turn makes the total a floor ([usage](../session-harness.md#reading-an-app-sessions-usage))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | app socket                                                    |
| `slopweaver cmux list [--full] [--json]`                                                                       | Every workspace in every window, with ids as well as refs, `pinned`/`selected` included; a text row is ref, id and title, and `--full` adds the directory                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | socket                                                        |
| `slopweaver cmux read-screen --workspace <w> [--surface <s>] [--scrollback <n>]`                               | The surface's live text, plus a verdict on WHO put the prompt box's contents there ([§ 5a](spawn-witness-chain.md#5a-who-put-that-line-in-the-prompt-box))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | socket                                                        |
| `slopweaver cmux send --workspace <w> [--interrupt] "<text>"`                                                  | Type one line into a surface and submit it, reporting `submitted` / `QUEUED behind a running turn` / `resubmitted` / `STRANDED` — it reads the composer back and presses one bare Enter on a line that never left it ([§ 5b](spawn-witness-chain.md#5b-the-same-rescue-on-the-send-path-and-the-fleet-sweep-that-finds-what-it-missed)); `--interrupt` stops the turn first                                                                                                                                                                                                                                                                                                                                                                                                                                                       | socket                                                        |
| `slopweaver cmux submit --workspace <w> [--surface <s>] [--force]`                                             | Press Enter on the composer and nothing else — REFUSES when the box holds a suggestion Claude Code wrote itself ([§ 5a](spawn-witness-chain.md#5a-who-put-that-line-in-the-prompt-box)); `--force` presses anyway                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | socket                                                        |
| `slopweaver cmux strands [--json] [--submit]`                                                                  | Every composer in the fleet holding an unsubmitted line, WITH the denominator; `--submit` presses each one through. Skips the pinned supervisor ([§ 5b](spawn-witness-chain.md#5b-the-same-rescue-on-the-send-path-and-the-fleet-sweep-that-finds-what-it-missed))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | socket                                                        |
| `slopweaver cmux stop <w> [--surface <s>] [--why <text>]`                                                      | Stop what a peer seat is doing and say why, WITHOUT waiting for the interrupt to land — the lever behind `slopweaver perf`’s REACT line; refuses the pinned supervisor                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | socket                                                        |
| `slopweaver cmux processes --workspace <w>`                                                                    | The OS process tree under a workspace                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | socket                                                        |
| `slopweaver cmux reseat <w>\|--all [--dry-run] [--force] [--model <m>]`                                        | Stop a seat's `claude` and relaunch the SAME session in place with `--resume` on a routed plan, the chair included — or, with no transcript or a resume printing `No conversation found` whose tab returns to a bare prompt, boot it fresh ONCE and report `fresh-seated`, else refuse `RELAUNCH_FAILED` (no prompt came back) or `UNCONFIRMED` (the fresh one never confirmed) (a bare shell whose saved id has no transcript is refused `NO_RESUMABLE_SESSION`, a tab another live reseat holds `RESEAT_CONTENDED`, and one picked for a wall gone under its lock `WALL_CLEARED`, untouched); `--all` takes every walled seat, and every seat booted on no plan, chair first ([reaching-a-session](../../skills/supervisor/reference/reaching-a-session.md#resuming-a-session-that-is-stuck-or-running-the-wrong---plugin-dir)) | socket + `kill` + the registry                                |
| `slopweaver cmux revive [--bound-seconds <n>] [--dry-run] [--json]`                                            | From OUTSIDE cmux only: knock on the socket, read a reply by the seats' own last calls, and once cmux has been hung for the bound while the app lives, quit and reopen the app — the desktop app's, every minute ([fleet](../../skills/fleet/SKILL.md#a-hung-cmux-is-restarted-never-the-owners-hand))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | socket knock + inside-call stamps + `ps` + `kill` + `open -a` |
| `slopweaver cmux events [--since <seq>] [--follow] [--name …] [--category …] [--workspace <id>] [--limit <n>]` | The hook stream, drained or followed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | socket                                                        |
| `slopweaver cmux title "<text>" [--workspace <w>]`                                                             | Set the title a workspace's sidebar row shows                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | socket (`workspace.action`)                                   |
| `slopweaver cmux pin [--workspace <w>]`                                                                        | Pin a workspace — refuses while a DIFFERENT one is already pinned                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | socket (`workspace.action`)                                   |
| `slopweaver cmux unpin [--workspace <w>]`                                                                      | Unpin a workspace — idempotent                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | socket (`workspace.action`)                                   |
| `slopweaver cmux takeover [--dry-run] [--home <h>]`                                                            | The whole "Taking over the pin" sequence below, as one verb — gated, ordered, refuses loudly, no `--force`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | socket + a live event drain + this session's own transcript   |
| `slopweaver session watch [--follow] [--since <seq>] [--idle-minutes <n>] [--include-stale]`                   | Events folded into per-session signals                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | socket                                                        |
| `slopweaver session close-done [--dry-run] [--json]`                                                           | Close every spawned workspace whose run finished / ask settled / doc terminal, plus every ask worker or answer reviewer whose bot turn ENDED, each on an idle screen, and every finished `fleet resume` tab on a bare shell, forcing past cmux's running-process confirmation only after that proof; close drifted ledger rows                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | socket                                                        |

`--workspace` accepts a `workspace:N` ref OR a UUID everywhere it appears, and every verb resolves it to an id
before addressing anything ([§ 2a](socket-and-measured-facts.md#a-a-ref-that-names-nothing-does-not-fail--it-addresses-the-focused-surface)).

## Taking over the pin — the exact order, and why each step is where it is

A successor supervisor replacing a predecessor workspace (`skills/supervisor/SKILL.md`'s "Successor handoff")
finishes the handoff itself, in this order — as ONE verb, `slopweaver cmux takeover`, because successors
doing it by hand skipped step 5 twice (`ws:402`; `ws:459` leaving `ws:432` open) and step 6
every time:

1. **Verify you are actually sweeping first** — the skill's § 7 `ScheduleWakeup` has been CALLED at least once
   on this session. Read from one of two witnesses, never assumed from the caller's own say-so: this
   workspace's own hook events (an `agent.hook.PreToolUse` naming `ScheduleWakeup`, the stronger witness, read
   first), else this session's own transcript (`~/.claude/projects/<dir>/$CLAUDE_CODE_SESSION_ID.jsonl`, a
   non-sidechain assistant `tool_use` named `ScheduleWakeup` at or after the session's first timestamp — a
   harness-persisted record of the assistant EMITTING the call, weaker than the hook, accepted because Claude
   Code 2.1.296 runs no PreToolUse hook for `ScheduleWakeup` at all; MEASURED on a live workspace).
   The hook drain never starts from `seq 0` — on any busy machine that cursor has aged out and every negative
   read as an inconclusive gap. It first reads a live-edge ack for `oldest_seq`, then drains from just before
   it, so a negative is a negative over cmux's retained window, printed with its oldest seq and earliest
   replayed instant. No hook frame can say where this session began (cmux strips `SessionStart.source`, and
   resume and compaction re-boot the same session id), so the transcript remains what covers an older session.
   The step line and the refusal name which witness decided. Never from elapsed time either: every real
   takeover on record armed the sweep and took over the pin in the SAME first turn, minutes before the
   wakeup's own 1200s interval could have elapsed, so "fired" means the tool was called, not that a re-entry
   has already happened. Do not take the pin from a predecessor that might still be the one actually watching
   the fleet.
2. Resolve the predecessor's workspace ref from the `pinned: true` row in `slopweaver cmux list --json` —
   refusing if none is pinned, more than one is, or the one pinned workspace is this session's own.
3. Confirm the predecessor's own run has actually finished: resolve the handover slug the session ledger
   recorded when the predecessor was spawned (`cmux spawn <slug>` — a predecessor supervisor is itself booted
   from a one-time `fresh-supervisor-handoff-N` doc), and require that slug's run journal to carry a
   terminal event — `finished`/`abandoned`, which a chair that stepped down records, a row `closed`, or the
   reaper's `orphaned` once its session was proven dead. The ledger row is PAIRED to
   the live pinned workspace (`pairRowsToWorkspaces`: ref and worktree, then worktree alone), never matched on
   its recorded ref, because cmux renumbers every ref on an app restart and a ref-only lookup refused every
   successor after one. The pair must then hold on the whole canonical path, and the worktree must name one
   seat: a second live workspace in it, a second open row there of any slug, or a sibling row step 5's close
   would also reach is refused. This pairing keys on the worktree because a predecessor's row may predate the
   `workspaceId` a `cmux spawn` row now records (`handover reconcile`'s `seatRowOf` reads that id), and a row
   written by anything else never carries one, so the worktree is the identity every row keeps across a
   restart. A predecessor with no such slug on record cannot be confirmed this way, and this
   refuses rather than guessing.
4. `slopweaver cmux unpin --workspace <predecessor-ref>` then `slopweaver cmux pin` (no `--workspace`, so it
   pins THIS session's own workspace, `CMUX_WORKSPACE_ID`, never the focused tab) and
   `slopweaver cmux title "/slopweaver:supervisor"` — `cmux pin` refuses while a DIFFERENT workspace is still
   pinned ([§ 2(e)](socket-and-measured-facts.md#e-cmux-enforces-no-single-pin-invariant--a-caller-wanting-one-must-check-itself)), so the predecessor comes down before you go up.
5. `slopweaver cmux close <predecessor-ref>`, then the ledger row step 3 paired is closed under its OWN recorded
   ref and its `spawnedIso`, never the live ref a restart may have renumbered, nor a sibling row a re-issued ref
   also sits on — cmux refuses to close a still-pinned workspace ("Pinned workspaces can't be closed while pinned. Unpin the workspace
   first"), and step 4 already cleared that. Since cmux 0.65.2 an unforced close of a workspace with ANY live
   process answers `confirmation_required`, which stopped every takeover here (chairs 368 and 369),
   so the close forces once the screen reads idle, or once its only background shell is a `claude watch`
   keep-alive another watch covers (`src/cli/commands/cmux/takeoverClose.ts`); a seat still holding the only
   keep-alive is NOT closed, its ledger row stays open, and `session close-done` retries it.
6. Record the predecessor's BOARD ROW closed — a `closed` row event on the slug step 3 resolved, witnessing
   the pin that replaced it, which is what `slopweaver handover close <slug>` writes by hand. Closing the
   WORKSPACE is not the whole ending: `handover settle` refuses a DOC row outright, so an unclosed chair's doc
   stays `status: ready` in `RUN NOW` — **177 of them on the live board, measured** — and a fill read one as
   available work and spawned a SECOND supervisor chair (on Opus into
   `workspace:150`, closed by the real chair 45 seconds later). `src/handover/supervisorSupersession.ts` carries the measurement and the repro. This step
   runs AFTER the destructive triad and can never fail the takeover: a refused row write prints the one
   `handover close` line that repairs it and still exits 0, because a non-zero exit would invite a re-run of a
   verb whose own gates now read a world that has already moved.

`slopweaver cmux takeover --dry-run` runs steps 1-3 and reports what steps 4-6 would do, without touching
anything — the check to run before trusting the real one.

Taking the pin is not licence to also take over the predecessor's in-flight investigation: read
`skills/supervisor/SKILL.md` § 3b before doing anything past this handoff — the successor delegates exactly as
the predecessor should have, and a fresh workspace with no accumulated context is if anything more tempted to
run one "quick check" itself rather than spawn a session for it.

## 4. The event model

A subscription is `events.stream` on its OWN connection: cmux answers it with one ack frame and then keeps the
connection open, pushing a frame per hook firing. Measured — five ordinary calls written down the same
connection after subscribing produced no replies at all, which is why `eventStream.ts` never shares
`socket.ts`'s multiplexed connection.

```json
{"type":"ack","protocol":"cmux-events","version":1,"subscription_id":"…","replay_count":84,
 "filters":{"categories":[],"names":[]},"heartbeat_interval_seconds":15,
 "resume":{"after_seq":78100,"oldest_seq":78080,"latest_seq":82175,"next_seq":82176,"gap":false}}
{"type":"event","seq":78163,"id":"<boot>-78163","name":"agent.hook.Stop","category":"agent",
 "occurred_at":"2001-01-01T00:00:00.000Z","workspace_id":"8D47…","surface_id":null,
 "payload":{"_source":"claude","cwd":"…","session_id":"claude-…","phase":"received","hook_event_name":"Stop"}}
```

Three fields carry the whole supervision story, and each is worth naming so it is not rediscovered:

- **`workspace_id` IS present at the top level** of an agent-hook frame. An event maps to a session without a
  cwd cross-reference.
- **`phase` is `received` then `completed` for the SAME firing.** A naive count double-counts every tool call.
  `applyEvent` folds only `received`.
- **`resume.gap`** is the honest signal that a cursor fell off cmux's retained buffer (4,096 frames in memory,
  the rest in `~/.cmuxterm/events.jsonl`). Both `cmux events` and `session watch` report it loudly rather than
  silently reporting a partial picture as a complete one.

Each verb's cursor is its OWN row of the local store's `cmux_event_state` (`src/cmux/eventState/`). A restarted
supervisor RESUMES from it — subscribing at the live edge instead would look identical and silently skip
everything that happened while it was down. `session watch`'s row holds its fold beside its cursor, written by
one compare-and-set, so a crash can never leave one ahead of the other; `cmux events` has a cursor-only row of
its own. The two once shared `$SLOPWEAVER_HOME/cmux-event-cursor.json`, and every `cmux events` drain advanced
`session watch`'s cursor past events it never folded. The first read on a home with no row imports the retired
files once — the pair together for `session watch`, refusing either file alone, resuming after the fold's own
highest `lastSeq` rather than the shared cursor the old `cmux events` may have pushed past it — and never reads
them again. A
store that cannot be reached is a refusal, never a file fallback. A losing concurrent `session watch` exits
non-zero on `CMUX_EVENT_REVISION_CONFLICT` and nothing retries; a fold that will not decode is refused, and
`session watch --reset-state --since <seq>` starts a fresh one. `--since` on its own only resumes a fold standing
at that sequence, or starts one when none is stored.

**It advances only past events a drain actually HANDLED, never to the ack's `latest_seq`.** MEASURED: a cursor
taken from the ack lets a `--limit 3` drain that printed events around seq 102,690 record 104,498 — the live
edge — so the next drain starts past ~1,800 events nobody saw. A cursor that outruns the work it is a cursor
for is worse than no cursor, because the skip is silent.

**cmux can hang up cleanly in the middle of a replay, and a plain `session watch` resumes past it.** MEASURED
on cmux 0.65.2: a subscription resuming from a stored cursor is acked with its `replay_count`, then
sometimes closed with no error partway through — 267 events of a ~1,400-event replay reached the verb. The
drain (`src/cmux/resumingDrain.ts`) re-subscribes strictly after the highest seq it folded, never `latest`,
until a quiet window says it is caught up; a round that brings nothing, or its round cap, ends it with a
TRUNCATED diagnostic in the report, carried like `gap`. Either way a plain drain prints its report or exits
non-zero with the socket's reason — never an empty exit 0. `--follow` does not reconnect; a hang-up reports
what was pending, then ends.

## `session watch` — the supervisor's second prong

`sessionActivity.ts` folds events into per-workspace state (turn started/ended, attention raised, tool churn,
cwd) and classifies each into one of four signals:

| Signal        | Means                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------- |
| `needs-input` | A `Notification` or `AskUserQuestion` is outstanding and nothing has moved since            |
| `working`     | Something happened inside the quiet window                                                  |
| `idle`        | Finished a turn and has been quiet since — the opportunity cost the owner asked to minimise |
| `silent`      | Quiet **without** ever finishing a turn — the shape a dead or wedged session takes          |

`idle` and `silent` are deliberately different answers, and the difference is the whole point of the pair.

**This does not replace the 20-minute sweep**, by the owner's explicit ruling: a multi-pronged approach mixing these
tools is best, because a screen scrape gets a lot but misses a lot, so the 20-minute sweep stays. It answers the
half a screen read is worst at (did something change, is anyone waiting) and says nothing about the half the
sweep still owns.

**The fold is durable, so the report is windowed.** The `session-watch` row persists the fold across processes,
which is what makes an unanswered attention survive a restart — and also means the fold accumulates every
workspace that has ever emitted an event, since nothing removes one cmux has closed and a dead workspace's
`attentionSinceIso` can never be cleared. So the REPORT filters what the FOLD keeps: every `mapped` row, plus
any unmapped row quiet under `STALE_UNMAPPED_AFTER_MS` (one hour, `src/sessions/watchReport.ts`), with the
rest collapsed into one counted line. `--include-stale` reports the fold unfiltered. Two guards ride with it:
a `mapped` row is never collapsed however quiet, and nothing is collapsed when `inventory()` FAILED — it
returns `[]` on failure, which marks every row unmapped. MEASURED, the read that forced this: 411
rows, 385 unmapped, none of them live, and the first live row at rank 163.
