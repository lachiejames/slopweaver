# An owed-reply row — one reply draft as the owner per thread whose last word asks the owner something

The owner's ruling, on a colleague's question under the owner's own post that sat 38 hours, in the owner's words:
if the owner comes to the queue page, is the owner gonna see it already written draft for that Slack thread ...
the owner thinks they'd like to know.
`slack-owed-daily` is the declared row ([declared rows](declared-rows.md)): daily 08:55 the owner's time, reading
`slack owed` ([its reference](../../slack/reference/owed.md)). It is the inverse of
[thread-chase](thread-chase.md): that row chases a thread quiet on the owner's OWN ask, this one answers a thread
quiet on somebody else's.

**Every reply is a DRAFT on the owner's Queue, never a send.** It is a message to a person nobody asked for in that
moment, which rule 10 parks with `slack draft record` for the owner's yes. This seat sends nothing — and it never
registers an ask asking the owner WHETHER to answer: the draft is the question, and the owner drops one the owner
would not send.

## The order is the contract

You were seated with ONE command, `slopweaver automation run-due --recipe slack-owed-daily --claim-id <token>`. **Run it
LAST**: it settles the firing, and its own `slack owed --write` refreshes `live/slack/owed.json`.

1. **Read the worklist.** `slopweaver slack owed --json`. The worklist is every row with `asksQuestion: true` — a
   DM or a tag with a `?`, or an untagged `?` under a post of the owner's or from the person the owner's
   latest word in the thread tagged. A row without the flag is not this seat's.
2. **Drop what is already in hand.** `slopweaver slack draft list --all --json`: skip a row whose thread already has
   a HELD draft, or a released or dropped one dated after the row's `lastWordAtIso` — the owner has seen a reply for
   this question.
3. **Read the thread itself.** `slopweaver slack read-thread <permalink>`. The corpus copy can be a day old, so this
   is where you find that the owner answered in a DM, a new top-level message, or a reaction.
4. **Investigate what the question needs.** Anything worth a look is investigated to a result with receipts
   (rule 10) — the corpus, the repository, the provider verbs. Run `slopweaver slack voice-rules` first; the reply
   is the owner speaking. A question only the owner can answer still gets a draft: say what you found and leave the one
   open fact as a plain line the owner fills in before they send. The reply opens on the answer, and every receipt past one figure is an
   attached image: the record refuses more ([earns-its-place](../../slack/reference/earns-its-place.md)).
5. **Park one reply per thread.** `slopweaver slack draft record --channel <channelId> --thread-ts <threadTs> --form -
--act reply --row <the board row this firing answers in> --why "owed: <thread in five words>"`, the form as
   `slack reply --as me` takes it ([as-me lane](../../slack/reference/as-me-lane.md)). Every row is a thread the
   owner spoke in, a DM's included, so `--thread-ts` always applies; under a bot alert's root the reply tags whoever
   asked the owner, since nobody else is notified ([who-will-see-it](../../slack/reference/who-will-see-it.md)). One thread is one card — a thread already holding a
   held reply takes `--supersedes` with a merged reply. A reply that asks something declares whether we asked it
   before ([asked-before](../../slack/reference/asked-before.md)). Each record then waits up to 90 seconds on Codex's
   draft beside yours ([draft-comparison](../../slack/reference/draft-comparison.md)); one left `unavailable` is
   retried with `slack draft compare <id>`, never re-recorded.
6. **Settle.** Run the claimed `run-due`, then answer in the board row with the draft ids, and every asking row you
   did not draft with ONE named reason: `settled` (answered since, with where), `already-drafted` (the draft id),
   `not-to-the-owner` (the live read shows the `?` was for somebody else — say who), or `intentional` (the owner's
   own word in the thread closed it — quote it).

**About ten drafts per firing is the cap** — provisional, until the owner's approve and drop rate says otherwise. A morning
with more is ranked oldest question first, and the rest named `over-cap`.

## What ends the seat with nothing parked

A morning where no row asks the owner anything, or every one is in hand, is a clean firing: settle and say so. A worklist
that is `incomplete` or `unavailable` is read for what it holds and its residue quoted in the board row; never read
an unavailable one as nothing owed.
