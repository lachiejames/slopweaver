# The voice reads the channel on the owner's screen, and never asks the owner for its id

The owner asking for "this channel" already has it open: the channel's name is on the screen the voice can see. A
voice that finds the channel missing from the store and asks for its id makes the owner do the work the screen
already did. So the voice says which channel it sees, calls whatever reads it needs, and summarises the history back,
with no id, link or number asked for.

## The rule

- **"This channel", "this thread", "this PR" is the one on the owner's screen.** The voice hands a look over (or uses
  the frame the console already put into the turn), says which one it sees ("You're in #squad-platform"), then reads
  it. It never asks the owner for an id, a link or a number.
- **A channel is read by `slack_channel`** with the name the frame shows. The Slack desktop app shows a channel's
  name above its messages and no address, so the name is the ordinary input; a link or an id another tool gave is
  taken too.
- **A thread the Slack app shows no link for** is found through its channel: `slack_channel`, the opening message
  matched by its words, then `slack_open` on that message's link. Not there means asking the owner to copy the link.
- **A pull request** is `verb` with `github read` and the repository and number the frame shows.

## What "the whole channel" means here

The newest 50 top-level messages, read live, each with its reply count and link, inside 16 KiB. Every reply would
be one more call per thread and cannot fit the console's 20-second tool deadline on a busy channel, so the answer's
first sentence says how much it read and whether older messages exist, and a thread is one `slack_open` away.
Asked for the replies too, it opens at most the three busiest threads, then answers and offers the next.
Older history is the corpus, hours behind. The verb, its resolution and its token: [the Slack skill's channel
reference](../../skills/slack/reference/channel.md).

## Why a dedicated tool, not a `verb` read

The handover asked for a `MODEL_READS` entry. The thread rule showed why not: a generic `verb` route reached the
right read **0 of 16** times on the owner's words, and a dedicated tool with a strong description **16 of 16**
([the replay](voice-reads-a-slack-thread.md#the-replay)). One operation gets one model-visible route.

## Where the rule lives

- `src/talk/slackToolSchemas.ts`: the `slack_channel` tool, running `talk slack-channel`; `site/lib/talkToolsList.ts`
  its argv.
- `src/talk/screenLookLines.ts`: the screen-referent line in both prompts.
- `src/talk/slackReadLines.ts`: the channel route, which replaced one sending a channel to the corpus by an id off
  the owner's screen, and the thread-without-a-link route.
- `src/talk/slackRouteCases.ts`: synthetic eval cases for the channel asks, held to the prompt by `unit/talk/slackRouting.test.ts`.
- `src/talk/slackChannel.ts`, `slackChannelAddress.ts`, `slackChannelErrors.ts`: the read; `slackChannelAnswer.ts`
  shapes the page it fetched.

## Measured

The verb on the owner's workspace through a worktree's CLI: `#squad-platform` refused as not found in 4.6 s,
naming `#squad-web-platform` first among five near names; `#squad-web-platform` read in 5.6 s — 50 fetched, 41 kept
inside 16 KiB, 9 older counted as left out, 206 replies counted and not read, older messages said to exist.

## The replay

The owner's two turns (asking for a whole Slack thread, then for the whole channel off the screen) through the voice surface's real delegated thread — `talk offer --json`, one text turn each, every Slack
tool answered by the real verb against the owner's Slack, `read_screen` answered by a text stand-in naming `#squad-web-platform`
open with no thread selected. Two runs of the channel turn alone and two of both turns in order, before and after the
thread bound and the never-relay line:

| Run                    | Before                                                                     | After                                                                |
| ---------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| channel turn alone ×2  | `slack_channel`, then `relay_steer` "read the full channel" twice, 34–36 s | `slack_channel`, named back, answered, 14.5–16 s                     |
| thread turn, in order  | `slack_channel`, named back, asked which message ×2                        | the same ×2, 13.5–14.5 s                                             |
| channel turn, in order | `slack_channel`, then 18 and 19 `slack_open`s, unfinished at 240 s         | three busiest threads by `slack_open`, next one offered, 17.5–18.5 s |

Every channel turn, before and after, called `slack_channel` first with the name off the frame and never asked the
owner for an id. The relay came from `talk capabilities slack` naming no channel read and routing "the rest" to the
supervisor; `slack_channel` now stands in for part of `slack read-thread` beside `slack_open`.

## Still open

- **The live check with the owner**: "read this Slack channel" on a call, a channel on the owner's screen. The replay
  is the owner's words over text turns, not the realtime voice handing a turn off on a call the owner is on.
