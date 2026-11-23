# Rule 10, reined in for team-facing findings: organisation intelligence, not organisation fixing

The team-facing half of [rule 10's rationale](rule-10.md), on its own page because it is a whole doctrine.

It comes from an incident draft whose first block was a "Fix branch" link and whose top line asked for a reviewer.
That is the wrong way round. A team-facing finding never leads with a pull request; it leads with the discussion: the
errors noticed, an annotated Datadog screenshot, the Datadog link, and what it looks like it might be breaking. That
can be the whole message, with no pull request at all. The session validates the issue and hands it to the owner,
who decides whether to report it: this is organisation intelligence, not organisation fixing, and whether a fix
follows is decided case by case.

The owner's answers to the alignment questions that followed are journalled as rulings on board row
`never-lead-with-the-pr-lead-with-the-discussion-on-every-queue-card` (twenty in all; `slopweaver handover resume`
on that row prints them); each line below is one.

**Scope: TEAM-FACING work only.** The way the fleet already fixes bugs in its own Slopweaver setup is unchanged. So a
finding the fleet makes about its own tooling still opens a pull request on this repository with a ledger row, exactly
as [rule 10 § What it does not widen](rule-10.md#what-it-does-not-widen) says. The card SHAPE is not scoped: no Queue
card, floating note or teammate's message opens on a pull request, whatever it is about.

## What a team-facing finding earns, and what it does not

- **Only a proven, big, undiscussed problem reaches the owner.** It is raised when screenshots prove it is real, with a
  targeted impact question to the stakeholder who can answer it, because the owner's Queue never reaches zero and
  every card spends that attention. Not an early heads-up on a half-validated one. A proven one that looks minor and is
  not escalating is LEFT OUT, not kept for a quieter review.
- **Already being discussed means dropped**, unless the fleet adds something the room does not have, hard
  evidence such as events actually dropped; a room that decided a problem is not worth fixing, where the fleet has
  evidence the impact is bigger than it realised, is that contribution, and it goes to the owner. That is the incident
  note's required `adds` field ([note-form](../../skills/incident/reference/note-form.md)). A finding waiting on
  the owner's Queue that the team starts discussing meanwhile leaves it on its own when it adds nothing, which saves
  the owner the read (row `build-the-sweep-rule-that-takes-a-waiting` builds that).
- **A missing access is a question, never a stop.** Where checking impact needs access the fleet lacks, the card
  carries a question someone with that access could answer: looping in the right stakeholder empowers people rather
  than stalling. The incident form's `impact` takes `{ question, askWho, wall }` for exactly that, `wall` naming the
  access tried and how it was refused.
- **Enough to bring the owner** is the screenshots plus that question, hedged as far as the evidence goes. An outage
  in one service whose errors could be causing problems in another, where nobody is sure, is enough.
- **The card opens on MEANING, the impact in people.** A dozen people unable to complete a signup means more than
  anything about the internals of how it came to be; there is a translation tax, so lead with meaning. The mechanism
  sits below. The incident form's required `meaning` opens the headline and `Impact` is its first detail line. The
  same dozen people signing up on a second attempt is a UX bug: smaller news, maybe still worth raising.
- **People are telemetry too.** A support complaint with no matching technical error is a lead to investigate,
  never a reason to drop it: bugs raised by actual people are sometimes the best telemetry. Work backwards from it
  into Datadog.
- **Friction is a finding, with nothing broken.** Staff repeatedly spending hours correcting the same manual
  handoff belongs here: an avoidable friction point costing many people hours is exactly what process improvement
  needs to see. Several people describing the same recurring chore is enough for a discussion starter even when the
  hours cannot be measured, provided the card says plainly that the time cost is unmeasured rather than guessing one.

## Fixes wait on the owner's word, and why

Someone may already be fixing it; the owner may not be the best-informed person to fix it; and the fleet's
assumptions about how best to fix it can be wrong, and sometimes are. So:

- A fix to a team repository follows a finding only when the owner says so, case by case. Someone in the room
  confirming the problem and suggesting a fix, without asking us, is not that word.
- The owner's OWN ask for a team-facing fix overrides, with a nudge: a check that the problem was discussed first, in
  the shape of the meeting-start nudges, which are useful rather than annoying. The voice asks it once a call per
  repository as its whole answer, with the thread when it has one, and the relay row opens on a `DISCUSS-FIRST HOLD`
  until the owner's next words, which stand (`site/lib/discussFirst.ts`, `src/talk/discussFirst.ts`); the chair asks
  the same sentence on a direct ask ([routing § 3a″](../../skills/supervisor/reference/routing.md)). Never for
  Slopweaver's own repository.
- A pull request the fleet opened on a team repository before any conversation is closed by its own seat
  (`close-the-fleet-opened-acme-admin-prs-that-had-no-conversation-first`).

## After it is shared

Silence for a FULL working day, or only an untimed "I'm looking into it" with no update, brings it back to the owner as
ONE follow-up card, and the owner decides whether to bump: people drop things, and some of the most useful findings
have been important things somebody dropped and forgot. The person still carries no cadence.
A "fixed" that the fleet's checks contradict goes to the owner straight away with the conflicting evidence, but only once
the fix is deployed; before the deploy it is too early to call. `slack finding-followups` lists the candidates off
the draft register's released findings that `slack delete` has not since removed, and the `thread-chase-daily` seat
parks the card as a bump naming its finding (`--followup-of`), which the register lets one row per finding spend
([the worklist](../../skills/slack/reference/finding-followups.md)). The verb only flags a claimed fix; whether it
is deployed, and whether the original evidence still shows the problem, is the seat's to establish. A finding the
owner dismissed personally comes back when new evidence materially changes its impact. A dismissal is a no to that
finding as it stood, never to new evidence.

## Where it is held

The opening is a gate rather than a reading: `src/briefing/pullRequestLead.ts` is the one criterion, refused at a
hand note's headline (`src/hand/prLedHeadline.ts`), a Queue ask's opening sentence and heading
(`src/handover/cardAlignment.ts`, a hold its `unaligned-card` hatch does not clear) and a Slack message's first
block bound for a teammate (`src/outbound/slack/draftPrLead.ts`), judged when a draft is recorded and again at
every send, fresh or released, a poll and an edit, on the bytes that send posts. It is judged where a verb AUTHORS
a message, never at the transport, which cannot tell a card the fleet chose from an answer to a person's tag:
`src/outbound/slack/prLeadSeams.ts` classifies every production file that writes words to Slack, and its test
walks each one's syntax tree, counting every write call and every call to a judged producer per enclosing named
function, under a grammar declared beside the test (every invocation form, every wrapper erased at run time, every
holder naming a function), so a new or moved call site fails until it says where its opening is judged, as does a
callee outside that grammar naming a write, a write method stored, bound, passed or destructured instead of called
where it stands, and an entry imported under another name or re-exported. Its stated limits: a producer two hops up
or behind an injected dependency; a bare-named entry stored or passed as a value under its own name, a member name
computed from parts, an escape-sequence spelling or an implicit invocation (an accessor, a coercion, an iterator); a
module loaded by a specifier computed at run time; a move between branches of one named function, or between its
pieces with no name of their own (an anonymous callback, a class static block). The judgement's order before the
write, and that both read the same payload, are proven by a named test case rather than the count, and the walk only
finds that case's title, never whether it still runs. A bot answer, a Queue answer release and a turn card are exempt
there, because the person who tagged the bot chose the subject; that line is the fleet's reading, not yet the owner's
ruling. The owner's own bot DM is never judged, once PROVEN the owner's: exactly the configured
`slackBot.promptChannel`, a direct-message id (`D…`), and a bot-token `conversations.info` read naming
`slackBot.ownerUserId` as its other member (`src/cli/commands/slack/verifiedOwnDm.ts`). It closes a fleet-found bug
in our own tooling: the profile checks no more than that `promptChannel` is non-empty, so a colleague's DM configured
there was exempt. A read that fails, or names anyone else, judges the message; `ownerUserId` stays the authority for
who the owner is, the stated residue. A `--as bot` draft recording reads no proof and exempts nothing, since its
DM-purpose hold refuses every bot card for that DM. Of a multi-message send, only the first message is judged: it is
the one a reader opens on. Measured over the live store when it shipped: 408 parked drafts, one refused (an outage
draft); 8935 board-row texts, the numbered and linked forms firing only on rows that do open on a PR, and of the asks
still open on the owner, none needing a re-cut (one answered, one whose pull request had merged). The rest of this
page is judgement the gates cannot compute, which is why it is written here.
