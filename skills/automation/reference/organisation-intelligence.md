# Organisation intelligence — the evidence bar, and why a Linear link is not evidence

Bundled reference for the `automation` skill. An organisation-intelligence post is the one that surfaces
something **useful that other people are not aware of**, rather than restating what a monitor or a channel
already said. A post whose evidence is only Linear tickets, with no screenshot, falls short: an investigation into
a problem with business value carries Datadog screenshots (annotated crops), citations that link to Datadog and
stats about impact and blast radius that show the issue.

## The rule

**A finding is evidenced from the SYSTEM OF RECORD for the thing it claims.** A ticket tracker is the system
of record for _what somebody decided to do_. It is never the system of record for _whether it is still
happening_. So:

| The claim                    | What evidences it                                                         | What does NOT             |
| ---------------------------- | ------------------------------------------------------------------------- | ------------------------- |
| this is broken in production | Datadog — an annotated crop, a citation URL, a count over a window        | a ticket that says it is  |
| this was dropped             | the PR's own `state`/`mergedAt`, read live, and the review that closed it | the ticket's state field  |
| nobody is aware              | the awareness check across Slack, GitHub, Notion and Linear               | a low mention count alone |
| this is worth N              | the measured share, with its denominator printed                          | an adjective              |

**Linear links alone are not evidence, and a post carrying only them does not go out.** They are where a
finding STARTS; the post ships when the claim has been taken to the system that can falsify it.

## What the post carries

- **An annotated Datadog crop** per live claim, and **the ATTACHABLE route is the only one that counts.** A
  `browser shot` naming a closed `--target` is attachable; `--raw` photographs anything and is attachable by
  nothing, because it carries no read-back record and the door refuses an unrecorded image.
  **MEASURED:** the only Datadog targets are `datadog-logs-v1:timeseries` and
  `datadog-apm-traces-v1:timeseries`, and on a SIX-event log query the readiness check never fires —
  `target-not-ready`, _"no results summary has rendered"_, at 30484ms and again at the 60202ms maximum. So a
  small-N log finding genuinely cannot carry a crop, and the post SAYS that on the card beside the citation
  rather than omitting it silently. Repro:
  `slopweaver browser shot --url '<logs view>&viz=timeseries' --out /tmp/x.png --target datadog-logs-v1:timeseries --readiness-timeout 60000`.
- **A citation that links to Datadog**, not only to the tracker.
- **Impact and blast radius as stats**, with the denominator printed so the reader re-derives the cell — the
  same discipline as [the priority matrix](priority-matrix.md).
- **The negative, stated.** Where the original error does NOT appear in the retained window, the post says so
  in those words. A claim of "still firing" that rests on a ticket being open is the exact defect this rule
  closes, and a sibling error in the same module is named as a sibling, never folded into the finding.

## The atlases are in scope for the detectives

A detective that does not fan out over the atlases is under-using what it has. The standing shape is that **close
to anything the owner can reach by speaking to the supervisor is also reachable through the bot entry point**, with
good judgment applied to what that means in a given case. An atlas is often the best source a
question has; a wave that reads only the corpus is under-reading on purpose and should say why.

## Where it goes

**Nowhere on its own.** Scheduled public posting is held generally, because the owner will not usually want a
given post shared. So a finding is a parked bot card on
the owner's Queue, one per issue, naming the owning team's channel and carrying the pictures and citation that settle
it, and the owner's yes is the send ([a finding card](finding-card.md)); a lead the form refuses goes where the hunt
routes it, each parked for the owner's yes ([the hunt](organisation-hunt.md#the-rulings)); the run's prompt thread in the owner's bot DM
gets one line of fact. Nothing in this route asks the owner whether to investigate: that is the fleet's
([the hunt](organisation-hunt.md)).

The one exception: **if somebody ASKED the bot for it, that is a different
story** — an answer to a real ask is not a scheduled post and this hold is not about it.
