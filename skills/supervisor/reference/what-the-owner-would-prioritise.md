# What the owner would prioritise — the order the fill step seats work in

Detail behind [SKILL.md § 7a](../SKILL.md#7a-fill-to-measured-capacity--the-last-step-of-every-tick) and
[sweep-contract.md](sweep-contract.md) step 13. The gates there decide THAT a free seat is filled or named; this
file is how you choose WHAT fills it. Read it before every fill, and before writing any `hold-rationale`.

Filling capacity alone is aimless. What the owner wants is priority and alignment: the fleet works on what the
owner would choose. Rules of the form "if this, seat that" have never worked for this; instead, look at everything
you know about the owner and use judgement to decide what they would most want worked on right now if they knew
everything. The test of a night's fill: the owner wakes, every row is one they would call a good thing to be working
on, and asked why, the supervisor can say everything they wanted was done overnight.

## This is a prior, not a predicate

Everything below was derived from 1,854 of the owner's typed turns into the supervisor chain
(`slopweaver supervisor owner-turns --days 60` reads the same kind of window), the owner's console-voice calls, the
memories and the doctrine rationale.

**It never outranks what the owner said this week.** § 1's `supervisor owner-turns` read comes first and the owner's
newest word wins over any row here; a focus the owner names (ISO work until a stated deadline, or the voice as their
one singular goal) re-orders the list for as long as they say. No code reads this file and none should: the owner
ruled the heuristic out, so the order is judgement over the owner's words, stated per seat, never a score.

**The owner's standing priorities are one order with their Queue** (P0): the order the fleet raises things in matches
the order the Queue puts things to the owner, which matches the alignment the owner and the fleet have reached.
`handover reconcile` ranks the board by it: a row blocking one of the owner's `urgent` workstreams first, then those
workstreams' rows by their `rank`, board band and `controls-resolved=` count, then the rest
([the owner's priorities](../../../docs/console/queue-focus.md)). Fill in that order before walking the bands below.

## The order

Walk the ready set top to bottom and seat the highest band that has a row; within a band, the row the owner's words
touch most recently goes first. **Name the band in the spawn's label** — it is the "why" the owner asks the supervisor
for in the morning.

### 1. Something live, public, or reaching a person right now

A real tag on the bot, a public mistake to clean up, a thread that reads wrong in a channel. A bot tag outranks
general self-improvement work. Trust is the asset and a public miss costs it faster than anything earns it back;
repeated public incidents are what the owner most wants never to see again.

### 2. Something broken that the owner would expect alarm bells about

A scheduled job failing, a plan signed out, the machine or hooks degraded, the bot not healthy. Stop that line —
pause the failing job rather than re-seat it — seat the fix, and put it in front of the owner (a floating note, a
Queue row) the same tick. What the owner resents is noticing first. **Anything taking the fleet down is p0**, the
chair walling included, surfaced off the chair's own gauge before the owner's screen shows it
([plan-routing](plan-routing.md)). When the machine itself is the problem, turning it off and fixing it is the
right call.

### 3. A steer the owner already gave that has not landed

A ruling not yet implemented, a card still showing what the owner already answered, a workstream whose steer no row
carries: something that fixes a real problem the owner gave an explicit steer on. A steer forgotten, or deprioritised
for work the owner would not want, is a big problem; losing steers would be a disaster.

### 4. Landing what already exists

The owner's open pull requests green, rebased and merged; a stalled workstream nudged; the last 5% of something built
that would unlock something useful. Starting new things only helps if things are being finished; otherwise it adds to
the noise. A new pull request on a subject whose earlier ones are still stalled on review is not this band — it is the
last.

### 5. In the owner's work hours: team-facing work the team can feel

ISO measured in failing controls closed, the team's pull requests, meeting follow-ups. Work over personal is the
general rule, ISO work especially, and its progress is spoken of in failing controls closed. It outranks the
Slopweaver self-improvement of bands 6 and 7 while the owner is at work, sits below a steer or landing in EITHER repo,
and yields back when the owner says they are off. Whether it should climb above bands 3 and 4 in work hours is the
owner's open call.

### 6. What makes the owner's attention go further

The Queue and every card on it fresh, linked, carrying the draft and the context the owner needs to react once. The
north star is productivity per unit of the owner's attention, so the owner reads a stale or boilerplate card as the
fleet wasting the scarcest thing it has.

### 7. Class fixes for a recent failure, then behaviour, then code quality

A structural fix for a class that bit this week ranks here; one for an incident months old does not earn a seat on its
own. Among the rest the owner's own ranking stands: behavioural change, then bugs dogfooding already found, then fresh
dogfooding, and code quality last, because it is not behavioural — the filler for a seat nothing above claims.

## What the owner would give no seat to

Each of these the owner personally named as a seat wasted. A row that is only one of them gets a `hold-rationale`
naming which, never a spawn — the idle-capacity gate accepts exactly that answer ([idle-capacity.md](idle-capacity.md)).

- **Work with no steer, no teammate asking and no failure behind it**: low-value pull requests take the place of work
  that is needed or wanted; pre-existing buy-in is what makes a target worth a seat.
- **A sync or resync nobody reads while priority work waits**: the critical work comes first.
- **Private dogfooding that has stopped finding new bugs**: it takes fleet slots from things the owner cares about now.
- **An unasked outward post**: nobody asked for it, so it is noise.
- **Another pull request while the same subject's earlier ones stall**, and **a failing job retried** rather than
  paused and fixed (bands 4 and 2).

## Capacity still matters — the two are one instruction

The owner did not retract capacity: a fleet not running at capacity is lost productivity. An empty seat and an aimless
seat are both the defect, and the resolution is where filler comes from: not self-generated BUILDS, but the steers the
owner already made that nobody built. Plenty of that work can be done fairly autonomously, given how many steers and
decisions have already been made about it. So band 3's backlog is also band 7's filler. Walk the bands to the lowest
unused ceiling; a seat left after band 7 is a `hold-rationale`, and a seat on a no-value row is not an answer.

**The order binds RUNNING seats too, not only the next fill.** There should never be a moment the owner looks at the
fleet page and sees the fleet working on something lower priority than something else waiting. When work in a higher
band waits and no slot is free, size it first (one user or a hundred, and whether we even have numbers), then free a
slot from the LOWEST band running — a markdown ratchet or a dependency bump, say — for it. Infer the bands from the
owner's past rulings. Stop it at a turn boundary, never mid-thought: ask the seat to run
`slopweaver handover release <slug> --why "preempted for <row>"`, then close it, and `cmux spawn <slug>` reseats it
when a slot frees. [`handover park`](../../handover/reference/parking-a-seat.md) does this in one act only for a seat
waiting on the owner's question; one for a seat that is not is the next row, not this verb.

## The fleet's own investigations and proposals

Two kinds of row the fleet originates itself, both on the owner's word:

- **An investigation into something worth a look** needs no automation: it goes on the board and is investigated
  whether or not a scheduled ask runs. It is not "work with no steer" — that steer is this one. Where it seats among
  the bands is judgement over the outcome the owner named: a finding another person acts on, such as a problem costing
  the organisation a large sum each month that nobody is talking about. It is pulled to a result before anything
  reaches the owner ([the hunt](../../automation/reference/organisation-hunt.md)).
- **A proposal**, a capability, feature or re-architecture the owner's words imply: the fleet thinks about these and
  proposes options as Queue cards, which the owner wants to see. It is an ask-shape Queue card — options, a lean, the
  turns it derives from — and never a seat building it before the owner's pick. The owner's test for one: a capability
  the owner will find useful, or one that makes future investigations faster or more accurate, judged by another
  person's positive reaction.

## The question to ask of each row

What would the owner say if they knew all the relevant information? Ask it of each candidate with the ready set, the
live fleet and the owner's last week of turns in view, and seat what the owner would say yes to first. When two of the
owner's preferences pull against each other and no turn of theirs settles it, ask the owner once on the Queue rather
than pick silently.
