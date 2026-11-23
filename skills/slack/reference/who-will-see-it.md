# Every draft names who will see it

A draft reply as the owner under a monitor's alert in an alerts channel tagged nobody. Posted as it was, no one would
ever see it: it replies to a bot, tags no one, in a channel that already gets a lot of noise and where alerts go
unanswered, so the investigation behind the draft would have been wasted.

## The rule

Before `slack draft record`, name the person or team who will actually read the message, and make the draft reach
them: a tag, a DM, or a thread they are already in. Say who in the `--why`, so the owner's yes approves the audience as
well as the words.

**A reply into a bot alert thread with nobody tagged is not a shape.** An alert's thread is nobody's thread: no
person started it, nobody is notified by a reply in it, and in a noisy alerts channel nobody scrolls back to it.
"A lead somebody already raised belongs in THEIR thread" ([the hunt](../../automation/reference/organisation-hunt.md#a-ticket-is-not-a-fix))
means a thread a PERSON raised it in, never the bot's own alert. The one reply that does belong under an alert is
one owed to a person who asked the owner there (`slack-owed-daily`): tag that person, because they are who will see it.

**This is judgement, not a gate.** Neither `slack draft record --thread-ts` nor `src/outbound/slack/findingDestination.ts`
reads who wrote a thread's root, so nothing refuses the shape; the composing session does.

## When the owner is unknown

Message the team asking who could pick it up. The owner does not know who the right owner is, but knows which team
should know: say it is for their information, that the owner does not know who it goes to, and share what the owner
found with the receipts, to do with as they will.

- **A top-level post in the channel that team reads**, tagging the TEAM's user group, never an individual unless a
  thread already names an owner. An `ask-*` intake channel is built for exactly this. Find the channel and the
  handle in the Slack corpus (`slopweaver store groups --term <topic> --shape wild-both --facet container`, then
  who tags whom there).
- **Enablement, never assignment**: ask only for a little of their attention, and they decide whether this turns
  into work. Say what you saw, what the impact might be with a hedge, and leave the
  confirming to them. Leading on "this is failing, this many affected, here is the fix" reads as joining their
  team and doing the work, and gives them nothing to reply to.
- **The receipts ride with it**: the system-of-record link and its picture (`--media`), exactly as any draft.

The worked example: the same facts as the alert-thread draft, posted top-level in an `ask-*` intake channel to the
team's user group, asking who would be best to look at it.
