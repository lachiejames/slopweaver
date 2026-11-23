# Records say where they came from

Part of [Slack reach — everything the token can read, and how we prove it](../slack-reach.md).

Every message and reply carries the reach facts of its channel, so a citation can be honest about the room it
came from rather than implying the owner was in it:

- `attrs.membership` — `"member"` or `"non-member"`.
- `attrs.archived` — `true` only when the channel is archived.

DMs and group DMs are stamped with neither. `conversations.list` omits `is_member` for them because the
concept does not apply, and reading an absent field as `non-member` would be a claim the payload never made.

There is deliberately no per-record `viaUserToken` field. Which token read a record is a property of the RUN,
not of the record — `resolveSlackReadToken` picks one token for the whole crawl — and a bot-token run cannot
reach a non-member channel at all, so `membership: "non-member"` already implies the user-token lane.

## Coverage is a command, not a claim

```bash
slopweaver refresh --source slack --coverage
```

Read-only. It walks `conversations.list` (archived included), joins it against the per-channel store, prints
a per-kind tally and names every conversation that has never been crawled, and **exits non-zero while any
remain**. Slack-only, because none of the other three connectors has a membership boundary for it to be
about.

Two refusals are worth stating explicitly, because both are cases where a friendlier answer would be a lie:

- **A truncated discovery walk fails the report.** If `conversations.list` ends `stuck`, `capped` or at a page
  ceiling, the DENOMINATOR is wrong and every ratio under it would flatter. A coverage report that silently
  measured a prefix is the exact failure the verb exists to prevent.
- **The gap is computed from the per-channel store, not from bronze row counts.** A channel that was crawled
  and genuinely holds nothing has full coverage and no rows; counting rows would report it as a permanent
  false gap. Presence of an entry means "read to the end at least once", which is the claim coverage is about.

## Proof of the backfill

Four channels the coverage audit named as gaps, backfilled through the real door with
`refresh --source slack --slack-channel <id>` (a three-day pooled window, so every row below came from the
per-channel epoch backfill rather than the window):

| Channel                                    | Bronze rows before | After     | Span now                        |
| ------------------------------------------ | ------------------ | --------- | ------------------------------- |
| Bot-alerts channel A (public)              | 0                  | **55**    | about four months               |
| Bot-alerts channel B (public)              | 0                  | **21**    | four days                       |
| Bot-alerts channel C (private)             | 0                  | **461**   | about five weeks                |
| Announcements channel (owner not a member) | 848                | **1,682** | about six months, to the latest |

Channel A's whole history predates the previous window floor by five months — it is the channel
the owner checked in the browser and found messages in. Its Datadog post's two human replies are in bronze
too, which was the specific thing the backfill was for: when a bot message comes in and people are talking about it,
the bot should see what they are talking about. The announcements channel's records carry
`membership: "non-member"`, and a `store cite` query for its latest announcement returns it as the top hit.

## What is still owed

The full workspace backfill — all 603 conversations, from the epoch — has NOT been run. It is one command
(`slopweaver refresh --source slack`) and it is deliberately deferred: the on-device vector embed build was
mid-run on this machine when this work landed, and the two contend for CPU. Until it runs, the coverage report
will keep reporting a large, honest gap, which is the intended behaviour rather than a defect.
