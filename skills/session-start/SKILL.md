---
name: session-start
description: Hand the owner a ranked list of what is actually tasked to the owner, read from the owner's own world model rather than from memory, then walk it with the owner one word at a time. Use at the start of a working session, when the owner asks what they should be doing, what they have missed, or what is waiting on them. Phrases like "what should I work on", "what's waiting on me", "what have I missed", "give me my list", "start my session".
---

# Session start — what is actually waiting on you

Instead of reading every Slack message, every mail and every connected app to work out what you must do,
something that has already read them hands you an ordered list.

```bash
slopweaver session-start                 # the ranked list, top ten
slopweaver session-start --top 30        # more rows
slopweaver session-start --json          # every row with its arithmetic, plus what dropped and why
slopweaver session-start --probe         # run each doc's command probes too — slower, sharper
slopweaver session-start --no-verify     # skip the live re-read — faster, and every state is then the corpus's own copy
slopweaver session-start --deadline <iso> # stop live reads at that instant; the list says what it skipped (`cutShort`), and is neither diffed nor recorded
slopweaver session-start lock-in --help  # record what the owner said about one row — see below
```

**It writes nothing and posts nothing.** It reads, ranks and asks. Every action a row suggests is a verb the
owner chooses, taken through the existing door with its existing gates.

**It re-reads live BEFORE it ranks, by default.** Every row goes back to its own provider, and the board leg
also asks whether the session that recorded a question still exists, and a Slack ask naming one open pull
request gains the owner's code-owner share of it ([reading a row](reference/reading-a-row.md)). `--no-verify` opts out
for a fast local run and prints that it did.

---

## What is wired today, and what is not

Say this plainly when you present the list. A list that implies it read the owner's Slack and mail while
reading neither is the one failure that costs trust in it outright.

- **Wired: the handover board's `WAITING ON OWNER` slice.** The highest-precision signal in the system — a
  session did the work, wrote down the specific question it could not settle, and stopped.
- **Wired: the Linear cycle leg**, which CONSUMES a whole `slopweaver cycle reconcile` pass rather than
  rebuilding one. It is the only leg that can measure **drift** — what the system says about the work having
  stopped matching what is true — because a reconcile proposal exists only where a ticket's stated position
  and its real one came apart. A pass that cannot run (no Linear bronze, no structures lane, no identity
  map) leaves the board's rows standing and prints the typed reason it is absent.
- **Wired: the Slack leg**, a streaming prefilter over bronze — never a corpus load, which would inherit
  the whole-corpus reader's `CORPUS_HEAP_CEILING` refusal for a job that needs no retrieval. It has two
  disjoint detectors: **movement** — a thread the owner spoke in whose last word is somebody else's — and
  an **unanswered mention**, a thread somebody tagged the owner in that the owner has not spoken in since. `slopweaver slack
owed` shares the movement detector ONLY (`slackOwedThreads`, one filter, so the two cannot disagree) and
  persists it daily; this list combines both. A reply also sent to the channel is read in its thread only
  ([why](../slack/reference/owed.md#one-detector-shared-with-session-start)). Three things movement does that a naive build would not, each
  measured over fourteen days (171
  threads the owner spoke in, 41 that moved without the owner): it treats Slopweaver's own bot as the owner, because 12 of
  those 41 are the bot replying; it drops Slackbot, which Slack's own API reports as `is_bot: false`; and it
  separates being **addressed** from being **waited on**, because the first live run put _"whose last
  message reads 'Thanks!'"_ level with a session that had genuinely stopped on a written question. A direct
  message or a mention proves the owner is the audience; only a question from that person is evidence anybody
  is blocked. A question in a channel that never named the owner stays ambient — measured, those were asks
  aimed at a named colleague in a room the owner happens to be in.
- **Wired: the Gmail leg**, and it is the only leg that reads LIVE rather than from the corpus. That is
  forced rather than preferred. Bronze's mail labels are the four categories plus `SENT` and `DRAFT` with
  **no `INBOX` and no `UNREAD`**, and `attrs.to` is redacted at ingest, so neither "in my inbox" nor
  "addressed to me" is computable from it. Its detector is the Slack leg's, ported — a thread the owner
  WROTE INTO whose last message is somebody else's — so there is one idea across two surfaces rather than two.
  **Do not build it on `is:unread`.** Measured on the owner's real mailbox, unread inbox mail is five messages
  and not one is a person asking the owner anything, while all three genuinely human threads that day were
  already read. Unread measures what the owner has opened, not what the owner owes.
- **Wired: the GitHub leg**, and which source it reads is an owner ruling rather than a preference.
  _GitHub's requested-reviewers is not the measure of whether a pull request has a reviewer; reviewers are
  only ever asked via Slack._ So whose move a pull request is cannot be read off GitHub at all, and the leg
  reads `github review-state` — which searches Slack for the pull request and reads who was tagged beside
  it — rather than `pane pr-status`, whose merge ladder answers a different question. It searches every
  `mainCheckouts` entry in `profile.json`, because a single-repository default would report the two it
  could see as the whole picture. **An ask has to NAME somebody.** Measured over 35 open pull requests,
  15 asks were direct messages naming nobody a bump could reach and 14 of those were the bot's own; three
  pull requests reported `already-asked` on the strength of one bot status report, and rule zero would have
  suppressed all three while nobody had actually been asked. **A row says MERGE only when every CODEOWNERS
  rule the pull request invokes is satisfied** — an approval satisfying one rule is not the pull request
  being ready, and three rows told the owner to merge pull requests GitHub then refused. Where a rule
  is still owed the row names what is owed instead; where a reviewer requested CHANGES it says so, which a
  contract carrying the reviewer's login and not their verdict could never say. **A row never names a
  GitHub review request, not even as background** — the owner's ruling: ignore the
  concept of GitHub reviewer requests entirely.
- **Not wired: meeting transcripts.** A DECLARED gap rather than an omission — huddles are indexed with
  their participants and times, but the words spoken in them are not retrievable — and the verb says so.

The verb prints its own `could not see:` lines. Do not paraphrase them away.

---

## Reading a row

Every row carries four things, and a detector that cannot fill all four drops the candidate rather than
rendering a blank cell:

- **who** asked · **where** it lives · **when** it last moved · **what would count as done**

Then one clause naming the signal that actually carried it, and the score. That clause exists so the owner can
**argue with the rank**. When the owner does, the correction attaches to a rule, not to a row — write it down.

Seven more things a row's own shape tells the owner — why it never truncates, what a `CLOSE —` mark means, what
`· freshness unverified` does and does not claim, and which rows the live re-read matters most for:
[reading-a-row.md](reference/reading-a-row.md).

## Every row says where it already STANDS — ruled, in flight, or untouched

The owner's words: the first few items the owner sees on there are things the owner already answered in the
previous supervisor. Every row in `--json` carries a `standing`, judged after the ranking against the
lock-in ledger (by identity OR anchor URL) and the board's open runs plus the live session ledger. A ruled
row is demoted and labelled `you already answered this: ruled <date>`; an in-flight row is held back with the
session named. A STACKED row is suppressed earlier and by a different test — `review/stack.ts` against the
repository's default branch — so it is not a standing. **A supervisor records every ruling the owner gives through
`lock-in` the same tick — `--item <url>` when that is what it holds** — or the row is back tomorrow.
The three standings, what each does, and why: [standing.md](reference/standing.md).

---

## The page is the FLEET BRIEFING — there is no second artifact

Owner ruling: one page. This verb emits none; one run of it feeds the briefing's list AND a
react-now card per open pull request. **Never write a ranked-list page by hand** — the gate cannot catch a
page nobody ran it over. What `--open-prs` projects and the rules it carries:
[the-briefing-page.md](reference/the-briefing-page.md).

```bash
slopweaver session-start --json --no-record > run.json
slopweaver briefing render --form - --your-list run.json --open-prs --out <html> < form.json
```

`--open-prs` reads each row's `standing` and holds back a `ruled` or `in-flight` pull request,
naming each one on its diagnostics — so a card the owner already answered is removed the moment it is ruled
(briefing-contract rule 6) rather than by a script somebody remembers to run.

---

## Lock-in — walk the list, one word at a time

The list is the beginning, not the output. Condense it and walk it with the owner:

- Take the top row. State it in one or two sentences with the anchor linked, propose **one** concrete next
  action, and show the reply words on one line. Then stop.
- The words are `do`, `hand-off`, `defer`, `skip`, `note <text>`, `jump N`, `stop`. **Anything that is not
  one of them is an instruction about the current row.** The menu is scaffolding, not a contract, and
  insisting on it is the tool getting in the way.
- Move down. Stop when the owner stops.

This doubles as ranking feedback via the Cunningham's-Law effect: a best guess the owner can correct beats a
question the owner has to answer from nothing. **The first row getting corrected immediately is the mechanism
working, not the list failing.**

### Record every resolution, or tomorrow's list has not learned anything

```bash
slopweaver session-start lock-in \
  --item linear:INFR-1513 --against <the row's own whenIso> \
  --proposed "close it, the work shipped" \
  --reply do --outcome approved-as-proposed
```

- `--item` and `--against` come straight off the row (`--json` carries both). `--item` also takes the row's
  anchor URL, for a supervisor relaying a ruling given on a card. **`--against` is what makes a resolution
  lapse** rather than stick forever: it governs that item only until the item moves.
- `--outcome` is the ranking's own word for what the owner's reply amounted to: `approved-as-proposed`,
  `edited`, `rejected`, `deferred`, `dropped`, `noted`. `do` on the action as proposed is `approved-as-proposed`;
  `do` after the owner rewrote the action is `edited`, and the difference is the measurement.
- `--reason` is required on `rejected` and `edited`, one of `already-done`, `not-mine`, `not-now`,
  `wrong-action`, `unreadable`, `duplicate`. **Count `already-done` first** — it is the failure rate this
  whole feature exists to drive down.
- `--until` is required on `deferred`, and refused on anything else.
- `--note` carries the owner's own words verbatim. Never store a summary of what the owner said.

**What a recorded resolution then does.** `dropped`, `rejected` and `deferred` keep the row off the next
list, which is what the owner said them for, and the row appears in the drop count with the owner's own reason
on it. `approved-as-proposed` and `edited` do **not** hide anything: the owner agreeing to do something is not
the source confirming the owner did it, and absence is never done. Every one of them lapses the moment the item moves.

**The verb writes one append and nothing else.** No Linear transition, no Slack post, no GitHub call. If a
resolution implies an action, take it through that action's own verb.

---

## Rules that bind this skill

- **Never tick something that is not done**, and never present a row you have not actually read.
- **Record the owner's reply before moving to the next row.** A resolution a session remembers is a resolution lost
  to the next compaction, and the whole point is that tomorrow's list answers to it.
- **Never present a `--no-verify` row as current.** MEASURED: of ten rows, six were wrong and
  three described finished work — one had merged the previous day, one was closed, one had
  merged after an earlier sweep called it ready. The owner's complaint: stale rows are junk, and they take up
  the space of what would have actually been useful information. A
  staleness caveat printed on every one of those runs was read past every time, so the live re-read is the
  default; never reintroduce the caveat or drop the re-read.
- **A `trace` proposal never reaches the list.** The cycle pass raises one where its evidence does not settle
  whether the work is outstanding, so the row is held out for a live read rather than ranked as work. Those
  are in the drop count, and `--json` says why each dropped.
- **No walls of text** (AGENTS.md rule 7). Outcome above the fold, evidence and provenance below it.
- **The owner's corrections are the ranking.** Feedback from the owner is the only thing that gets this right, and
  onboarding is where that intake starts.
