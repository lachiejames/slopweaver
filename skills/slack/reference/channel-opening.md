# A top-level channel post opens with what it is and what it asks

On two drafts for a pilot channel, the bot's card opened on "Five real MFA asks from the support channel…" and the
owner said, in the owner's words, that the owner doesn't even know what the fuck it's talking about. Its readers had never heard
of the pilot. The post the owner took said what the channel was, then what the owner wanted from them; in the
owner's words, basically open with that. Review kept catching this after the fact, so it is now the form's job (doctrine rule 7).

## The declaration

A top-level post into a channel declares `opening`, and `slack draft record` REFUSES one without it, on both
`--as me` and `--as bot`:

```json
"opening": {
  "what": "a pilot of a bot that triages MFA asks",
  "asks": { "kind": "react", "text": "react on anything that feels off" }
}
```

`asks.kind` is `react`, `reply`, `review`, `decide` or `nothing`. `nothing` is a legitimate ask: say so (_"nothing
needed from you"_), so the reader knows they can stop reading. Each phrase is copied from your own top region and
carries at least two words.

## Where the words go

The top region has to carry `what`, and then `asks.text` somewhere after it. A greeting or tags may come first.
Matching ignores case, runs of whitespace and the spaces around a punctuation mark, and drops a trailing full stop from the
phrase you declared. A code run, a link label or a quote does not count, because those are not your words, and a
phrase cannot reach across one. A bold span starting mid-word reads as the one word Slack renders:

| form                  | the top region       |
| --------------------- | -------------------- |
| `drip`                | the first message    |
| `one-card`            | the first line       |
| `one-list`, `no-fold` | `lead`               |
| `update`              | `intro`, then `tldr` |

`hey @Seth @Lena, this channel is a pilot of a bot that triages MFA asks. React on anything that feels off.` passes
the declaration above. The original card's first line is refused, naming `what` as the missing phrase.

## Who it applies to

A TOP-LEVEL post (no `--thread-ts`) into a channel id that is not a DM. A `D…`, `U…` or `W…` id is a DM and is
exempt. A group DM's `G…` id declares like a channel. A thread reply is exempt: in a thread the owner drips across short
replies, and the thread already says what it is. A `finding`, a digest, an alert summary and a `plain` post have
their own top-region rules and declare nothing here.

The check runs at record and on a Codex comparison draft, never at release. A row already parked, or already
approved, sends as it is. Re-recording one asks for the declaration. When this landed, 127 of 132 parked top-level
channel rows on the draft register declared none (repro in `channelOpeningDeclared.ts`).

## What it does not prove

The schema proves the top region carries the phrases you declared, in that order. It does not prove the phrases are
a good frame. `what: "an update on things"` passes. A stranger still has to understand the post from it, and
getting that right is yours.

The criterion is `src/outbound/artifact/channelOpening.ts`. The record-time requirement is
`src/cli/commands/slack/channelOpeningDeclared.ts`. The sibling rule for a possible problem's reach is
[problem-reach](problem-reach.md).
