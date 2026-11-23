# The supervisor delegates; it does not investigate

Bundled reference for the `supervisor` skill. Loaded when § 3b links here, not on every turn.

## The ruling

The supervisor stays on supervisor work and leverages sessions for the rest. It avoids doing work itself that could
be delegated to a separate session, since one quick check can turn into a full-blown investigation (a classic
thought trap), which degrades its actual roles: multi-agent orchestration, wake cycles, feedback intake, spawning
new sessions, writing handoff docs, keeping the fleet briefing up to date and keeping all chats progressing. This
skill and the supervisor handoff say so.

## The measured instance

A fresh supervisor (Fable) was asked, as an exercise, for a voice rewrite of two PR
descriptions. It read both PR bodies through the door, read `profile.json`'s voice rules, and drafted the
rewrite itself in-chat — roughly four tool rounds of session work spent inside the supervisor's own context,
during a sweep tick — before the owner caught it. Nothing about that task needed the supervisor's own hand: a
`cmux spawn` would have done it in a session whose whole context was the two PRs, at no cost to the sweep this
chat is supposed to be running.

## What counts as a supervisor role, and what doesn't

The supervisor's roles are the ones this skill already names: multi-agent orchestration, the sweep cycle
(§7), owner intake, spawning new sessions (§3), writing handover docs, keeping the fleet briefing current
(§ Fleet briefing), and keeping every chat progressing. Anything that is not one of those — a rewrite, a code
read past one file, a measurement, a research question, a fix — goes to a session, even when it looks like one
quick check. One quick check turns into an investigation, and every token spent on it is taken from the roles
above — a classic thought trap, not a supervisor-specific failure.

**The test to apply**: would answering this need a second tool call? If yes, it is not a quick check — file a
handover doc and `cmux spawn` it, per §3.

## A long read goes to a subagent

In the supervisor chat, a file read done to ANSWER something and likely to return more than about 2,000 tokens is
not local work. Send an in-process `Agent` subagent the path and one sharp question, pin `model: "haiku"` for
focused extraction or `model: "sonnet"` when synthesis needs it ([model-tiering.md](model-tiering.md)), and ask
for a few-line answer. The subagent reads the raw file; the supervisor does not. Whole-file `Read`, long
`sed`/`cat` ranges over code or data, and logs are the common cases.

**The chair's own instructions are never delegated.** This skill, a reference it links to, and above all
[sweep-contract.md](sweep-contract.md), which the wakeup reads whole every tick, are what the supervisor
follows, and a few-line summary of an instruction is a different instruction. Those, a short targeted range and
the three exceptions below stay local.

Why: everything a call returns is read again on every later model call of that pass. MEASURED over
81 supervisor passes on three chairs: one pass read about 4.4M prompt tokens across roughly 25 model calls, and
whole-file `Read`, `sed` and `cat` together carried about 267,000 of them, roughly 6%; one whole-file `Read`
returned a mean 6,055 tokens and carried about 183,500. Reproduce per chair with `slopweaver transcripts draw
--session <id>`; the chairs and the aggregation are on `$SLOPWEAVER_HOME/pages/chair-token-waste/index.html`.

The risk is omission: the subagent can drop a detail the supervisor needed. Sharpen the question and ask again,
never load the whole file here. If answering grows past that one question, the test above applies: spawn a session
whose brief names its artifact.

## The exceptions — named precisely, nothing else is one

- Verifying a peer's checkable fact per `cross-session-messages.md` — one command, never a chain of them.
- Answering a parked `AskUserQuestion` menu in a spawned session, per §3a.
- Reading a screen to classify idle vs. stuck, per §3's resume procedure and §7's sweep.

## Every investigatory session ENDS IN AN ARTIFACT the owner reacts to

Delegating is only half the job: a session that investigates and reports back
into the supervisor's chat has produced nothing the owner can react to, and the finding dies with the transcript.
**So the spawn brief says what the artifact is, and the tick that receives it points react-now at it.**

Three things, and none of them is optional:

1. **The brief NAMES the artifact.** Not "investigate X and report" — "investigate X, publish the ranked
   findings with `slopweaver page publish`, then send its URL back". A session that does not know it owes a page will not
   write one, and re-asking for it afterwards costs a whole extra dispatch.
2. **Its question is recorded with `slopweaver handover ask <slug> --question "<what the owner must decide>"`** —
   the run's own typed ending, which pauses it rather than letting it stop silently (AGENTS.md rule 6). That
   is what makes the finding a row on the ONE board instead of a message in a chat.
3. **react-now points AT the artifact**, in the grouping its AUDIENCE decides — `teamFacing` when a colleague
   is on the other end, `meFacing` when nobody else sees it. The grouping says nothing about permission
   (`AGENTS.md` rule 10) ([react-now-groupings.md](react-now-groupings.md)). The card's own text is short and its options route
   the owner back to this chat; the depth lives on the page.

**Why the artifact rather than a summary in the fold.** The owner does not visit boards, and a wall of findings in
a chat is a wall the owner will not read (AGENTS.md rule 7). A page the owner can open, react to and come back to is the
only shape a delegated investigation has ever actually closed in.

## Successor handoff

A fresh workspace with no accumulated context is if anything more tempted to run one "quick check" itself, so
the rule has to survive a restart, not just a compaction. It does by living in SKILL.md § 3b, which a
successor reads by invoking the skill — never as a boot-block line, which carries shift state only (§4).
