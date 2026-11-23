# The second failure mode: `no-conclusion-in-bound` loses everything

Part of [Why planning passes did not converge](../codex-plan-convergence.md).

Three planning records. All three burned **100%** of a 1,500-to-1,800-second bound. Their shape is identical:

```
attempt initial     aborted  1,529,903ms  items not-measured(aborted)  usage not-measured(aborted)
attempt conclusion  aborted    270,101ms  items not-measured(aborted)  usage not-measured(aborted)
outcome no-verdict  no-conclusion-in-bound   rawFinalResponse = null
```

**The warn IS delivered and the conclusion prompt IS sent.** That was the first thing checked and it clears the
bound machinery: the second attempt exists, it ran for the entire conclusion window, and `buildWrapUpPrompt`
is explicit and well-shaped. What happens is that the wrap-up turn is itself aborted at the deadline, so
`thread.run()` rejects, so no `Turn` is returned — and `rawFinalResponse` is `null`.

The loss is worse than the reason field suggests. `client.drainStream` accumulates `finalResponse` and the item
list AS THE STREAM ARRIVES, in locals. When the iterator throws, the surrounding promise rejects and those
locals are discarded. The caller had also already seen every one of those events and folded them into
`CodexActivity` — and then threw that fold away too. So a pass that ran 90-plus commands of real investigation
recorded `items: - (not measured: aborted)` and no response, while three separate copies of what it had done
existed in memory at the moment it was written off.

## What closes it

The attempt's `items` and `usage` read `not-measured` — they report what the SDK measured, and the SDK
measured nothing. A separately-provenanced `PassSalvage` records what the CALLER
observed: commands, failures, searches, scratch writes, the last command lines, and the last `agent_message`
the pass emitted. It carries **no token spend**, because usage only arrives on `turn.completed` and an aborted
pass's cost is genuinely unknown. `src/codex/salvage.ts` renders it into the artifact under an explicit
statement that none of it is a verdict.

**What it costs:** one nullable field on the `no-verdict` outcome, one extra field on the observed item
(`text`, which the adapter receives anyway), and the wrap-up turn streams through the
same sink — sealed so it cannot be assessed, because a turn told to stop investigating must not be killed for
the commands it does not run.

**What it does not do:** it does not make a failed pass answer. `agent_message` items are rare mid-turn — the
answered records show one per turn, at the end — so on some bound-exhausted passes the salvage will be counts
and command lines, not prose. That is still the difference between "we know it read the connector and the
cursor code for 25 minutes" and nothing at all.

## Proof, from a live pass that failed exactly this way

A `p2` pass with a deliberately tight 70-second bound, so it would exhaust the bound the way the
three recorded ones did. It did: `NO_VERDICT:no-conclusion-in-bound`. Its artifact carries the five
commands it ran — and, because the wrap-up turn is routed through the fold, the message that turn produced:

> The local order folds the triggering event before calling `abort()`, then waits for `thread.run()` before
> taking salvage. I'm checking the stream adapter's completion semantics now, because that is what determines
> whether a later callback can still occur after `run()` resolves.

Without the salvage that artifact reads `items: - (not measured: aborted)` and
`(none — the pass produced no response)`, though the counts, the command lines and that paragraph are all
reachable.

## Two defects in this change that the suite did not catch, and where each came from

Both are worth naming because they say something about which check earns its keep.

**The plan arm found one.** A `p1` pass was asked whether the fold could miss an item the stream had already
delivered. It answered `BLOCKED`, and it was right: `armTripwire`'s composed sink called the caller's `onEvent`
FIRST and unguarded. `client.notify` try/catches the sink it is handed — but the sink it is handed is that whole
closure, so a caller's progress relay that threw took the fold and the assessment down with it, and the event
was silently lost from both. A broken progress line could therefore make the tripwire blind to a command and
the salvage wrong about what the pass did. Fixed by folding first and guarding the relay.

**The review arm found the root-misreading class seven times** (findings 1 through 7 in [the table](measurement-and-tripwire.md#what-closes-it), all BROKEN), six of
them against the fix I had just written for the previous one, then an unrelated allowlist gap (finding 8) and a redundant-segment misread (finding 9), plus the unicode false negative and a prompt line
that invited a false discrepancy report. All are pre-existing holes that produce exactly the false abort this
work exists to remove.

None of these findings was reachable by a green suite. Every one with a code fix is pinned by a test
verified to be falsifiable: it fails when its own fix is reverted, and nothing else does.

**The rewording control is the cheapest check in this document and it paid nine times running.** The brief's
appended section recommends re-running a settled property under different wording before trusting it, on the
evidence that three CLEANs missed what one rewording caught. Here it did better than that: each rewording caught
the _fix_ for the previous one being another special case of the very mistake under repair. Eight passes, eight
real defects. It took until the fifth and sixth — a colon, then quoting — for me to stop patching punctuation and
change the question instead; the seventh found a plain off-by-one inside that better answer; the eighth and ninth
left the class entirely, finding `/sbin` missing from the tool allowlist and a redundant `.` segment turning an
in-root path into an outside one.

The properties are still ones I wrote about code I wrote — the authorship bias that section names is not
addressed by anything here. What makes these verdicts worth something is that every one was BROKEN, which is the
direction that carries information. A self-authored CLEAN would still not have meant much.

**A note on when to stop.** None of the last three counterexamples is going to happen — a repository root holding
a literal backslash, a colon, or an argument spelled `/repo''\ root/a`. I fixed them anyway, and the reason is
the point: **the stopping rule I used was not "this case is unlikely" but "the fix would be another special
case."** By that rule the first four fixes were the bad ones — each bought a single character — and the fifth was
the good one, because it replaced the question and closed the family. Finding 7 is a third category and the easiest
call of the lot: not a special case at all, just an off-by-one in the good fix, worth one character. Finding 8 is a
fourth and cheaper still: a plain omission, one word. Finding 9 is worth its own note, because it moved something
OFF the accepted-limits list: `.` and `..` had been declared unresolvable, and that was fine while they were
missed sweeps — but a redundant segment was producing a false ABORT, which is the direction that is never
acceptable. A tenth pass will find something too; the test to apply is whether closing it needs another special
case, a generalisation, a correction, a missing entry, or a limit that was misfiled as safe.
