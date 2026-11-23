# What is unread — `slack unread` and its drill-in `talk slack-open`

The owner's ask: while the owner is away, the voice fetches the gist of the owner's unread DMs first, then the
owner's unread Activity, as one line each — channel, people, a one-line quote, the reply count — and opens ONE
thread whole when the owner names it, so it can ask the owner to decide A or B. Progressive disclosure: the list never reads
a thread unasked.

```bash
slopweaver slack unread [--days 3] [--json]        # the list, live on the owner's user token
slopweaver talk slack-open --url <row's link> [--json]   # one row, whole
```

Both are on the voice's tool list as `slack_unread` and `slack_open` (`src/talk/slackToolSchemas.ts`), and both
read only. On a call, a `slack_open` of a thread other than the one the call last put in front of the owner says so
([once per call](../../../docs/console/voice-reads-a-slack-thread.md)).

## What "unread" means, exactly — and what it never claims

- **A DM is unread by Slack's own read marker**, the one the owner's sidebar shows. `conversations.info` on the USER
  token carries `last_read`; a one-to-one DM also carries `unread_count_display` and `latest`. A **group DM**
  carries `last_read` only — no count, no `latest` — so the verb reads its history past the marker and lists
  what a person said there (measured on the owner's workspace; `src/live/slack/readMarker.ts`).
- **Only a DM with a message in the last seven days is checked**, found by the `is:dm` and `is:mpim` searches,
  up to 64 — a conversation shaped like a DM (a `D` id, an `mpdm-` name) ahead of the rest, then newest first.
  The owner's workspace named 53 over seven days when measured. A DM unread from before then is not seen, and the
  residue says so. `is:mpim` also matches private channels; those are passed over, never listed as a DM. Past
  the marker the newest 100 messages are read; more than that is named.
- **A reply under a DM message is read too.** The read marker counts only top-level messages, so a reply in a
  DM thread moves no count and no history read sees it. The same two searches do: up to eight such threads a
  person replied in are opened whole and listed as "a DM thread", news from the owner's last word there or, if the
  owner never spoke in it, from its root.
- **An activity row is NOT "unread".** Slack exposes no thread read state on any token this install holds, and
  `client.counts` refuses the user token (`not_allowed_token_type`). So a row is a thread the owner spoke or a
  PERSON tagged the owner in, over `--days`, where a person has spoken since the owner's last word there —
  `slack tagged`'s own judgement of the same two searches — and says whether it **asks** the owner, **names** the owner,
  or is for the owner's **information**. The voice never says the owner has not seen one.
- **A short read is never an all-clear.** The verb has a 15-second deadline inside the voice's 20; whatever did
  not answer in time is named in the residue and the status reads `incomplete`. A short read that still lists
  rows exits 0 — the voice's runner throws away a failed verb's whole stdout — and one that lists nothing exits 1,
  its status and residue repeated on stderr so the voice hears why.
  "Nothing unread" is said only off a complete document. A cap that leaves something unopened — 64 DMs,
  eight DM threads, 24 activity threads, 100 messages past a marker, or a row past the 10 DMs and 12 threads
  the list shows — makes the read `incomplete` and names what it skipped; a cap is never a quiet bound. So does
  a conversation whose `conversations.info` answer names no DM flags: only Slack's own `false` passes one over.

## The drill-in

`talk slack-open --url` takes a row's own link, never a composed one. In a channel a thread comes back whole,
its opening message always kept and the newest replies WHOLE inside 18 KiB — the first that does not fit cut and
named in `cut`, never a fixed per-message cap — and a lone message comes back alone. In
a DM the linked thread comes back whole AND the conversation around it — four messages before, the linked one
kept as the opening, up to 50 top-level messages after; past 50 the newest are read and a warning says some
between are missing — because a DM row links its OLDEST unread, which may have started a thread while the
question came later. People are named from the local member rows (`src/talk/slackOpen.ts`). Whether it is a DM
is asked of `conversations.info`, never guessed from the id; when that, or the DM's history, cannot be read,
only what the link names comes back, with a warning saying why.

## Pacing

`conversations.info` passes `paced: false` to `safeProviderCall` (`src/corpus/slack/api.ts`): the default
spacing for the `slack:tier3` class put ~1.5 s between reads and a 40-conversation check never finished in the
deadline (measured: 16 s with almost nothing checked, against ~9 s whole once unpaced —
`time slopweaver slack unread`). A new Slack read on the voice's path needs the same.
