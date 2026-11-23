# Rule 10 · Graduated autonomy

Part of [Why each standing rule says what it says](../doctrine-rationale.md).

The rule answers a card that asked the owner to settle a conflict between two of the owner's own earlier rulings.
Neither had been wrong: the owner's trust in the setup had moved. At first it did not stretch to acting on the owner's
behalf on team-facing pull requests; now it does, for what is obvious. So the fleet clears CodeRabbit's requested
changes, pull-request comments, failing CI, merge conflicts, rebases and restacks on the owner's pull requests itself,
and brings the owner only what needs the owner's judgement or what it cannot tell the owner would want. That is the
level: the fleet does things when it is pretty obvious the owner would want them done.

It includes merging. A pull request of the owner's that is mergeable — every check ticked, CI passing, needing only
someone to press merge when ready or enqueue it — is merged by the fleet. So a ready-to-merge pull request of the
owner's proceeds with **no second owner approval**: the review requirement is satisfied by codeowners, which is a check
GitHub already enforces, and the owner reads their own team-facing pull requests before putting them in front of
people, upstream of it. That is a named part of the rule rather than an inference from it.

## Why the rule states a criterion — and how the examples came back

The rule first carried no examples, for a stated reason: an example list gets read too pedantically. An example list is
read as an enumeration of permission, and the two failure modes it produces are both worse than the judgement it
replaces: a session refusing something obvious because it is not on the list, and a session acting on something
unwanted because it pattern-matched something that is. The rule is therefore the same shape as [rule 1](rule-1.md)'s
_"feasible"_ — a judgement the session makes and is accountable for, never a classifier. **The examples came back at
the owner's own request** ([worked examples](rule-10-examples.md)), and the shape that survives both is the one below:
every row is a prior word of the owner's that the fix follows from, so the list illustrates the criterion and never
replaces it. A permission table — rows with no quotable word behind them — is still exactly what the owner declined.

## What the ruling SETTLED, and the site that was waiting for it

`skills/supervisor/reference/react-now-groupings.md` carried a section saying, correctly at the time, that two
readings were in tension — card ONLY the pull requests needing the owner's judgement, against a card for every open
pull request — that both stood, and that which reading the owner meant was the owner's to settle, since a session does
not retire an owner ruling by inference. That is the card the owner was answering. **The lock-in, approved as
proposed, is option A: card only the owner's judgement calls** (recorded in
`$SLOPWEAVER_HOME/handovers/supervisor-state-21aug.md`).

**One consequence is deliberately NOT claimed by this rule.** The open-pull-request cards are projected by
`src/briefing/openPrCards.ts` from `session-start --json`, which does not read `github landing`'s dispatch
verdict — two different runs, as that reference already says. So what landed with rule 10 is the retirement of
the old level's COPY: no card now tells the owner work is held pending the owner's approval, that silence stops it, or
that a conflict resolution needs the owner's sign-off before a force push. Making the projection itself filter by
dispatch verdict is the named follow-up it was already carrying, and it is real behavioural work across session-start
serialisation, the projection and the renderer. A prose change is not proof that only judgement calls are
carded, and this doc does not pretend otherwise.

## The recording half, which is not optional

The autonomy and the audit trail come together, and neither stands alone. The owner needs a ledger, simpler than the
react-now page, showing what the fleet took at this level of autonomy, so the owner can give a retroactive steer on
something they would have been fine with that the fleet did not do, or something it did that they were not fine with.

The register is the store's autonomy ledger (`src/autonomy/port.ts`): one row per act, carrying what was done, the
subject as a checkable id (a pull-request URL, a Slack permalink, a board slug), when, which session, and
**why it was obvious**. The `why` is the load-bearing field — an audit log answers what happened, and what the owner
needs is something they can disagree with, which needs the reasoning that produced the act. `slopweaver
autonomy record` writes a row and `autonomy steer` appends the owner's word on one (`src/autonomy/`); a door that
acts on its own judgement writes through the same register rather than a private append, so the internal finding
door's `finding-pr.<slug>` act is one the owner can list and steer like any other.

**An act the fleet TRIED and could not complete is a row, not a non-event.** A register of successes only
would quietly lose exactly the acts the owner is most likely to want to steer — the press that was refused, the
rebase that would not go — and "we decided to do this and it did not work" is a steer the owner can give, while
silence is not. Nothing may present a failed row as a success.

**A retry is the same row, not a second one.** The action id is caller-chosen and reused verbatim on a retry,
and two records under one id that disagree about any field are refused — so a session that crashed after
acting can record the act again safely, and one id can never name two occurrences.

## What it does not widen

`cross-session-messages.md`'s **tier-3 set** is untouched: new or widened access, a new audience, egress,
spend, an irreversible or destructive act nobody asked for, anything a rule reserves for the owner's own hand.
"Obvious" is the argument for acting inside a mandate you already have, never the argument for acquiring one.

The **finding gate** survives, NARROWED. A row registered with `handover register --finding` is work the
fleet proposed to itself off something it noticed, and `handover rule` still holds its output at every door
that reaches a teammate. The one door that reaches nobody is open: a pull request on this install's OWN repository
opens on the session's judgement and leaves an autonomy-ledger row, because the audience there is the owner and rule
1 already says those self-merge. A `declined` row still refuses everywhere — the owner said no to that specific work,
and a no is not a silence. `src/handover/findingGate.ts` carries the criterion;
`src/cli/commands/github/findingRulingGate.ts` resolves "this repository" from the installed tree's own remote at
runtime and writes the row. See [one-board](../../skills/handover/reference/one-board.md).

**A TEAM-facing door opens only on THE OWNER'S word about that finding** — a pull request to a team repository, a
review ask reaching a colleague. A supervisor's rule-10 relay, or a standing remark of the owner's that points the
same way, is the wrong instrument, and is never recorded through `handover rule` as the owner's ruling. A session
once recorded exactly that pair as the ruling to open a team pull request, and the supervisor flagged the
mis-anchor. When a chair relays a greenlight for one, the answer is that the team-facing finding gate needs the
owner's own word. **This is the scope of "the owner's rulings arrive RELAYED: act"** (rule 8): a relay settles
anything inside the mandate a session already has, while a NEW audience is tier 3 in
[cross-session-messages.md](../../.claude/rules/cross-session-messages.md) and a relay never carries it.

**A relayed ANSWER does not widen the audience either.** The owner's own ask had named a team channel as a possible
home, and the chair relayed the owner's recorded answer as "post counts and grades to [that] channel with no names".
Both read as authority and the card went out; the owner interrupted at once, because nobody had asked for it.
Neither a channel the owner named while scoping the work nor a relayed answer to a recorded question is the word
that crosses into a team's channel: the post is parked on the owner's Queue for the owner's yes, below.

## The audience it does NOT cover: a post nobody asked for

Scheduled programme rows once posted into a team channel on their cadence. That is spam: nobody asked for it. A
scheduled post goes to the owner's bot DM, and the owner shares it into a public channel when they choose; at this
level of graduated autonomy the fleet does not post automatically into channels. If someone asked the bot to do
something, that is a different story.

The owner named the level, which is why this sits under rule 10 rather than beside it. Autonomy covers
acting on a judgement inside a mandate the session already has; **a clock is not a mandate, and a channel is
an audience**. A scheduled firing has no asker at all, so every argument rule 10 makes — "obvious to a
session that knows the owner", "whose idea it was is the line" — has nothing to attach to. The thing that made an
unasked channel post feel permitted was not a ruling; it was a DEFAULT, `params.postTo ?? params.channel`,
written to avoid an `undefined` and landing a card in whatever conversation the row had just read.

The fix inverts the failure mode rather than adding a judgement: a scheduled card's destination is the
owner's bot DM by construction, and a channel is a REQUEST refused unless the row carries the owner's own
recorded approval for it. A mistake now over-posts to the owner, which the owner can ignore, instead of to a
team, which the owner cannot un-send. **Two hatchless gates**, a planner that knows which row is firing and a door
that reads only the slot key a firing carries — complements, neither subsuming the other, both kept for the reason
`.claude/rules/testing.md` gives about `home-safety`'s two halves.

**The exception is the whole second half of the rule, and it is mechanical rather than a judgement.** A person's
tag, DM or thread reply is answered where they asked it, untouched by any of this, because an ask carries no slot
key and a firing always does. Nothing here narrows the bot's actual job. What it narrows is the bot talking
unprompted.

**That exception extends to the thread a tag opened.** In a thread a person tagged it into, the bot is witnessing,
and where a need arises that it can help with in a way the user will likely welcome, it just does it — never work a
named person was asked to do, while a status question a leader asked of someone else is the bot's to answer. A tag
already made that thread an audience the owner gave it, so this is not a clock: `witness help` runs 👀, the card and
the answer exactly as a tag would, and refuses outside the bot's own threads, for a non-responder, and past a
per-thread daily cap ([the turn](../../skills/loop-bot/reference/unprompted-help.md)).

This is also the second half of one incident: a scheduled row's PROMPT moved into the owner's DM after a row posted
its own internal instructions in public, embarrassing the owner, and the CARD stayed pointed at the channel. The card
was the part the owner had not been asked about yet. Read them together: [the automation
skill](../../skills/automation/SKILL.md), which links the DM-not-a-channel reference, and
[private-prompts](../../skills/automation/reference/private-prompts.md).

## Reeled in: a message to a person waits for the owner's yes; the owner's own pull request never does

The line moves in both directions at once. The fleet has
mostly been good at graduated autonomy, but a few acts were ones the owner might not have taken, so some of it is
reeled in: the owner approves those acts until confidence in a pattern is established, and then it graduates. Updating
the owner's pull requests is the other direction: a pull request of the owner's with failing CI that already has a
review ask out gets fixed, never a Queue card that holds things up on the owner, because asking for review on
something with failing CI is a bad look. Sending actual Slack messages to people, or closing ambiguous stale Linear
issues, belongs on the Queue page.

So the axis is **who the act reaches**, not how obvious it looked:

- **The owner's own pull request is the fleet's to keep right, unasked.** Red CI, a conflict, a head behind its
  base, CodeRabbit threads — fixed, ledgered, never carded for a yes. A review ask already out is the case named,
  and the one where waiting costs most: every hour it sits red is a colleague being asked to review something
  broken.
- **A Slack message to a person, sent unasked, is PARKED.** A review ask, a chase, a bump, a DM as the owner,
  an answer to a colleague written in the owner's voice: compose it with `slopweaver slack draft record`, and it
  waits on the owner's console queue for the owner's yes. A reply in a thread where someone asked the bot is not
  this — that audience asked (`loop-bot`), and nothing here narrows it.
- **A Linear closure whose staleness is arguable is carded, not taken.** Closing on the owner's direct word stays an
  act; the cycle skill's proposals already ask one word at a time.

**What graduates a pattern back.** The owner approves a pattern, not a message: once the owner has said yes to a
KIND of send often enough to say so, the owner's word is recorded here as a new worked-examples row, and that
kind goes unasked again. A run of approvals alone is evidence to put to the owner, never the graduation itself.

One week's unasked sends, as the ledger held them, were put to the owner on one page to mark
(`page:rule-10-unasked-sends-19-26-sep`); a mark the owner gives is an `autonomy steer` on the act's own id.

**What the owner's marks established.** The owner marked eight of the nine, and none of the eight
graduates a kind of send back: they shape the draft that is PARKED, never whether it is parked. **Each is one
case the owner marked, so each is the owner's lean for the next draft like it, never a rule**: the draft follows
it, and the owner overrules it in the queue. Each point is the owner's steer on one act of that page, which is its
citation: the acts predate the oldest row `slopweaver autonomy list --json` holds, so an act id here would resolve to
nothing. The ninth act carries no mark and so no lean.

- **Who a review ask goes to.** The owner's later word routes the WHO: the people in the conversation the work came
  from first, a code owner only when none of them can satisfy it. The review-asks preference row carries it
  (`slopweaver knowledge recall review ask reviewer --domain review`), and a draft follows the row, never this
  bullet. Whether one reviewer gets too many asks the owner left open.
- **Two reviewers got a longer clock.** For one, no bump for several days over a weekend; the other is in a similar
  bucket, and a bump after a week was welcome. Two data points; no fixed duration follows from them.
- **Reusing the thread of the owner's earlier ask matched the owner, once.** Bumping a reviewer in the thread of the
  owner's earlier ask on the same pull request, rather than a fresh ask, is very much what the owner would have done.
- **A second public bump after no reaction was wrong, once.** A public bump to a reviewer who had not reacted to the
  previous one should not have gone out; escalating to a DM instead of the public channel is likelier. The route is
  hedged, so a DM is the draft to put to the owner. That bump's broken link formatting looked bad, and the fleet had
  said it was fixed when it was not.
- **Naming reviewers on GitHub, as far as the owner knows, does little.** People ask for pull-request reviews via
  Slack, and the owner may be wrong about that. The hedge is the owner's and stays with the value of the request.
  That one is no ask was already settled, unhedged: GitHub reviewer requests are ignored entirely as a signal
  ([review-state](../../skills/github/reference/review-state.md)).
- **The bot raised it once, then stepped back.** On a correction it posted in a team thread, the bot raised the issue
  without trying to dominate the conversation, which is commended; replying again to the answer that followed would
  have been too noisy. The bot's violet answer banner is generally preferred; whether the bot instead replies like a
  member of the team there the owner left open.

## Stepped up for Linear

The level rises for one surface, on the strength of its rollback. The stakes are lower in Linear: a mistake can be
rolled back, because every issue carries a whole activity history. Linear is treated as a mirror of everything the
fleet does — not Slopweaver tooling, which does not belong in Linear, but all Acme work. A ticket that is on us and is
weak is rewritten, without asking, into a good one by our definition of a good Linear ticket. Linear mirrors reality:
a ticket in Backlog that is actually in progress is drift, and the mirror does not drift.

So, for **Acme work**, an edit that makes Linear say what is true is TAKEN rather than carded: a weak ticket
on us rewritten to a good one, a ticket's state moved to match the work, a ticket put in the right team,
project or under the right parent, and the work the owner does raised as a ticket where it belongs. The rails are
the same axis as the reel-in above, held by the verb rather than by a session's memory:

- **Rollback is the rail.** Every such write goes through `slopweaver linear issue --unasked`, which records an
  autonomy-ledger row naming the issue's own Linear activity history as its rollback. An edit with no row is
  the one shape this does not allow.
- **What reaches a person still waits on the owner's word.** `--unasked` refuses a closure (a state of type
  `completed`, `canceled` or `duplicate`), any assignee change, and a body that mentions someone. The closure
  bullet above is unchanged.
- **A ticket a person filed is rewritten only as it was read.** `--rewrite-filed --expect-updated-at <iso>`
  replaces its body when its `updatedAt` is still the instant the session read; any edit since refuses it.
- **Slopweaver tooling never enters Linear.** A ticket for this repository's own machinery is the junk named above,
  so the mirror covers Acme work and stops there.
- **The owner's own team membership is the owner's word.** `linear team-membership join|leave` changes only the
  token's own user, previews unless `--apply`, and journals an `--unasked` act with the opposite verb as its rollback
  ([team-membership](../../skills/linear/reference/team-membership.md)).

**The line is a write that would upset someone, not delete versus write.** Talk about writes in general, not just
deletes: a write operation that would upset people is the line, while an additive write destroys nothing. The level
steps up likewise for getting into Vanta what we are clearly aligned on.

So Linear and Vanta read off one criterion. An additive write on work we are clearly aligned on is taken and
recorded, whether it makes a ticket say what is true or uploads a document or evidence into Vanta. A write that
changes what others rely on, unasked, waits on the owner's word: a closure, a reassignment, a pushed change to the
privacy policy.

**Reined in for team-facing findings**: a proven, big, undiscussed problem reaches the owner led by its impact in
people, and whether a fix follows is the owner's word ([rule-10-team-facing](rule-10-team-facing.md)).

## The level this replaced

The rule was once that no team-facing act happened without the owner's say-so. That is RETIRED for everything on
the owner's own pull requests, and canon still stating it there is a defect. What came back is narrower and named
above: a message to a person, and an arguable Linear closure. The rest of Linear on Acme work went the other way, to
taken and recorded.
