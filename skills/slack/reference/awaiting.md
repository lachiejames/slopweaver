# The threads waiting on somebody else — `slack awaiting`

`slopweaver slack awaiting` is `slack owed` turned round: the Slack threads the owner spoke in during the last 14
days whose last word from a PERSON is the owner's, whose messages since then ask something, and that have had no reply for
two business days or more. It reads the local corpus, and it **never drafts, posts or sends** — it is the worklist the
seated [thread-chase](../../automation/reference/thread-chase.md) session drafts parked chases from.

```bash
slopweaver slack awaiting                           # text: one block per thread, then the residue
slopweaver slack awaiting --json                    # exactly one document on stdout, nothing else
slopweaver slack awaiting --write                   # also replace $SLOPWEAVER_HOME/live/slack/awaiting.json
slopweaver slack awaiting --now <iso> --home <dir>  # freeze the clock; read and write another home
```

Its flags, exit codes, `--write` and unavailable/incomplete behaviour are `slack owed`'s exactly — one shell,
`src/cli/commands/slack/snapshotRun.ts`, over one parser, `snapshotOptions.ts` ([owed](owed.md)).

## What qualifies a thread

The selection is `slackAwaitingThreads` in `src/sessionStart/slackAwaiting.ts`, over candidates the same
streaming reader builds in its second pass (`src/cli/commands/sessionStart/slackThreadFacts.ts`). Four choices:

- **The last HUMAN word.** A bot, an app or Slopweaver itself replying after the owner's question ends nothing; a person's
  tick, thumbs-up or OK reaction on any message of the owner's since does. A 👀 or a laugh does not.
- **The owner's trailing run.** Every message of the owner's after the latest other person's word is judged, so "question?" then
  "also, one more thing" is one ask.
- **The ask, off the AUTHORED text**: a `?` outside links, mentions and code, or a tag of a user group, `<!here>`, or
  a person other than whoever the owner is answering — those who spoke since the owner's previous word, else whoever spoke last. A
  tag of an app ("@cursor fix this") asks no person, since an app's reply never answers.
  "thanks @alice" after her answer asks nothing; "@alice please verify" after Bob's reply still does, and so,
  unavoidably, does "nice one @bob" as the owner's first word when Alice spoke last — the seat drops that one. The
  projection resolves mentions to names, so it cannot be read for this.
- **Two business days**: every hour of a Melbourne weekday, `src/review/businessTime.ts`, so 48 of them; a
  Friday-afternoon question is not due until Tuesday afternoon. The owner first asked for more than 24 hours; the
  owner's drops since say two days. A chase parked 25.5 business hours after the owner's ask was dropped as not
  yet long enough to bump the person in that thread, and every chase the owner released unprompted had sat two
  days or more (`CHASE_QUIET_MS`, `src/sessionStart/slackAwaiting.ts`, which carries the drafts and the re-measure). It is a
  MINIMUM: the weekday 09:30 seat lists a thread at its first firing past it.

Direct messages and group DMs (`mpdm-` names) are **counted, not judged**: a DM answer is usually a new message with
its own thread key, so every DM question would read as unanswered. A reply the owner also sent to the channel is read in
its thread only: Slack stores a second, top-level copy, which would otherwise read as a thread nobody answered
(`isBroadcastCopy`, `src/cli/commands/sessionStart/slackRow.ts`). A tick on that channel copy still answers the owner:
channel history is re-read every window while a reply is fetched once, so a late tick may sit only there.

## What a row says

```text
73h quiet · #a-channel · you spoke last 2001-01-01T00:00:00.000Z · asks
  "can you confirm the rollout?"
  people: Alice, Bob
  https://…
```

The document carries each person in the thread — those the owner tagged first, then the newest speakers —
with `taggable` (known to the members index, active, a person, not the owner), plus `hasReplies`, `tagsGroup` and the
pull requests the owner's messages link. It never says whom to tag: that is the seat's judgement, read against the thread.

## Measured yield

On the owner's home (`slopweaver slack awaiting --json | jq '.counts'`), under the one-business-day wait
the selector then had: 206 threads spoken in, **22 awaiting**, 37 answered, 33 asking nothing, 5 inside their first
business day, 109 DMs not judged. Read by hand,
the 22 were about 7 genuine chases, 5 review asks on the owner's own pull requests (`github landing`'s bump covers those),
and about 10 the owner's own closers or announcements — "cheers!", "ticked", a thanks that tags somebody, a heads-up to
`@engineers`. Reviews then removed the false shapes they named — group DMs, a tag of whoever the owner was
answering, a reply's channel copy, a person's tick or thumbs-up on the owner's ask (narrowed from any
reaction), a run of four or more judged off its last three, a tick lost to an older copy of the same message read
last or held only on a reply's channel copy, a tag of an app read as an ask — and the re-read listed **10**: 39 answered, 31 asking nothing, 121 DMs not judged. The verb
still over-selects on purpose and the seat reads every thread before drafting; a sharper criterion is earned by the owner's
approve and drop rate, not guessed here.

## The residue

Every document says the corpus copy was not re-read live, the criterion in words, how many DMs it did not judge,
that a reply posted as a new top-level message is not seen here (the bump's recorder reads one live,
[asked-before](asked-before.md#an-answer-at-the-top-of-the-channel)), and that a pull-request-linked row may already be
chased by `github landing`. Two more are known and left to the seat's live read: an answer a person posts through
an app (a synced Linear or Jira comment, a workflow) is not a person's word here, and a post of the owner's own as-me
bot reads as the owner's. `live/slack/awaiting.json` is written by `thread-chase-daily`'s own run
([declared rows](../../automation/reference/declared-rows.md)).
