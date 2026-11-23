# A scheduled post goes to the owner's bot DM, and THE OWNER shares it

A scheduled card posted into a team channel that nobody asked for is spam. At the fleet's level of graduated
autonomy, the fleet posts to the owner's bot DM and the owner shares into a public channel when the owner chooses.
**If someone asked the bot to do something, that is a different story.**

[private-prompts.md](private-prompts.md) is the other half of the same rule: it puts a row's PROMPT in the owner's
DM, this page its CARD. Read the two together.

## The rule, and its one exception

**A post NOBODY asked for goes to the owner's DM.** A scheduled firing has no asker: a clock fired it. So every
recipe kind's card lands in `slackBot.promptChannel` unless the row carries THE OWNER'S recorded approval for
somewhere else. The card goes out declaring `--dm-purpose investigation-finding` (an automation prompt,
`asked-for`), because a send to `promptChannel` without one is held, and it asks the owner nothing — a question to
the owner is refused there and goes on the owner's Queue (the owner's ruling; [the card form](../../slack/reference/the-card-form.md)).

**When the owner shares one, it goes out as the bot.** A finding shared at the top level of a channel after the
owner approved its Queue card posts as the bot, not as the owner. A digest finding bound for a channel is parked with `slack draft record --as bot` and released as the
bot's post on the owner's yes; as the owner only where the bot cannot post — a DM with a person, a thread the owner is already in
(a person's, never a bot alert's), a private channel the bot is not in ([draft-review](../../slack/reference/draft-review.md)).

**A detective `finding` card skips the owner's DM altogether.** It belongs in the relevant team channel, never a DM,
and in no fixed channel — each one is parked as a queue card naming the channel and any thread (a
person's, never a bot alert's: [who-will-see-it](../../slack/reference/who-will-see-it.md)), who to tag and why, and the gate refuses it in a DM or without the owner's yes ([a finding card](finding-card.md)).

**A person's direct ask of the bot is untouched.** A Slack tag, a DM, a thread reply — somebody asked, so
the answer goes back where they asked it. Nothing in this lane reaches those, and the discriminant is
mechanical rather than a judgement: a scheduled firing's post carries its slot's own delivery key
(`recipe-slot:<digest>`, `live/automation/slotLedger.ts`), and a person's ask carries none.

## The DEFAULT is the owner's DM

A row that names no destination posts to the owner's DM, and a channel is a REQUEST. Defaulting to the conversation
the row READ (`params.postTo ?? params.channel`) is exactly the class `no-silent-fallback`
refuses. So a mistake over-posts to the owner, which the owner can ignore, never to a team, which the owner cannot un-send.

## Two gates, and neither subsumes the other

| Where                                               | What it knows                          | What it asks                                      |
| --------------------------------------------------- | -------------------------------------- | ------------------------------------------------- |
| `live/automation/postTarget.ts` — the PLANNER       | which row is firing, and its approvals | was THIS row approved for THIS channel            |
| `outbound/slack/scheduledPostChannel.ts` — the DOOR | only the slot key, which is a digest   | has ANY row on this install approved this channel |

The door asks the weaker question on purpose: `slotDeliveryKey`'s own header says the digest half "is what
keeps a raw recipe id off the wire", and putting the id back so the door could look the row up would undo a
decision that module states in prose. Each covers a hole the other has — the door is reached by a card
composed anywhere, planner or not, but only when a slot key is passed; the planner reads a `verb-run` row's
argv, but only channels spelled as argv words. Complements, exactly like `home-safety`'s two halves
(`.claude/rules/testing.md`). **Keep both.**

The planner's argv scan is a TRIPWIRE in rule 3's sense: over-inclusive by acceptance (it refuses a
`--channel` word a verb might only have read from), and under-inclusive because a verb can derive a channel
itself. **A block confirms you were wrong; its absence means nothing.**

## Recording the owner's approval for a channel

The owner says it in the DM; you write it on the row. There is no verb and no separate store: the definitions
directory IS the register, for the reason `live/automation/definition.ts`'s header already gives — a real Slack
conversation id trips `raw-workspace-id` in any tracked file, so an approval has to live under
`$SLOPWEAVER_HOME` anyway.

```jsonc
// $SLOPWEAVER_HOME/live/recipe/definitions/<row>.json
"channelApprovals": [
  { "channel": "C0TEAM", "dmChannel": "D0SYNOWNERDM", "ts": "<the message's ts>", "atIso": "<the instant that ts names>" }
]
```

`dmChannel` + `ts` resolve to the one readable message the owner said it in, so a later reader checks the approval
rather than believing it — `slopweaver slack when <ts>` derives the instant, and
`skills/slack/reference/timestamps.md` is why you never compute one by hand.

**It is a STANDING permission, which is why it is not a journalled grant.** `.claude/rules/journalled-grants.md`
says a row is one change and "a standing grant is a much larger blast radius and the owner did not ask for one".
This is the standing kind by construction — the channel stays approved for that row until somebody edits the
file — so it lives where a reader can see it beside the row it governs, not in the grants journal.

**There is deliberately NO escape hatch on either refusal, and both say so.** An override would be a
documented way to post unasked into a team channel, which is the act this rule exists to stop. Same standing as
the private-prompt rule's two refusals (`.claude/rules/error-handling.md` § "A `hold` has no hatch, and says so").

## Auditing the store

```bash
slopweaver automation run-due --dry-run           # every row's plan, every effect withheld
```

A row still aiming at an unapproved channel prints `REFUSED · … aims its card at <channel>` and reads
nothing. Every kind is subject to this, not only `investigate`: `alert-summary` through `params.postTo`,
`datadog-alert-digest` through `params.channel` (it reads probes, not a conversation, so that field was only
ever a post target), and `verb-run` through the argv tripwire. `fleet-ceiling-report` posts to Slack not at
all: its destination must be `local-page`, so each morning publishes a page on this install and
places a Queue card only when there is headroom. A broken measurement fails the firing instead, so its failure
finding is seated for repair and the owner is never asked whether to fix it.

## Where a confirmed post landed is kept per firing

Once Slack confirms a firing's post, the executor writes `live/recipe/postings/<slot-attempt>.json` — channel,
ts, the moment — which the Automations page joins to that firing (`src/live/automation/postingLedger.ts`). A failed
write is a diagnostic, never a failed firing: the post already landed. `investigate` holds the ts off its own
post's answer; `alert-summary` and `datadog-alert-digest` post through a verb that answers only an exit code, so
`src/cli/commands/automation/cardPostingNote.ts` reads the ts back off the send ledger under the firing's keyed
duplicate key, and says so rather than guessing when the ledger carries none. Every other kind's card says it
records no per-firing posting.
