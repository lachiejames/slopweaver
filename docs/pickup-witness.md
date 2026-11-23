# An unwitnessed pickup is not a failed one

Why `slopweaver` **types** a spawned session's pickup line exactly once, why "nothing witnessed it arriving"
is its own recorded state rather than a failure, why re-typing is the damage rather than the fix — and
why the composer is nevertheless **submitted** a second time, which is a different act.

Read this before acting on a `dispatch-unwitnessed` ask, a `cmux spawn` line that says `UNWITNESSED`, or any
impulse to type a pickup command into a workspace by hand.

## The witness chain, and the hole in it

`src/cmux/witness.ts` asks four sources, in this order, and the order is not cosmetic — the two cheap,
load-immune ones are consulted before the two that read the screen, which throws under load:

1. cmux's own hook stream — `agent.hook.UserPromptSubmit` / `agent.hook.PreToolUse` for that workspace;
2. cmux's own delivery record — `latest_submitted_message`, compared as a truncation-aware PREFIX
   (`src/cmux/sendEvidence.ts`: cmux keeps 240 characters and appends `…`, and a pickup line is far longer);
3. a running turn — the footer's `esc to interrupt` (`cmux/turnBusy.ts`), which on a FRESH seat can only be
   the pickup's own turn. Asked only of a host with a measured busy footer, so never of a Codex seat. MEASURED under cmux 0.65.2: it read on the first screen after the Enter
   that took, 3.7 s before the `UserPromptSubmit` event arrived;
4. the rendered screen.

**A prompt that is QUEUED but not yet consumed can be invisible to all four.** It raises no hook until the
session picks it up, and it shows an idle prompt on the surface.

**And so can a prompt that was TYPED INTO THE COMPOSER AND NEVER SUBMITTED** — the third truth behind the
same observation, and the one that has no queue behind it at all. `sendLine` pastes the text and then presses
Enter; when the Enter does not take, the text survives in the input and the submit does not. Nothing was
submitted, so no hook fires and cmux records no `latest_submitted_message` — both witnesses are honestly
answering "no" about a session holding the whole instruction and waiting for one keystroke. The screen shows
it, and the screen witness still cannot confirm it, because a Claude Code composer hard-wraps a long line
mid-token (`…-measur` / `  ement.md`) — see `src/cmux/witness.ts`, where that is recorded as load-bearing
rather than as a gap to widen.

So "nothing witnessed it arriving" and "it never arrived" are the same observation with THREE truths behind
it: it landed and was not seen, it queued, or it is sitting there unsent.

Measured four times. On the fourth, all three surfaces agreed with a false negative on a workspace whose
worker was already reading its brief.

**The delivery record specifically goes both ways, and a flat claim about it is wrong.** Measured the same
day: on workspace:398 a queued pickup left `latest_submitted_message` EMPTY, while on workspace:410 a queued
send populated it immediately. Reproduce either with `slopweaver cmux send --workspace <ref> "<text>"`
followed by `slopweaver cmux list --json`. So its ABSENCE is never evidence of non-delivery — only its
presence is evidence of delivery, which is exactly the asymmetry the reconciliation below relies on.

## Why a send is never retried

Retrying the SEND looks right — a genuinely dropped paste can only be helped by sending it again — and is
inverted by the actual failure, measured on two live dispatches: **both sends land, neither is witnessed, and the duplicate fires when the child's first turn ends** —
a fresh session re-reading its doc and re-running `handover start` mid-run. One measured child ran its
pickup three times that way.

The asymmetry settles it. Sending again bets on the rare case (a genuinely dropped paste) and pays the cost
of the common one (a second, uninstructed run of the whole packet). Looking longer costs nothing, and saying
plainly that the delivery is unwitnessed costs nothing either. So: **type once, look for twice as long
(`MAX_SEND_VERIFY_POLLS`), then report the doubt.**

Only a send cmux itself REFUSED is a failure. There, nothing landed, and the caller refuses.

## Why the composer is submitted again, and why that is not a retry

"Never send it twice" left the typed-but-unsent state with no remedy at all. In one day that cost two
consecutive acme-admin spawns, three of three Slack dispatches, and a reviewer that sat fourteen
minutes with its full instruction visible at the prompt and cmux carrying no `latestSubmittedAtIso` for it.
Every one of those was rescued by a human pressing Enter.

So `cmux spawn` presses it. Once the first budget is spent it calls `submitComposer` — a bare
`surface.send_key enter`, **no text** — and then watches for `MAX_RESUBMIT_VERIFY_POLLS` more ticks. A submit
is not a send: `sendLine` types and then submits, so calling it twice puts the line in twice, while this
types nothing at all.

Both halves are MEASURED live against Claude Code v2.1.258:

- **The strand reproduces.** `surface.send_text` with its trailing newline and no follow-up Enter left the
  full pickup line at the `❯` composer for the whole observation, with no `latest_submitted_message` at all.
- **One bare Enter submitted it**, and cmux's delivery record named the line 20.0 s later — which is what
  `MAX_RESUBMIT_VERIFY_POLLS` is sized against, with headroom.
- **The same keystroke is a NO-OP on a busy session with an empty composer.** Sent to that workspace once it
  was running its first turn, `latest_submitted_at` did not move across eight reads over 32 s and no second
  turn started.

That last measurement is why the Enter fires unconditionally rather than only when the screen shows a typed
line: the case it must not make worse — a pickup that landed and simply was not seen — costs exactly
nothing, and conditioning on the screen would disarm it in precisely the case that produced the original
false negatives, a surface too loaded to read.

**A slow acme-admin boot is NOT the cause, and the ask that scoped this work proposed it.** Measured the same
day, one boot each, `claude --plugin-dir` from workspace creation to a rendered prompt: an acme-admin worktree
**5.8 s**, acme-admin's main checkout **4.5 s**, a slopweaver worktree **5.4 s**. All three are inside
`MAX_READY_PROMPT_POLLS` (10 ticks) with room to spare, and far inside the 30-tick witness window after it.
So the strand is a keystroke that did not take, not a host the spawn outran. Three samples under one
afternoon's load are not a claim about every load — the point is only that the boot-duration explanation was
checked and did not hold, so the remedy had to be the keystroke.

**And before a spawn returns, it reads the box.** MEASURED: three workspaces returned success and sat about seventy minutes with the pickup typed and unsubmitted, until one hand `cmux submit`
started all three. No witness reads the composer, so `pickupComposerConfirm.ts`'s `confirmPickupLeftComposer` does, on the
styled grid's faint attribute (`cmux/composer.ts`): a `typed` box gets another Enter after each settle
window, and a box still `typed` once `MAX_PICKUP_ENTERS` (`cmux/pickupComposerGate.ts`, four, counting
`sendLine`'s own Enter) are spent REFUSES the spawn with the workspace named. More than one because a booting
seat takes a LATER Enter: two workspaces stayed typed after the blind resubmit and started on
the chair's next one. A box it never saw holding the line and cannot read (`unreadable`, every Codex seat
included) never refuses; one already seen `typed` stays `typed` through a failed read.

**Under cmux 0.65.2 the box is read from the FIRST tick, not after the window.** MEASURED: the
Enter `sendLine` presses one second after its paste failed to submit on 4 of 4 seats, while a bare Enter 2.2 s
or more later submitted every time — so waiting out the whole witness window before pressing again left every
seat idle for that window. `pickupWitnessWindow.ts`'s `pollForPickupWitness` therefore reads the composer on each tick
nothing else answers, and `decidePickupPoll` presses an early Enter once the box reads `typed` and
`pickupEnterSpacing` ticks (2 × Enters spent) have passed since the last one; the box going from `typed` to
anything readable is itself the witness. The blind resubmit fires only when that window pressed nothing.

**An empty box nobody saw submit is not a success either.** A delivery still `unwitnessed` whose composer
READS (`empty`, `suggestion`, `placeholder`) fails the spawn as `pickupSubmissionUnproven` — the seat may be
idle with no pickup — but, unlike a strand, the workspace stays OPEN and its dispatch is recorded, because a
queued pickup is invisible to every witness here and a second send on a guess is the measured duplicate above. A
recorded dispatch is also what stops `handover wake` reseating it (`wakeRows.ts`). Only an `unreadable` box
keeps the old honest `unwitnessed`.

Delivery therefore ends in one of six states: `witnessed`, `resubmitted` (submitted again, then witnessed —
by a chain source or by the box emptying), `unwitnessed`, a send cmux refused, a pickup still typed after its
Enter budget, or a submission unproven over a readable box. Every caller that branches on `unwitnessed` treats
`resubmitted` as the success it is without having to learn about it; the last three are failures, and only the
last leaves the seat open (`spawnFailureKeepsWorkspaceOpen`), for a person to read before anything is sent.

**By hand, the same act is `slopweaver cmux submit --workspace <ref>`** — the door verb for pressing Enter and
nothing else. Reach for it on a session you find holding an unsent line; it can submit what is there and it
cannot invent what is not.

## `dispatch-unwitnessed` — the state, and the three things it deliberately does not do

For a Slack ask, an unwitnessed delivery is recorded as `dispatch-unwitnessed`
(`src/live/ask/lifecycle.ts`), never `dispatch-failed`. Measured on one ask, calling it `dispatch-failed` instead cost 30+ minutes of public silence
on a thread whose worker was working the whole time, and each cost is a property:

| It does not…               | Because, measured                                                                                                                                                                                                                                                             |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **end the dispatch**       | `activeDispatch` survives, so `turn dispatch --sweep` goes on tracking the worker. Under `dispatch-failed` the sweep read `0 ready / 0 working / 0 worker-failed / 0 phantom` over a live worker — if it had died, stalled or run past its lease, nothing would have said so. |
| **release the burst slot** | The asker's own follow-up in the same thread was admitted `proceed` with no `queued` row, so a SECOND worker started on the same thread and composed "the first attempt never got going, nothing ran" — false, and caught only by the reviewer.                               |
| **post anything**          | It put a public `:warning:` on the asker's message while the answer was being written. A false alarm over a session that is working is worse than silence; the worker's own first progress update is what confirms life.                                                      |

It is still an ordinary swept dispatch in every other way: it reports as `still working`, its lease still
expires, and a workspace holding no session is still caught as `phantom` — which is what turns it into a real
`dispatch-failed`.

**Reconciliation.** `turn dispatch --sweep` re-asks cmux's delivery record on each pass and appends
`dispatch-witnessed` when it corroborates the pickup, printing `dispatch-witnessed (reconciled): …`. The
expected pickup line is rebuilt from the ask's own dispatch id rather than stored, so every dispatch record
reconciles alike. A missing confirmation is never read as a negative one — that inference is what produced
`dispatch-failed` in the first place.

## The REVIEWER's pickup, and the one keystroke that is not a re-send

Everything above is about a WORKER's pickup. A reviewer's needs its own watch: with `working` as the default
arm whenever no verdict file is on disk, a reviewer never handed its instruction reports identically to one
mid-verdict.

**Measured** on one ask: its reviewer sat **fourteen minutes**
with its full pickup line typed into its input box and never submitted — cmux listed neither
`latest_submitted_message` nor `latest_submitted_at` for it, no `verdict.json` was ever written, and every
poll answered `reviewer still working — no verdict yet`. Only the ~20-minute give-up bound in the worker's
own poll loop surfaced it. On the same day, `turn dispatch --sweep` settled all three stranded WORKER pickups
against exactly the delivery record nobody was asking about for the reviewer.

Three mechanisms, the first two only reporting:

- **`turn review --poll` asks cmux's delivery record**, the same witness the dispatch leg has, and never
  folds its absence into `working` (`src/live/turn/reviewDelivery.ts`). It says so only after
  `REVIEWER_UNSUBMITTED_AFTER_MS`, so a reviewer that merely booted a moment ago is never accused.
- **`turn dispatch --sweep` runs the same check for every still-working ask** and prints
  `reviewer-delivery-unwitnessed: …`. Its bound is what keeps a healthy reviewer out of the line.
- **The sweep may press ENTER on a pickup that is typed and unsent — and nothing else.**

That last one is not a re-send, and the distinction is the whole reason it is allowed.
Re-SENDING pastes a second copy of the text, which is what fired an uninstructed second run in the measured duplicate. This
presses Enter on the copy **already in the box**, so no second copy can exist. It requires all three of: no
delivery record at all, a screen showing neither a running turn nor a queued message (`src/cmux/turnBusy.ts`),
and the pickup text visible on that screen. Miss any one — an unreadable screen included — and it HOLDS and
merely reports, because an Enter into a session mid-turn submits whatever else is in its input.

## The same absence, read as a certainty

Absence of a delivery record is not evidence of non-delivery, on the review leg as on the WORKER's (§
Reconciliation). Once, `turn review --poll` read one as a negative, reported a round-2 reviewer
`NEVER STARTED` and prescribed `turn dispatch --sweep` while `cmux read-screen` showed workspace:295 running a
turn at 5m22s — advice that, followed, presses Enter into a session doing the work. The other direction failed
too: the sweep's terminal path reaped three mid-verdict reviewers on the parent's lease clock, which is
why `lease-held` makes "a reviewer is mid-verdict" a first-class answer.

The class is **a verb judging a reviewer by a proxy rather than by whether it is mid-verdict**, and the answer
is one classifier both legs route on — `reviewerStrandedness`, in the same module as the witness:

- **mid-turn** → the reviewer is WORKING. `--poll` says `still working` and carries the reconciliation in its
  own line, the way the dispatch leg prints `dispatch-witnessed (reconciled)`.
- **typed-unsent** → provable, and the only arm anything acts on.
- **undetermined** → a DOUBT. `--poll` prints `reviewer delivery UNWITNESSED` and the remedy is to LOOK:
  `slopweaver cmux read-screen --workspace <ref>` before re-submitting.

The busy check runs **before** the composer-containment check, and that ordering is the whole answer: a
session mid-turn renders its own pickup in its transcript, so containment alone cannot tell a working
reviewer from a stranded one.

**And a host whose busy footer has never been measured here is `undetermined` by construction.**
`src/cmux/turnBusy.ts` has a pattern for `claude-code` and none for `codex`, so `screenShowsRunningTurn`
answers `false` for a codex reviewer that is hard at work — and a reviewer inherits its WORKER's host. Taking
that `false` for "idle" is the same proxy defect one host over, and the act it would license is an Enter into
somebody else's input. `runningTurnIsAssertable` is the gate.

### The third instance, and the one that actually cost a turn

The class is not confined to `turn review --poll`. **`slopweaver session close-done` reaped a reviewer that
was legitimately mid-verdict, on the PARENT ask's lease clock**, and its proxy was worse than a busy footer:
a fold state with no instant on it at all.

MEASURED on ask `C0SYN000006/1789347793.808099`. The worker's dispatch lease lapsed, and review
round 2 opened on `workspace:228` **thirty-two minutes LATER** and wrote no `verdict.json`. A `close-done` run
from an **unrelated seat** reaped `workspace:228` and `workspace:219` within the next twenty minutes, both
reported as `parent lease expired`. The turn sat ready-and-unposted
with no verdict path at all until the loop noticed and the worker re-opened round 3 on `workspace:231`. A
recorded `lease-expired` older than the reviewer it is used to judge is not an imprecise proxy; it is
answering about a different object.

`src/live/turn/leaseJudgement.ts`'s `leaseState` answers `held` while a reviewer is mid-verdict, "and its
time is not the worker's to pay for", and `dispatch.ts`'s sweep routes on it. `closeDone.ts` read the same
lease with `isLeaseExpired` directly and never read the review at all — so two verbs judged one state, and
only the one with the wrong rule could close a workspace.

Three rules, and their shape is the lesson:

- **`src/live/turn/reviewPosture.ts` is the ONE reader.** `reviewPostureOf` lives outside the sweep's own
  command module, because a duplicated reader is exactly how two halves of a seam drift apart.
- **An open review holds the reaper**, bounded by the same `MAX_REVIEW_HOLD_HOURS` cap the clock uses. One
  number, three callers; a wedged reviewer still cannot pin its workspace open forever.
- **Two neighbours deliberately still reap.** A TERMINAL ask releases its reviewer ungated on liveness
  (`reviewRelease.ts`'s standing ruling — the ask is over either way), and `parent-worker-gone` is a direct
  fact about the verdict's CONSUMER rather than a clock proxy.

The witness is the SHIPPED verb, not the judgement in isolation:
`src/__tests__/subprocess/cli/sessionCloseDoneMidVerdict.test.ts` spawns `bin/slopweaver session close-done`
against a fake cmux control socket over a home carrying this incident's shape, and asserts the reviewer is
held. Its falsifiable half is the same home with the review record as the only thing removed, which reaps —
so a verb that had simply failed to find the row would redden rather than pass. The offsets are the
incident's (lease lapsed 52 minutes ago, reviewer opened 32 minutes after that) hung off the wall clock,
because `close-done` takes no `--now`; frozen instants would put the reviewer outside the hold and prove the
opposite.

Checked as a class rather than a case: every non-test caller of `isLeaseExpired` was read, and `close-done`
was the only reaper left on the proxy. `tier.ts` refuses to LAUNCH on an expired lease and closes nothing.

**One instance of the class is still OPEN, and naming it is the point of saying so.** `close-done`'s last
gate before a close is `judgeScreen`, which calls `screenShowsRunningTurn` — so the codex-host hole two
paragraphs up applies to it verbatim: a codex-hosted reviewer hard at work reads `idle` to the reaper, and
the act that licenses is a workspace CLOSE rather than an Enter. `runningTurnIsAssertable` is the gate that
would close it. `CmuxWorkspaceSummary` (`src/cmux/client.ts`) carries no host field, so the workspace
inventory cannot answer it — but the review RECORD can: `reviewer.host` is a `"claude-code" | "codex"` on
every record `reviewPaths(...).record` holds, and `close-done` reads that file per child anyway. The row
is `close-done-cannot-assert-a-codex-reviewers-screen-is-idle`, and that record field is where it starts.

## What to do when you see one

- **Wait and re-read.** The queued prompt surfaces the moment the session starts consuming it — `read-screen`
  then shows `Press up to edit queued messages`.
- **Never send another copy**, by hand or by verb. If you already have, message the session by name through
  `SendMessage` and tell it to skip the extras; that is cheaper than letting it re-run a pickup.
- **If the line is sitting at the prompt unsent, submit it** — `slopweaver cmux submit --workspace <ref>`,
  never `cmux send`, which would type a second copy above the one already there. A spawn has already done
  this once by the time it prints `UNWITNESSED`, so a second press is only worth it if the state persists.
  For a REVIEWER's workspace you should not need to: `turn dispatch --sweep` presses it for you, under the
  three conditions the section above names.
- **Do not treat it as dead.** `phantom` and `lease-expired` are the findings that end it, and both are
  checked rather than inferred.
