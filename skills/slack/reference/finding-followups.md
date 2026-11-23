# The findings the owner shared, owed their one follow-up card — `slack finding-followups`

`slopweaver slack finding-followups` lists the team-facing findings the owner shared that come back to the owner as
ONE card each, so the owner decides whether to bump. It reads the draft register and the local corpus, and it **never drafts, posts or
sends**: the seated [thread-chase](../../automation/reference/thread-chase.md) session parks the cards.

The owner's rulings, journalled on board row
`never-lead-with-the-pr-lead-with-the-discussion-on-every-queue-card`: a finding that meets silence comes back to the
owner and the owner decides whether to bump, and in the owner's words the owner and the fleet should wait until the
team has had a full working day to respond; an untimed "I'm looking into it" with no update after a business day is,
in the owner's words, the same deal, bring it back; a "fixed" our checks contradict, in the owner's words, bring the
owner that evidence straight away, assuming that like the team has actually deployed the fix. **The person carries
no cadence**: one card to the owner, never a schedule on the person.

```bash
slopweaver slack finding-followups                           # text: one block per finding, then the residue
slopweaver slack finding-followups --json                    # exactly one document on stdout
slopweaver slack finding-followups --write                   # also replace $SLOPWEAVER_HOME/live/slack/finding-followups.json
slopweaver slack finding-followups --now <iso> --home <dir>  # freeze the clock; read and write another home
```

Flags, exit codes and unavailable/incomplete behaviour are `slack owed`'s exactly, one shell ([owed](owed.md)).

## What counts as shared

A row parked as a finding and then RELEASED (`src/outbound/slack/sharedFindings.ts`): a bot `finding` form is stamped
`kind: "finding"` at recording, an as-me row only by `--kind finding`, which a thread reply or DM may omit and then
is not seen. The register is the only door a finding leaves by
([finding card](../../automation/reference/finding-card.md)), so no bot post or prose is read as one. A held or dropped finding was never shared, and a release that sent a thanks in its place shared
nothing. A released finding whose message `slack delete` later removed carries a `deleted` event at that same
channel and ts and is shared no longer: nobody can see it, so it is never chased. A repost is its own row and is the
live finding. Only the last 14 days count.

## The verdict

`findingFollowupVerdictOf` in `src/sessionStart/findingFollowups.ts`, reading only messages after the finding:

| Verdict         | When                                                                                           |
| --------------- | ---------------------------------------------------------------------------------------------- |
| `claimed-fixed` | the team's LATEST word claims a fix — at once, no clock                                        |
| `quiet`         | no person but the owner has replied, and a full business day has passed since it landed        |
| `stalled`       | the team's latest word is an untimed acknowledgement, a full business day old                  |
| in hand         | answered, a timed promise, inside the first day, or the OWNER spoke after the team's last word |

A thread where the owner spoke last is `slack awaiting`'s, which chases the owner's own ask: one silence never gets
two chases. A claimed fix outranks that on purpose: the owner's "thanks" under a "fixed" checks nothing, and a
contradicted fix is evidence the owner does not have.
Business time is Melbourne weekdays (`src/review/businessTime.ts`).

**Both text tests under-select on purpose.** An acknowledgement is a short reply (at most 20 words) that matches a
"looking into it" phrase, asks nothing back and gives no cause. A fixed claim is a completed-state word ("fixed",
"resolved", "sorted", "deployed", "merged the fix") in a clause that is not a question, with no negation,
condition or future in the four words before it, plus the hedged "should be fixed now". A miss is the seat's live
read and the owner's eye to catch; the patterns move on a measured miss.

## One card per finding

The card is a bump in the finding's own thread naming it:

```bash
slopweaver slack draft record --channel <channelId> --thread-ts <threadTs> --form - --act bump \
  --followup-of <findingId> --row <row> --why "follow-up: <finding in five words>" --asked-before <permalink>
```

`--followup-of` is checked against the register, and checked again under its lock: it must name a released finding,
be a bump, land in that finding's thread, and find no other row naming the finding. **Any such row spends the card**,
held, released or dropped, because a dropped card is one the owner saw and decided. A re-cut with `--supersedes` that names
the same `--followup-of` hands the card on rather than spending a second; one that drops the flag leaves it spent.
It refuses too while any register line does not read, since that line may be the card. The send holds the line as
well: `slack post|reply --draft <id> --approve <digest>` refuses a card while another naming the same finding is sent
or still held, whatever its words. Two held cards (a re-cut whose drop failed) each refuse until one is dropped, so
two releases racing each other both stop.

## Residue it states

The corpus copy can lag, and a reply posted top-level or in a DM is not seen; a reaction is not a reply; a timed
promise stays in hand however long ago its time passed; a claimed fix is never known to be deployed or contradicted
by this verb. A claimed fix whose deploy is not out yet, or whose evidence checked clean, costs no card and stays
listed until it ages out of the window, so the seat names it skipped in its board-row answer. One card per finding is
read off the register, so a card Slack accepted whose `released` line failed to write is still held there. The
release says it WAS SENT and names the drop to run. If that card is re-cut instead, the re-cut can send a second
card. That is the same failed-write gap every draft has, and closing it needs a send record kept apart from the
register.

## Measured yield

On the owner's home (`slopweaver slack finding-followups --json | jq '.counts'`): **1** finding owed, quiet
108 business hours, no other finding shared in the window. Too few to judge the text tests against, which is why
they are stated as untested on real replies rather than tuned.
