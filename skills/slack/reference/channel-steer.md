# A channel the owner names moves the draft

The failure this closes: on a call the owner moved a held draft from a programme channel to the security channel.
The chair re-cut it "same channel", a seat released that into the programme channel, and it was deleted and
reposted. The draft the owner said belonged in the security channel had gone public in the programme channel.

## What a relay does with a channel the owner names

A `talk relay` whose words name a channel some draft was parked for (by name, or by id as a typed `<#C…>`), and identify one held draft — the `sd-` id the owner
says, which wins over any card on screen, else the `post:` card open — appends a `steered` event to that row in the
draft register
(`src/talk/relayChannelSteer.ts`, `src/cli/commands/talk/relayChannelRun.ts`). The chair's relay line, and the
board row's ask, then open `CHANNEL: the owner moved <id> to #<x>: re-cut it there, a release into #<old> is refused`.
Naming the row's own channel while an older steer in its lineage holds it off that channel records a take-back
steer, opening `CHANNEL: the owner took <id> back to #<x>: the earlier steer off it no longer holds`. With no transcript attached, the voice's reading is read.

A relay not stated whole (`--heard-tail cut`, or absent on a voice relay) records a steer only when it NARROWS where
the row may go, since the mis-send was a steer at the cut end of the words: away from the row's channel when no
steer governs its lineage yet, or into channels the governing steer already allows. The newest steer wins, so anything
else would lift a refusal. A take-back opens `CHANNEL: the take-back on <id> was NOT recorded, so any earlier steer
still refuses`; a steer to a channel the governing one refuses opens `CHANNEL: the steer on <id> was NOT recorded, so
the owner's earlier word for #<x> still governs` (`src/talk/relayHeldSteer.ts`).

A URL inside the owner's words names no channel: a pasted permalink's `archives/C…` id, or a channel name in a link's
path, is something the owner points at, never a destination (a relay once steered a draft to a channel off one). A steer already recorded whose whole words name its channel only inside a URL is passed
over by the fold; one whose words were cut at the bound (ending `…`) stays in force
(`src/outbound/slack/draftChannelSteer.ts`'s `channelSteerIsVoid`).

## What a release does with the steer

A release of the row, or of any re-cut of it, into a channel the LATEST steer across its lineage did not name is
refused, at resolve and again just before the send, with one re-cut command per channel the owner named
(`src/outbound/slack/draftSteerGate.ts`). The fix is the re-cut: `slack draft record <the same flags> --channel <id>
--supersedes <id>`. The steer the owner SAID last wins, by instant rather than line order, so "actually, #proj-launch-room"
moves it back and a retried older relay does not. Past only by the journalled
`channel-steered-draft` grant (`slopweaver hatch open channel-steered-draft --reason "<why>"`).

## Where the owner's words land

A relay naming a draft or channel lands on the card on screen only when that card shares one
([card landing](../../../docs/console/card-landing.md)); otherwise the row stays on the board and the chair's line
says `not landed on <card>: <why>`.

## Residue, stated

- The steer reads only channels the register already knows, so a channel no draft was ever parked for steers
  nothing: the lead says so and the chair places it.
- A link pasted on purpose to say where a draft goes ("post it where this thread is") steers nothing; the owner names
  the channel, or the chair re-cuts it.
- A relay identifying no single held draft (no id and no `post:` card, or two ids) steers nothing; it only adds the
  lead.
- A steer landing after a release's last register read and before Slack takes the message is not seen by it. A
  drip is one send for this: its messages are not re-checked one by one, because stopping after the first would
  leave half of it public in the old channel.
- A steer is dated when its relay first claimed the turn, since `talk relay` is handed no instant the owner spoke at. A
  relay that died before its claim and is retried after a later one reads as the later steer.
- A build older than the `steered` event reads such a row as unreadable and refuses to release it.
