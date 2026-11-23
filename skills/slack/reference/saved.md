# `slack saved` — the owner's own Later list

```bash
slopweaver slack saved [--json] [--settle <ms>] [--home <dir>]
```

Reads the owner's Slack **Later** (saved-for-later) list: one row per item, each a conversation, a `ts`, the
list's own state, its due and saved instants, and a permalink. **Never the message text** — read an item
deliberately with `slack read-thread <permalink>`. Exit `0` only for `read`, an empty list included.

## Why it drives the owner's Chrome rather than calling the API

MEASURED with `slack probe --method stars.list`: the owner's user grant already holds `stars:read`, and the
answer is starred CHANNELS (3 of 3 rows `type: channel`). Later is not on the published Web API. The web client
reads it through an internal `saved.list` call, which the atlas records with `publicSurface: false`.

So the verb opens `/later` in the owner's own Chrome through the Playwright relay and keeps the one response the
client fetched for itself. It is a door verb in rule 3's sense — _a `slopweaver` verb driving the owner's Chrome IS
the door_ —
and it is as narrow as that allows:

- no request is replayed, no cursor followed, nothing clicked, scrolled or typed;
- `photograph: false`, and the atlas row (`SLACK_LATER_SURFACE_PAGE`) refuses a picture of `/later` anyway;
- bodies are read in memory and never written; no grant is issued to the visible session. What it writes is
  the relay kit's shared machine state (the Chrome pin, the relay lease under the state home) and a scratch dir.

## The lease names the ENTERPRISE host on a grid

MEASURED by listing every response one load made: on an enterprise grid the client POSTs to
`https://<enterprise_domain>.enterprise.slack.com/api/saved.list`, not the team origin. A lease naming only the
team origin dropped the call and the read came back empty-handed. `slackClientApiOriginFromStructures`
(`src/atlas/slackApi/clientRoots.ts`) reads `enterprise_domain` off the `org` structure row's `team.info`.

## What a read can and cannot say

- **First load only.** The client asks for the newest open items. A non-empty `next_cursor`, or `counts.total`
  or any one state's count above the rows returned in it, prints a `GAP` line. The first measured read held 15
  of 26 open items.
- **One unrelated body is lost on every load** (measured, every attempt): a kept, valid `saved.list` is still
  `read`, with the loss stated in `because`. With no `saved.list` kept, a lost body is `capture-incomplete`,
  never `not-observed`.
- **A drifted shape is refused by name** (`response-invalid`): every object is strict, so a field Slack adds
  names itself in the message.

## Never act on an item

The list is the owner's. Reading it is the grant; marking an item done, snoozing, moving or unsaving it is not,
and no verb here can. A proposed next step goes on a page and a Queue card, and waits for the owner's word.
