# High-stakes channels: a finding card, one a day, or nothing

A channel many people watch is **high-stakes**, and a fleet top-level post into one is refused unless it is
defensible on its face. A channel many people look at is high stakes in terms of keeping the signal to noise
ratio tight, so a post there has to be very defensible. Four fleet posts in a row in such a channel were wrong
for it entirely and were all deleted.

## Which channels

`profile.json` names them, per install, because a channel id is one install's own:

```json
{ "slackHighStakes": { "channels": [{ "id": "C0SYN000003", "name": "#defects" }] } }
```

A send is matched by id or by name, with or without its `#`. A profile that cannot be read refuses every
top-level post, rather than reading as "no channel is high-stakes". A home with NO `profile.json` refuses every
send to a channel, top-level or reply, and lets a direct message (`D…`, `U…`, `W…`, `@handle`) through: it names
no list at all, and read as an empty one, `--home $(mktemp -d)` would walk past the whole gate.

## The two refusals

Both read a TOP-LEVEL post only. A reply inside an existing thread is conversation and is never gated — but a
`--thread-ts` counts as a reply only when it names a real top-level message in that channel, read live; one that
names nothing, or cannot be read, is judged as the top-level post it would become.

- **Undefended** (`high-stakes-undefended`). The defensibility block is the `finding` form
  (`src/outbound/artifact/finding.ts`), which will not parse without: nobody tracking it (`tracking.none`), the
  member-facing impact and its unique-user blast radius, a system-of-record view plus three screenshots, at least one
  option, and nobody having raised it before (`priorThread.none`). So a top-level post there is a `finding` bot
  card, and every other shape is refused — every `--as me` post included, which has no finding form. A draft is
  refused at `slack draft record` too, so nothing is parked that could never release.
- **Second post** (`high-stakes-second-post`). A second fleet top-level post there inside 24 hours is refused,
  citing the first. It counts POSTS, not sends: an as-me `--shape top-level` drip of three messages is three
  top-level posts, and is refused before anything is read. The fleet is every identity the install posts as (`slackBot.ownerUserId`, `botUserIds`,
  `selfUserIds`, plus the send token's own `auth.test` user), read LIVE from `conversations.history`: a post from
  any path counts, and a deleted one does not. An unreadable history refuses, and so does a profile naming a
  high-stakes channel without both `ownerUserId` and a bot id, since it cannot count the posts it leaves out.
  Two sends reading the same empty day would both pass, so right before a LIVE send each lane asks again and
  TAKES a claim first: it writes its own file under `ledgers/high-stakes-claims/<channel>/`, then lists the
  directory, and any other claim still standing refuses like a post already there. Of two sends racing, the
  later to list always sees the other, and a claim is only ever removed by the send that wrote it or once it
  no longer stands. It stands while the process that wrote it is alive, up to a day, since a rate-limited read
  or a sleeping laptop can outlast any clock, and in any case for ten minutes from when it was taken, by when the post is
  in the history. It is dropped at once only when the day it read refused the send. A send that failed after
  taking it holds the channel for those ten minutes, and the second-post hatch is the way past.

The finding form's own destination rule (`src/outbound/slack/findingDestination.ts`) admits a finding only as a
draft the owner approved, so no fleet top-level post reaches a high-stakes channel without the owner's word. A
bugs channel is never a finding's destination.

## A finding posts as the bot, in the channel of the team that owns it

- **The bot's name, never the owner's.** A finding the fleet found and the owner approved goes out top-level `--as bot`. The bot found it, and the owner has
  often not verified the finding. Under the owner's name it reads as the owner's verified claim. As-me stays where the bot cannot post (a DM with a
  person, a private channel the bot is not in) and for a reply in a thread the owner is already in, a person's
  and never a bot alert's (`src/outbound/slack/findingIdentity.ts`). A card offering an as-me top-level channel finding is re-cut.
- **No fixed channel, a judgement per finding.** Who owns it, whether that team has a bugs or team channel, which
  subteam to tag and why — the way the owner would judge it, on a queue card carrying the draft, the channel, any thread
  (one a person started, never a bot alert's: [who-will-see-it](who-will-see-it.md)) and who to tag. A conversation started in the wrong channel costs trust with everyone who reads it.
- **Read the channel before any send**, and never release a draft whose successor already went out: a stale draft
  released after its replacement is a public double post.

## The owner's word

Both hatches are journalled: `slopweaver hatch open <id> --reason "<why>"`. The legitimate exceptions are the
ones on each row in `src/hatch/slackPostHatches.ts` — the owner approved this exact post for this channel, or asked for
it in so many words. A clock, a recipe or a session's own judgement is none of them.

## Every lane that can put words at the top level

`slack post --as bot`, `slack post --as me`, `slack draft record` and its release, and `slack poll` (a poll is
never a finding, so it is always refused there) all ask both refusals. `slack edit` asks the undefended one of
its TARGET: re-rendering a top-level message in a high-stakes channel as anything but a finding is refused on
both `--as bot` and `--as me`, since an edit can turn a defended post into any other shape. Editing a reply is
not gated.

A reply is exempt only while its thread is real, and the write transport itself holds that line
(`src/corpus/slack/writeGuardHighStakes.ts`, composed around every live transport). Every reply into a
high-stakes channel is read back first. One whose thread Slack does not confirm as a top-level message there,
or cannot read, would land at the top level and is refused before the wire, from any lane, a hand-edited turn
brief included. The channel list it judges by is the profile in the home the SENDING lane resolved, never the
ambient one: `makeSlackWriteTransport` takes a required `home`, so a `--home` lane is judged by its own list. A
turn frame edit of a top-level message there is refused too. `turn brief` asks the same
question up front (`src/cli/commands/turn/briefHighStakes.ts`), so a bad `--thread-ts` is refused before any
brief is written, rather than at the first post.

The policy is `src/outbound/slack/highStakesChannel.ts`; every lane asks it through
`src/cli/commands/slack/highStakesGate.ts`, with its live reads in `highStakesRead.ts` and its claim in `src/outbound/slack/highStakesClaim.ts`.
