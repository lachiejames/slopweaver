# Listener supervision

How the standing Slack listener runs, how it is watched, what a kill looks like in the journal, and where
the re-arming stops.

The evidence is two incidents: one where the listener was killed twice in fifteen minutes with an empty body
and no stderr while the monitor reported it healthy, and a second, the next day, where a watchdog shared its
fate with the thing it watched — see
[A watchdog that dies with its ward](listener-supervision/journal-and-watchdog.md#a-watchdog-that-dies-with-its-ward).

## The short version

```bash
slopweaver listen arm            # print the ONE line the loop session runs; starts nothing itself
slopweaver listen status --json  # the supervisor's shape: a grade, and why
slopweaver listen supervise      # one death-watch tick: reconcile, count, answer re-arm or escalate
slopweaver listen reconcile      # back-write the deaths NOTHING was alive to record; never escalates
slopweaver listen disarm         # clear the record; sends no signal
```

Each of those also **publishes onto the supervisor stream**, so a watching session is told rather than made
to poll: `slopweaver events tail --cursor supervisor --min-severity alert` surfaces a death or an escalation
within a second of it happening. The stream is a notification and `arms.jsonl` is the decision input — see
[supervisor-events.md](supervisor-events.md) for why they are deliberately two files.

**The listener is one shell process inside the live-loop session, and it dies with it.** That is the owner's
ruling: the Slack listener runs only while the live loop is running in a visible Claude session, as one shell
process inside that session, and when something kills that process the session says so and reruns it.

So none of these verbs starts a process. `arm` composes the exact command and the session runs it;
`supervise` decides whether it should be run again and hands the command back. A tag arriving when no loop
session is running stays a no-op BY DESIGN — that is the wanted behaviour, not the gap.

**A detached, session-leading listener reparented to launchd is not the route**: it survives everything, which
makes it the daemon this repository refuses on purpose. Everything about _noticing_ — the heartbeat, the
verdicts, the bounded counter — needs no daemon.

**And the point is not that no tag is missed.** The problem this solves is an agent reporting that the socket
died with nobody able to say why; a socket that dies at random is a separate problem for later.

That is why the design is weighted the way it is. Detecting the death is the cheap half. The half
that earns its place is keeping the EVIDENCE of each death, escalating to a person instead of flapping, and
letting a supervisor session read the whole picture in one command.

- [What went wrong, and what is actually proven](./listener-supervision/failure-and-evidence.md)
  - [Measured, and not in dispute](./listener-supervision/failure-and-evidence.md#measured-and-not-in-dispute)
  - [Ruled out, with evidence](./listener-supervision/failure-and-evidence.md#ruled-out-with-evidence)
  - [Real, and still only correlation](./listener-supervision/failure-and-evidence.md#real-and-still-only-correlation)
  - [The best surviving hypothesis, named as a hypothesis](./listener-supervision/failure-and-evidence.md#the-best-surviving-hypothesis-named-as-a-hypothesis)
  - [Why the fix did not wait for the name](./listener-supervision/failure-and-evidence.md#why-the-fix-did-not-wait-for-the-name)
  - [Process lifetime, measured](./listener-supervision/failure-and-evidence.md#process-lifetime-measured)
- [How the listener runs](./listener-supervision/runtime-and-watching.md)
  - [Two streams, never merged](./listener-supervision/runtime-and-watching.md#two-streams-never-merged)
  - [The listener registers itself](./listener-supervision/runtime-and-watching.md#the-listener-registers-itself)
  - [A stop CLOSES the socket, and the app's connection budget is shown before another is opened](./listener-supervision/runtime-and-watching.md#a-stop-closes-the-socket-and-the-apps-connection-budget-is-shown-before-another-is-opened)
  - [This is not a daemon, and not the resident executor rule 2 forbids](./listener-supervision/runtime-and-watching.md#this-is-not-a-daemon-and-not-the-resident-executor-rule-2-forbids)
  - [How it is watched](./listener-supervision/runtime-and-watching.md#how-it-is-watched)
  - [A check that can fail](./listener-supervision/runtime-and-watching.md#a-check-that-can-fail)
  - [Two signals, not one](./listener-supervision/runtime-and-watching.md#two-signals-not-one)
  - [The verdicts](./listener-supervision/runtime-and-watching.md#the-verdicts)
- [The re-arm and escalation contract](./listener-supervision/rearm-and-supervisor-read.md)
  - [What the supervisor session reads](./listener-supervision/rearm-and-supervisor-read.md#what-the-supervisor-session-reads)
  - [A false RED is as expensive as a false GREEN, and this one shipped](./listener-supervision/rearm-and-supervisor-read.md#a-false-red-is-as-expensive-as-a-false-green-and-this-one-shipped)
  - [`unarmed` is a statement about the RECORD, not about the machine](./listener-supervision/rearm-and-supervisor-read.md#unarmed-is-a-statement-about-the-record-not-about-the-machine)
  - [Four grades, not three](./listener-supervision/rearm-and-supervisor-read.md#four-grades-not-three)
  - [The grade is not the whole answer — which COMMIT it is on sits beside it](./listener-supervision/rearm-and-supervisor-read.md#the-grade-is-not-the-whole-answer--which-commit-it-is-on-sits-beside-it)
  - [The subscribable event category is Slopweaver's own stream, not cmux's](./listener-supervision/rearm-and-supervisor-read.md#the-subscribable-event-category-is-slopweavers-own-stream-not-cmuxs)
- [What a kill looks like in the journal](./listener-supervision/journal-and-watchdog.md)
  - [The journal is a history, not a liveness oracle](./listener-supervision/journal-and-watchdog.md#the-journal-is-a-history-not-a-liveness-oracle)
  - [A watchdog that dies with its ward](./listener-supervision/journal-and-watchdog.md#a-watchdog-that-dies-with-its-ward)
  - [Measured](./listener-supervision/journal-and-watchdog.md#measured)
  - [Ruled out, with evidence](./listener-supervision/journal-and-watchdog.md#ruled-out-with-evidence)
  - [Why the answer is not a better watchdog](./listener-supervision/journal-and-watchdog.md#why-the-answer-is-not-a-better-watchdog)
  - [So a death is DERIVED, not witnessed](./listener-supervision/journal-and-watchdog.md#so-a-death-is-derived-not-witnessed)
  - [Where it runs, and the one ambiguity it leaves](./listener-supervision/journal-and-watchdog.md#where-it-runs-and-the-one-ambiguity-it-leaves)
- [Recovery after an outage](./listener-supervision/recovery-and-open-questions.md)
  - [What is still open](./listener-supervision/recovery-and-open-questions.md#what-is-still-open)
