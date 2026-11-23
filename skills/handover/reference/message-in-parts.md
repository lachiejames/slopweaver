# A drafted message in parts — `followUps`

An owner can want two messages: one clarifying a position and a second adding another example. The ask's
Slack action held one `body`, so both went on the card as one body with a blank line between them — and the
card previewed, and its command would have posted, ONE message where the owner wanted two.

So a message that goes out in parts is several messages, never one body. The action
([ask-shape.md](ask-shape.md)) carries an optional `followUps`, each part after `body`, in order:

```json
{
  "version": 1,
  "actor": "me",
  "body": "<@U…> to clarify my angle: …",
  "followUps": ["In addition to that one, here is a second example …"],
  "mentions": [{ "label": "Rosa", "userId": "U…" }],
  "destinations": [{ "kind": "thread", "channel": "C…", "threadTs": "…", "label": "…", "tradeoff": "…" }]
}
```

## The rules, all in `src/handover/askAction.ts`

- **At most `ACTION_MAX_FOLLOW_UPS` (two)**, so three messages in all: past that it is a thread of the owner's
  own, not a reply. A present, EMPTY list is refused — omit the field for one message, so the wire has one spelling of it
  and every line recorded before the field existed reads back byte-identical.
- **Each part is capped as a message of its own** — words, characters, lines — and a refusal names which
  follow-up broke.
- **Every part's `<@U…>` tags count against `mentions`**: a tag in the second message notifies too.
- **A `channel` destination beside follow-ups is refused.** Several top-level posts in a channel are one wall in
  halves, against the voice rule of one top-level message in public; a thread or a DM is where the owner drips across
  short replies, so offer one of those.

## What each surface does with it

- The console card (`SlackActionPreview.tsx`) draws each part as its own Slack message, ruled off from the one
  before, and its heading counts them.
- The command printed under each destination (`site/lib/askAction.ts`'s `sendCommand`) sends each part on its
  own, in order, over its own heredoc, chained with `&&` so a failed first send stops the rest — a second
  message landing without the first it follows on from reads as a non sequitur in the room.
- A follow-up that will not read invalidates the WHOLE action at the console (`readAction.ts`), the same
  all-or-nothing rule destinations follow: a surviving subset would preview two messages of a draft that is three.
- An older build's strict wire schema reads a line carrying `followUps` as unreadable — drawn as a mark, no
  command — rather than dropping the second message silently.
