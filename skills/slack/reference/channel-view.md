# A channel as it is now (`slack channel-view`)

What the console's channel hover window reads, what it draws, and what it keeps on disk.

It posts nothing. Give it a channel id and it reads the channel's newest page LIVE, never the corpus, because the
ask is the channel as it is now, what Slack desktop would show, images included:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" slack channel-view C0SYN123ABCD
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" slack channel-view C0SYN123ABCD --workspace acme.slack.com --json
```

**The workspace travels with the id.** A channel id is only an id within one workspace, so `--workspace <host>`
names the one the link was in, and the read refuses (`WORKSPACE_MISMATCH`) when `auth.test` says the token reads
another, before any history, name or picture of the channel is read. The console always passes it, taken off the chip's own `/archives/` link.

**One page, one picture budget.** It reads one `conversations.history` page of 30 messages up to now, and says
`earlier messages not shown` when Slack has more. It reads on the owner's USER token when the owner has one, since the owner is the
reader the window shows Slack as, and the bot's otherwise, with Slack's bot-visibility warning on stderr. The JSON
document's `readAs` (`user` or `bot`) carries that choice, and the window warns on a bot read.

**A picture is Slack's preview, never the original.** Slack desktop draws a posted picture from its preview, so
this fetches `thumb_480`, else `thumb_360`, for at most 16 pictures, the newest first. Every other file is a card
saying why it is not drawn: `not-a-picture`, `no-preview`, `deleted`, `external`, `no-access`, `past-the-limit`,
`fetch-failed` or `lookup-failed`. A Block Kit `slack_file` reference or rich-text file element is resolved through
`files.info` first, the same projector `read-thread` uses, for at most 16 files a read, newest first; one past that
is a `lookup-failed` card saying it was not looked up. A link preview's third-party picture is not fetched. A
preview past 2 MiB (`PREVIEW_MAX_BYTES`) is a `fetch-failed` card: the transfer is cancelled at the bound and nothing
is stored. Lookups and previews each run four at a time (`CHANNEL_VIEW_PARALLEL`), still assigned newest first, so a
cold read is rounds of four inside the route's 45s rather than thirty-two calls in a row. Each fetch stages in a
directory named for its own pid, and a later fetch removes one whose process is gone, which is what a killed read
leaves behind. Each message carries its reactions, emoji name and count, which the window draws under it.

**What it keeps.** Each preview is stored by its SHA-256 under `$SLOPWEAVER_HOME/live/slack/channel-media/`, owner
only (`0700` directories, `0600` files), so the console can serve exactly the bytes a read fetched. Nothing there
answers a later read: every read downloads its previews again on its own token, so a picture is drawn only when Slack
just answered THIS token for it, never a bot read drawing what a user read kept, nor a file whose access has since
been revoked. A symbolic link on the way is refused, and the console serves a blob only after re-hashing it
(`site/lib/draftMediaServe.ts`). The previews are unredacted
Slack pictures and are not cleaned up automatically, exactly like `read-thread`'s `thread-files`
([data flow](../../../docs/security/data-flow.md)).

**A row it cannot vouch for refuses the whole read** (`CHANNEL_ROWS_UNPROJECTABLE`), the strict projection
`read-thread` keeps, rather than drawing a channel with a message silently missing. A channel Slack gives no name
refuses too (`CHANNEL_UNNAMED`), since the window has to say which channel it shows.

**In the console**, `site/app/api/slack-channel/route.ts` answers only the console's own read
(`site/lib/consoleRead.ts`: a loopback `Host`, an `x-slopweaver-console-read` header no tag or cross-origin page can
send, `Sec-Fetch-Site: same-origin` where sent), so another site open in the same browser cannot spend the owner's Slack rate
limit. It spawns this verb with `--workspace` and `--json`, ONE
channel at a time, so the one child's 429 block governs every Slack call the window makes; a re-opened window joins
the running read, and a revisit within 15s gets the read that just settled, failure included, rather than another
child (`site/lib/coalescedRead.ts`, its map on `globalThis` so a dev reload cannot empty it).
`site/app/api/slack-channel-media/[sha256]/route.ts` serves the previews; `SlackChannelWindow` draws them inside
the citation chip's hover card on the Workstreams page, wide, scrolled to the newest message. A failed read is
drawn as the failure, never over an earlier reading, since that reading's pictures are not this read's.
