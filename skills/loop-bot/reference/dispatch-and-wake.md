# `fresh-visible-session` — who reconciles a dispatch once it is sent

`turn dispatch` returns as soon as the workspace boots. Two things then carry the ask to its end, on either
host, and neither is a daemon (rule 2): **the worker posts its own answer** from inside its workspace, and
**the supervisor's tick runs the same `turn dispatch --sweep`** every pass — its `turn sweep:` digest lines,
whose whole capture is `turn-dispatch-sweep.txt` ([sweep-contract.md](../../supervisor/reference/sweep-contract.md)).
The rule — never stall silently, and never resend a pickup line — is in [SKILL.md](../SKILL.md).

So a Codex turn, which has no wakeup tool, may dispatch and end. While no supervisor runs, a worker that died
after pickup waits for the next one's tick — by design, exactly as a tag with no session running is a no-op.
**A Claude Code turn may also wake itself to
reconcile sooner** — the same self-pacing mechanism `/loop` uses — so you (the identical, still-watchable
session) resume later and check:

1. Call your wakeup-scheduling tool with a bounded delay (10–15 minutes is reasonable; the lease is
   `DEFAULT_LEASE_HOURS` — currently 2 hours — so there is no value polling faster than that resolves) and a
   prompt telling your resumed self exactly what to do: run `turn dispatch --sweep`, act on what it reports,
   and reschedule if still working.
2. On wake — or on reading a `turn sweep:` line in the tick, which carries the same lines — run:
   ```bash
   "${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" turn dispatch --sweep --home <home>
   ```
   This reads the durable ask-lifecycle log directly — it needs no dispatch id carried forward from before,
   so a wakeup that lost its own memory of the exact id still recovers correctly.
3. **`ready: <channel>/<messageTs> — <answerPath>`** — the worker validated its answer and is between its
   review and its own send: **the worker posts itself** (`turn review --dispatch`, then
   `turn answer --dispatch <id> --verdict <path>`, from inside its workspace), so this is normally momentary
   and the next sweep finds the ask `answered` — or `first-answered`, when the worker posted a plan declaring
   `followThrough` and is still building: that ask keeps its dispatch and reads `still working` until the
   final answer lands ([raising-a-pr.md](raising-a-pr.md)). A trailing `(ready and unposted for Nm)` means it stalled
   there — a reviewer that never returned, most likely. Look at its workspace; if a verdict is already on
   disk you may carry the answer with `turn answer --dispatch <id> --verdict <path>`, otherwise surface it
   per rule 6. Never post an unreviewed one. This is the SAME contract `/slopweaver:loop` runs — nothing here
   is bespoke to a single turn.
   **A send the admit door refused on warn-tier findings alone leaves the ask exactly here.** That refusal is
   not an ending: it posts nothing, finalises nothing and keeps the dispatch record, so the worker is still
   holding the answer and correcting it ([posting.md](posting.md)). Read a `(ready and unposted for Nm)` on
   such an ask as a worker mid-correction before you read it as a stall. **Past its lease a `ready` stands
   only while something can still post it**: a clean verdict, a review open inside its hold, or a worker cmux
   reports alive, for at most the two-hour review-hold cap past the lease. With none of those it is swept `lease-expired` like any other turn (measured:
   a paused turn's `ready` otherwise held its dispatch, and `session respawn loop`, indefinitely).
   **A `ready:` line is never printed for an ask the owner permanently ignored**, so one you see is always a real
   invitation. `turn ignore` appends no terminal event, so the sweep asks both ignore registries before it judges
   anything (measured: unasked, one such ask read `ready` every ten minutes for six days) and writes
   **`ignored (not swept): <channel>/<messageTs> — … ; lift it with <the remove command>`** instead, counted
   as `N ignored` in the closing line. **That line is not a finding and needs nothing from you** — do not
   carry its answer, do not re-judge it, do not post to its thread. It names the lift command for the one
   case it is wrong in, and it keeps naming the ask because a worker still holding one is not reaped:
   its workspace is yours to close by hand.
   **`worker-failed (finalised, stranded — one re-dispatch pending): …`** — the worker reported it could not answer; the sweep
   has already finalised the card with its reason and drained the burst queue. Nothing to redo.
4. **`still working`** (no `ready:`/`phantom:`/`lease-expired:` line for this ask) — reschedule another
   wakeup. Do not loop faster than the interval above, and do not exceed the lease window in total: past it,
   the sweep itself will report `lease-expired` on its own. This line means the workspace was CHECKED and
   holds a live session, not merely that no completion marker rendered — see step 5.
5. **`phantom (nothing running, re-dispatch candidate): <channel>/<messageTs> — <reason>`** — the workspace
   this dispatch recorded holds no session at all: cmux does not list it, or it holds nothing but an idle
   shell. Nothing ran, so nothing had a side effect and re-dispatching is safe. The sweep has already
   recorded `dispatch-failed` and corrected the card. Re-judge the ask, or surface it per rule 6 — do not
   reschedule a wakeup for a dispatch that does not exist. **Do not go looking for the session by directory:
   an ask session boots into the DISPATCHER'S OWN CHECKOUT, so there is no per-ask worktree and no run
   journal to find. The record's workspace id is the oracle, and the sweep already read it.**
   **A `phantom` line ending `after its first answer <ts>` is not "nothing ran"**: the plan was posted, so the
   sweep records `failed`, the card says the plan above stands, and the ask is stranded for ONE re-dispatch by
   the next recovery pass — you do not re-dispatch it by hand.
   A `still working` line for an ask the log records as `dispatch-unwitnessed` is the SAME instruction: the
   pickup was sent, a session is in the workspace, and nothing witnessed the line arriving. Keep waiting.
   **Never resend the pickup command** — the send landed, and a second copy runs the whole packet again when
   the worker's first turn ends. A `dispatch-witnessed (reconciled)` line later is the sweep closing that
   doubt, and needs nothing from you.
6. **`lease-expired (re-judgement candidate): <channel>/<messageTs>`** — the fresh session did not finish in
   time. Do not keep rescheduling. Per rule 6 (never stall silently), surface this to the owner directly — a
   short message in the thread stating the investigation timed out and needs a fresh look — rather than
   letting the ask sit lease-expired with nothing further ever looking at it again.

Rescheduling yourself, or the supervisor's tick reading the sweep, and never spawning anything new, is what
keeps this inside rule 2's visible-session invariant: the owner can watch and interrupt every session that
reconciles the fresh workspace, the whole way through to the answer landing.

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" turn answer --brief <the brief path> --decision <your decision file> --answer <answer.json>
```

`turn answer` has no `--dry-run` — it sends on the one call. Re-read the JSON file you wrote before running
it: the schema refuses a malformed or dishonestly-grounded answer outright rather than previewing it, so
getting the file right BEFORE the call is the only read-back this step gets.

**Sweep once at the start of this turn too** — `slopweaver turn dispatch --sweep`. This turn's own
`fresh-visible-session` dispatch (if it judges one) is reconciled by the worker, the tick and any wakeup above;
this extra sweep is what catches anything left over from a DIFFERENT, older turn sooner than the next tick
would. `--sweep` never relaunches anything on its own; act on a
`ready:`/`phantom:`/`lease-expired:` line the same way steps 3-6 above do.

**Voice:**

- One answer per turn. Never split it across messages, and never follow it with a second message carrying
  a picture — images ride in the same answer via `images`. The one sanctioned exception is a plan then the
  final answer, declared by `followThrough` on the plan's form; `turn answer` refuses a second plan.
- **When the proof is a picture, attach the picture.** A claim resting on a curve's shape, a dashboard's
  state, a board or a diff gets a screenshot in `images` by default, not a link the reader must leave Slack
  to open. A one-line factual answer needs none. **Never point a browser at Slack, GitHub, Linear or Notion** — those go through the door (rule 3). See
  [visual-evidence.md](visual-evidence.md).
- Concise. Lead with the outcome; the evidence trail goes below it, behind the fold.
- **No trailing question.** State the next step as a suggestion, declaratively. "Probably worth checking
  what went out last release" — not "want me to check the last release?". If they want it they will
  re-tag.
- **Never `--as me`.** The owner's voice is a different lane with a different token, and simulating it is
  the failure that lane exists to prevent.
