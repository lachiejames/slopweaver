# One channel, live — `talk slack-channel`

The owner's ask: "read this Slack channel" looks at the owner's screen, names the channel and reads it, with no id
asked of the owner. The Slack desktop app shows a channel's NAME and no address, so the name is the
ordinary input.

```bash
slopweaver talk slack-channel --channel '#squad-web-platform' [--max-bytes <n>] [--json]
slopweaver talk slack-channel --channel https://acme.slack.com/archives/C0SYN123ABCD --json
```

On the voice's tool list as `slack_channel` (`src/talk/slackToolSchemas.ts`). It reads only: nothing is written and
no attachment is fetched.

## What it reads, exactly

- **The newest 50 top-level messages**, one `conversations.history` page, oldest first, each with Slack's own reply
  count and its permalink. No reply is read: a thread is one `talk slack-open --url <permalink>` away. The answer's
  first sentence says how many it kept, how many replies went unread, and whether older messages exist, so a window
  is never called the whole channel. Inside 16 KiB the newest are kept and the older ones dropped are counted.
- **A name resolves live and exactly, or not at all.** One complete walk of the channels-and-DMs lane at 1,000 a
  page (a few pages and a few seconds for hundreds of conversations, measured — the command is in
  `src/live/slack/channelPagination.ts`). One exact match, case-insensitive with its `#` removed, is read; two are
  refused as ambiguous; none is refused with up to five nearest names. A near name is never read in its place.
- **A link or id skips the walk** and is checked by `conversations.info`, which names it: `#name`, a DM with the
  person in it, or a group DM. A DM is readable by its link or id only; the name in a DM header is a person, not a
  channel.
- **The token is the one `slack read-thread` picks**: the user token, else the bot token with a warning — the bot
  sees no private channel it was not invited to, and a not-found on it says so.
- A 14-second deadline inside the console's 20-second tool kill, so a slow Slack is refused with a reason.

## Older than the window

The corpus: `store query --source slack --channel <the id slack-channel returned>`, hours behind, saying how current
it is.
