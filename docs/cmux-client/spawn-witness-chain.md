# 5. Spawn's witness chain

Part of [The cmux client, the verbs over it, and the event model](../cmux-client.md).

A screen read alone, as the witness for both "did it boot" and "did the pickup land", fails in two opposite
directions, measured three times:

- **False positive**: the banner rendered, so the poll called it booted, while stdin was not yet
  accepting a paste — the pickup command was silently dropped.
- **False negative** (twice): under concurrent cmux load every tick answered
  `Failed to read terminal text`, so a dispatch that genuinely landed was reported `dispatch-failed` with the
  whole poll budget spent on an unreadable surface.

Both are answered by asking something other than the rendering. The chains are **different for the two
questions**, and that is load-bearing:

**Pickup** — `witness.ts`'s `firstWitness`, in order:

1. `agent.hook.UserPromptSubmit` / `PreToolUse` on the stream, scoped to this workspace.
2. cmux's own `latest_submitted_message` — its account of what it delivered, not a re-render caught
   mid-flicker. The comparison itself is `sendEvidence.ts`'s, which owns the measurement: cmux truncates the field to **240 characters** with a trailing `…`, so it is compared as a
   **prefix**, and an observation shorter than 40 characters is only accepted as an exact whole-text match so
   a two-character record cannot corroborate everything. An equality check would silently never have matched a
   real pickup command, which is ~554 characters.
3. A running turn — `esc to interrupt` on the screen (`turnBusy.ts`'s `screenShowsRunningTurn`), which a
   FRESH seat can only be showing for the pickup's own turn — asked only of a host with a measured busy footer
   (`runningTurnIsAssertable`), so never of a Codex seat. MEASURED under cmux 0.65.2: it read
   on the first screen after the Enter that took, 3.7 s before `UserPromptSubmit` arrived.
4. The screen containing the text.

The two cheap, load-immune sources are consulted before the two screen reads, which throw under load, so the
false-negative failure mode cannot recur while either of the others answers.

The four above are the whole chain. A caller that can produce a stronger, caller-side witness — a lifecycle
event only the child can write — belongs above all four, recording WHICH witness answered rather than
assuming the screen did.

**Measured on a real spawn** — boot reported `bootWitness: {by: "event"}` (a `SessionStart` frame;
the screen was never needed) and pickup reported `pickupWitness: {by: "screen"}`. That second one is the chain
working, not failing: the paste renders instantly while `UserPromptSubmit` fires only once the agent actually
takes the prompt, so on the first poll tick the screen was the only source with an answer. cmux's delivery
record did carry the exact text a moment later. **The order is a preference among sources that have arrived,
not a claim that the stronger one always wins the race** — its value is that when the screen is unreadable,
the other two still answer.

That the record can be STALE rather than merely absent is the reason it is compared rather than trusted: right
after boot it still names the boot line, so an un-compared "cmux has a record, therefore the pickup landed"
check would confirm every dispatch instantly, including a swallowed one. The prefix comparison declines it,
which is what the prefix comparison in `src/cmux/sendEvidence.ts` does rather than leaving to a caller.

**Not a witness at spawn time: the child's own journal event.** `handover start` is not consulted, for
timing rather than preference: the child has to boot, read a doc and run a verb before it writes one, which is tens of seconds — far past
`MAX_SEND_VERIFY_POLLS`. A spawn that waited for it would time out on almost every real dispatch and fall
through to the same chain anyway, having spent the budget. That confirmation belongs to the CALLER, one layer
up.

**When every witness answers "no", the composer is SUBMITTED once — and that is not a re-send.** Measured:
two consecutive acme-admin spawns and three of three Slack dispatches ended with the pickup typed
into the composer and never submitted, so no hook fired, cmux recorded no `latest_submitted_message`, and the
screen witness could not confirm the visible line either — a Claude Code composer hard-wraps a long line
mid-token, which whitespace normalisation cannot undo, and `witness.ts` records why that is kept rather than
widened. `pickupWitnessWindow.ts`'s `resubmitPickupThenWitness` sends one bare `surface.send_key enter` — no text — and
watches for `MAX_RESUBMIT_VERIFY_POLLS` more ticks, reporting the delivery as `resubmitted` when a witness
then answers. Live measurement of both halves: one Enter submitted a stranded composer and cmux's
delivery record named the line 20.0 s later, while the same keystroke on a busy session with an EMPTY
composer moved nothing across eight reads over 32 s. That second half is why it fires unconditionally instead
of being conditioned on a screen read that may be unavailable. `docs/pickup-witness.md` carries the whole
argument.

**Before either chain: a `workspace.create` that timed out is an unknown outcome, not a failure.** Measured:
cmux answered the create after the socket's 15 s bound twice, and each time made a workspace the
spawn had already reported as never opened — `workspace:428` and `workspace:429`, titled `Terminal`, empty
process trees. `src/cmux/workspaceCreateRecovery.ts` reads the inventory before the create and, on a `TIMEOUT` or a
transport failure after the frame may have been written (the socket never replays a create), polls it
— every read a strict one that fails on a row it cannot decode rather than dropping it, so an old row cannot pass
as new nor a second match hide — for the one new workspace in the same directory with the same description (never the title, which
the pane overwrites), resolves its surface through `pane.list` and boots into it. Two such rows are reported and
neither touched; none after the bound is reported with the warning that a late one may still appear. Every create
holds a lock keyed by that directory and description from the snapshot through the last read, so a concurrent
spawn's row is never the one adopted; a create that cannot take it opens nothing.

**Boot** — two witnesses, and neither of the other two qualifies:

1. `agent.hook.SessionStart` for this workspace, which only a real agent process emits.
2. `hasPositiveBootSignal`'s per-host banner match.

Neither the delivery record nor "the boot line appears on the screen" is a boot witness: **the shell echoes
whatever it was given**, so a workspace where `claude` failed to launch shows the boot line exactly like one
where it succeeded. Treating that as a witness would report every broken tab as booted.

The event witness is deliberately FORGIVING — if the subscription cannot be opened, `observedEvents()` stays
empty and the chain falls through. An event witness that could fail a spawn by being unavailable would have
made dispatch strictly less reliable than the screen read it was brought in to shore up.

**For a `claude` boot those two are PRELIMINARY; the composer decides.** MEASURED: two spawns under
load timed out on "no positive signal" and left tabs standing at blank Claude prompts that no ledger row named.
So `src/cmux/claudeBootComposer.ts` polls the styled grid (§ 5a) for up to `MAX_COMPOSER_BOOT_POLLS` ticks, and
`src/cmux/composerProbe.ts` decides:

| what the reads showed                                                            | the boot is                                                                                                                                                                                                              |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| a Claude composer on the grid                                                    | booted, `bootWitness: {by: "composer"}` if no other                                                                                                                                                                      |
| every grid read failed, and the preliminary polls saw SessionStart or the banner | booted on that witness — the loaded surface of the false negative above                                                                                                                                                  |
| every grid read failed, and nothing else vouched                                 | FAILED (`never-read`), once a last read of the event stream still holds no SessionStart; a banner first drawn after the preliminary polls is not re-read                                                                 |
| the grid read, and held no composer for the whole bound                          | FAILED, even with SessionStart fired                                                                                                                                                                                     |
| a NEW `No conversation found with session ID` exit                               | FAILED, before the grid is read; an exit is the line at column 0 with no running Claude's chrome below it, so a quote inside a live session is not one; with no readable screen from before the boot, none counts as new |

**A failed boot's tab is closed and the boot runs ONCE more in a fresh tab** (`spawn.ts`'s `retryFailedBoot`),
never into the shell the first one left behind; the credential is routed and the worktree made once. A second
failure closes that tab too, and the refusal names both. A failed tab that will not close is refused with its
refs, and no second tab is opened beside it, so a spawn never leaves two unexplained tabs standing. A Codex boot
keeps the two witnesses above alone and is never retried.

## 5a. Who put that line in the prompt box

The owner, on a screenshot of a session whose prompt line read `approved, land it`, named a common failure mode
and asked for the class fixed: that line was a suggestion, not a typed line. A supervisor had
weighed that line as a ruling the owner might have typed. Nobody typed it — Claude Code generated it as a prompt
suggestion and drew it grey.

**`surface.read_text` cannot see grey, and that is a property of the method.** MEASURED against
cmux 0.64.22: it answers plain UTF-8 with no escape byte at all, identically under `ansi`, `include_ansi`,
`format: "ansi"`, `raw` and `colors`, and cmux publishes no `surface.read_ansi`. So every reader built on it
was blind by construction, not by oversight.

**`terminal.replay` can.** Its `render_grid` (`format: cmux.render-grid.v1`) is the cell grid with a `styles`
table the spans index, and a style carries `faint` — the SGR dim attribute. Measured on one composer row,
three captures minutes apart (the fixtures under `src/__tests__/fixtures/composer/`):

| what was in the box           | `surface.read_text`                                        | the grid's composer span |
| ----------------------------- | ---------------------------------------------------------- | ------------------------ |
| typed `approved, land it`     | `❯ approved, land it`                                      | `faint: false`           |
| a generated suggestion        | `❯ it's probably in the home directory, check ~/hello.txt` | `faint: true`            |
| the empty-session placeholder | `❯ Try "create a util logging.py that..."`                 | `faint: true`            |

So the rule is one bit: **composer text drawn faint was not typed.** `CmuxClient.readScreenGrid` is the read,
`src/cmux/composer.ts` is the meaning, and two verbs act on it — `cmux read-screen` prints the verdict beside
the screen, and `cmux submit` REFUSES to press Enter on a box holding a suggestion, because submitting one
carries out the model's own words as though a person had asked for them.

**`cmux spawn` reads the box before it returns.** MEASURED: workspace:327, 328 and 330 each
returned success and sat about seventy minutes with the pickup typed and unsubmitted, running nothing while
the fleet read them as live, until one hand `cmux submit` started all three within seconds. No witness in § 5
reads the composer, so any of them answering yes, or an honest `unwitnessed`, could leave the line there.
The box is read on every witness tick nothing else answers, from the first one: under cmux 0.65.2 the Enter
`sendLine` presses a second after its paste failed on 4 of 4 seats while a bare Enter 2.2 s later always took
(MEASURED), so `pickupComposerGate.ts`'s `decidePickupPoll` presses an early Enter on a `typed` box
every `pickupEnterSpacing` ticks, and the blind resubmit fires only when that window pressed nothing.
`pickupComposerConfirm.ts`'s `confirmPickupLeftComposer` reads the grid once delivery ends: a `typed` box gets
another Enter after each settle window, all sharing `MAX_PICKUP_ENTERS` (four, counting `sendLine`'s own), and
reads `resubmitted` by `composer` once it empties; a box still `typed` once they are spent REFUSES the spawn
naming the workspace and the `cmux submit` that presses it through. A delivery still unwitnessed over a box
that READS empty fails as `pickupSubmissionUnproven`, leaving the workspace open and its dispatch recorded so
nothing re-sends or reseats it on a guess ([pickup-witness](../pickup-witness.md)). The budget is more than one because a booting seat takes a later Enter: workspace:588 and 590
stayed typed after the blind resubmit and started on the chair's next one. The send path (§ 5b) keeps one. The blind resubmit
itself still fires unconditionally for § 5's measured reason. Nothing answers `typed` because nothing
matched — an unrecognised composer, an invisible cursor or another host (every Codex seat) is `unreadable`
and never refuses, the same honesty `cmux/turnBusy.ts` keeps about a queued line. The one asymmetry: once
the box HAS read `typed`, a later read that fails leaves it `typed` (`pickupComposerGate.ts`'s
`foldComposerReading`), so an Enter followed by an unreadable grid refuses rather than claiming the box emptied.

## 5b. The same rescue on the SEND path, and the fleet sweep that finds what it missed

`cmux send` strands a line exactly as a spawn does, so it carries § 5's rescue too. The owner flagged it on a screenshot of `workspace:80` holding a peer message
from `workspace:81` in its composer, unsent: a line typed into a peer session's input and never sent.

**The class is recurring, and the proof is that `pickupWitnessWindow.ts`'s rescue keeps FIRING.** On the same machine, a
spawn log records: _"the pickup command went unwitnessed for 30 ticks in
workspace:86, so its composer was submitted again — the line was NOT re-typed — and submitted-message then
confirmed it"_. The strand happens on both paths, so both rescue.

**The plain screen cannot see a strand.** A stranded screen shows no `esc to interrupt` and no queued marker,
and it does carry the `❯` that `bootSignal.ts` matches — so `classifySendDisposition` over the plain screen
alone reads it **`submitted`**. MEASURED across all 20 live workspaces: **2 of 20 composers held
`kind: "typed"` text**, one a peer message and one a supervisor brief, and the peer one held TWO concatenated
sends — a second `cmux send` had appended to a composer the first had already stranded.

**The criterion is the composer's ATTRIBUTE, never its text**, and that is not a preference. The live
`workspace:80` strand read back as `…and one of them was alread[Pasted text #5 +6 lines]ph is still owed…` —
Claude Code COLLAPSES a long paste, so no prefix, `includes` or normalised comparison against the sent text
can match it. § 5a's faint-attribute read has no dependence on the text at all.

So `reachSession` asks the plain screen first (a `queued` line is already accounted for and the composer
is never consulted for it), then reads the grid: a `typed` box means the Enter did not take, and it presses
ONE bare Enter — never a loop, for § 5's measured reason that a second Enter buys nothing on an empty box and
moves nothing a dialog is holding. The disposition reads `resubmitted` or `stranded`, and `cmux send` prints
the stuck text on the second. A `suggestion` or `placeholder` is never pressed, which is § 5a's refusal
reused rather than re-decided.

| verb                               | what it answers                                                                                                                                                                   |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `slopweaver cmux strands`          | every composer in the fleet, with the denominator — `2 of 20 composer(s) are holding an unsubmitted line`. Skips the PINNED supervisor: that box is the one the owner types into. |
| `slopweaver cmux strands --submit` | presses one bare Enter on each stranded one, in turn, typing nothing                                                                                                              |

The sweep exists because the send-side rescue cannot clear a composer already holding a line, nor see a strand
a different path produced — and the owner's own question, how many sessions are sitting on an unsent message,
deserves a verb rather than a screenshot.

**The standing fact underneath all of it:** a line in a prompt box is UNSUBMITTED whoever put it there, so it
is never an instruction. The verdict tells you whether it is even a person's words.
