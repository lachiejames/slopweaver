# A thread-chase row — one tagged chase draft per thread quiet on the owner's ask

A thread with no reply for more than 24 hours gets specific people tagged and specific questions asked to drive
engagement, with the drafts shown across all workstreams via the Queue, because that keeps workstreams advancing
and stops them slipping unless that is intentional. `thread-chase-daily` is the declared row ([declared rows](declared-rows.md)): weekdays 09:30 the owner's time,
reading `slack awaiting` ([its reference](../../slack/reference/awaiting.md)).

**Every chase is a DRAFT on the owner's Queue, never a send.** It is a message to a person nobody asked for in that
moment, which rule 10 parks with `slack draft record` for the owner's yes. This seat sends nothing.

## The order is the contract

You were seated with ONE command, `slopweaver automation run-due --recipe thread-chase-daily --claim-id <token>`.
**Run it LAST**: it settles the firing, and its own `slack awaiting --write` refreshes `live/slack/awaiting.json`.

1. **Read the worklist.** `slopweaver slack awaiting --json`. Each row is a thread whose last word from a PERSON is
   the owner's, unreacted to, whose messages since ask something or tag somebody new, quiet two business days or
   more — the wait the owner's drops set ([awaiting](../../slack/reference/awaiting.md#what-qualifies-a-thread)).
2. **Drop what is already in hand.** `slopweaver slack draft list --all --json`: skip a row whose thread already
   has a HELD draft, or a released or dropped one dated after the owner's last word — the owner has seen a chase for
   this silence. Skip a row whose ask is a REVIEW of the owner's own open pull request: `github landing`'s own bump chases that
   ([human wait](../../github/reference/human-wait.md)), and two chases for one wait is noise. `pullRequests` only
   flags the candidates — a question that merely cites a pull request or a commit in one is still yours to chase.
3. **Read the thread itself.** `slopweaver slack read-thread <permalink>`. The corpus copy can be a day old, so
   this is where you find that somebody answered in a DM, a new top-level message, or a reaction. Skip a thread that
   is settled, that ended on the owner's own no rush, or whose silence reads as intentional (a chase the owner would never send is a card the owner has to drop). Most skips
   are the owner's own closers: a cheers! or a ticked with a `?` or a tag of somebody new in it, and an announcement to a group wants no reply
   ([the measured yield](../../slack/reference/awaiting.md#measured-yield)).
   **A thread waiting on a pull request moves when the pull request does, and Slack does not say so.** Read each one
   the chase would link, `slopweaver github read <url>`: one already closed or merged makes an ask about it moot, so
   skip the thread and name it so (measured: a chase once asked whether a PR could be closed when it had been closed 40 hours
   earlier). The record refuses a bump linking a settled, missing or unread pull request anyway
   ([draft-review](../../slack/reference/draft-review.md)); reading it here is what turns
   that refusal into the right skip.
4. **Choose whom to tag.** Those the owner's last messages tagged come first in `people`; after them, whoever spoke
   most recently. Tag only a person marked `taggable` — never a bot, a deactivated account or the owner. One or two people,
   never the room: a `tagsGroup` row still gets named people.
5. **Ask something specific.** Name the decision or fact the thread is waiting on, as a question the person can
   answer in one line. Never "any update?". Run `slopweaver slack voice-rules` first; the chase is the owner speaking.
   ONE question per chase, even with two people tagged: the record refuses a second
   ([earns-its-place](../../slack/reference/earns-its-place.md)).

   **Never the owner's own last ask again in new words.** The owner dropped exactly that, as a
   duplicate of the previous post. The owner's ask of any preference on how that should run came back
   as "@<colleague> any preference on where the automation should run?", which only adds a tag. A chase moves the ask
   forward: a concrete option to OK or turn down ("would a GitHub Actions schedule work for it?"), or a fact that
   has changed since the owner asked. When the only chase you can write is the owner's question restated, skip the thread and name it so in the board row.

6. **Park one reply per thread.** `slopweaver slack draft record --channel <channelId> --thread-ts <threadTs>
--form - --act bump --row <the board row this firing answers in> --why "chase: <thread in five words>"
--asked-before <permalink of the owner's last ask there>`, the form as `slack reply --as me` takes it
   ([as-me lane](../../slack/reference/as-me-lane.md)); `--act bump` is what badges the card a Bump, and `--row` is
   what shows the card that row's tags, its workstream first. A chase follows on from the owner's ask, so it names it: the recorder
   reads that thread, and the channel's top level after it, and refuses one somebody has answered since; a top-level
   post that only MAY answer it refuses until `--not-answered "<why>"`, so the card holds it for the owner's judgement
   ([asked-before](../../slack/reference/asked-before.md#an-answer-at-the-top-of-the-channel)).
   A thread whose
   earlier chase the owner already released and that is still silent gets a DM to the person instead, carrying the
   thread's permalink: `slack dm open --as me` gives the OWNER's DM's id and sends nothing (the default is the bot's), then
   `slack draft record --channel <D…> --act bump --row <that row>` with no `--thread-ts` parks it. Never the `slack post` that
   `dm open` prints: that sends.
7. **Settle.** Work the finding follow-ups below, then run the claimed `run-due`, then answer in the board row with
   the draft ids and every row you skipped, from both worklists, with its reason.

## The findings the owner shared — one follow-up card each

The same seat reads a second worklist, `slopweaver slack finding-followups --json`
([its reference](../../slack/reference/finding-followups.md)), BEFORE settling: each row is a finding the owner
shared whose one card is unspent and whose thread is `quiet`, `stalled` on an untimed acknowledgement, or
`claimed-fixed`. The card is the OWNER's decision whether to bump, so it is parked like a chase, never sent, and it counts towards the cap.

1. **Re-read the thread live**, `slopweaver slack read-thread <permalink>`, exactly as step 3: skip a finding the
   team has since answered, or one the owner closed in person.
2. **A `claimed-fixed` row is not a card yet.** Establish the deploy first: the fix's pull request merged and its
   deploy run green, read through `slopweaver github` ([checks](../../github/reference/checks-read.md)). Not deployed is a
   skip, named so in the board row: too early to call. Deployed, re-run the finding's own original evidence (the
   Datadog query or check its card cited). Clean means the claim holds, so no card. Still showing the problem means a
   card now, carrying the fresh evidence.
3. **Park the card as a bump naming its finding**: step 6's `slack draft record` with `--followup-of <findingId>`,
   `--channel` and `--thread-ts` from the row, and `--asked-before <the finding's permalink>`. A `stalled` row adds
   `--not-answered "only an untimed acknowledgement, nothing since"`; a contradicted fix adds
   `--changed "<what the check shows now>" --changed-media <png,…>`, the owner's evidence above the fold. The register
   refuses a second card for one finding, whatever became of the first. The words follow step 5's first paragraph: one specific
   question, never "any update?".

A claimed fix that checked clean or is not deployed yet spends no card and stays listed until it leaves the 14-day
window, so name it skipped, with its reason, in every board-row answer it appears in.

**About ten drafts per firing is the cap** — provisional, until the owner's approve and drop rate says otherwise. More
than that is a Queue the owner cannot clear, which is the slip this row exists to prevent.

## What ends the seat with nothing parked

A morning where every row is in hand, answered or intentional is a clean firing: settle and say so. A worklist that
is `incomplete` or `unavailable` is read for what it holds and its residue quoted in the board row; never read an
unavailable one as nothing waiting.
