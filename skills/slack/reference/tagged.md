# Where the owner was tagged — `slack tagged`

`slopweaver slack tagged` lists every recent Slack message where a PERSON tagged the owner, newest first, each
with its permalink and whether the owner has spoken in that thread since. It **reads and never drafts, posts or sends**.
It is the verb for "search Slack for recent messages where I was tagged": `read-thread` needs a thread already,
`listen` watches the BOT's tags, and `owed` lists only threads the owner spoke in.

```bash
slopweaver slack tagged                        # the last 7 days, corpus then live search
slopweaver slack tagged --days 14 --json       # exactly one document on stdout
slopweaver slack tagged --corpus-only          # no live search; the recent tail is then not listed
slopweaver slack tagged --now <iso> --home <dir>
```

## Two legs, one row per message

- **The corpus first**: one streaming pass over Slack bronze, keeping every message whose authored text carries
  a mention run of the owner (`tagsOwner`), deduped on the message's own `channel:ts` (`messageKeyOf`) — overlapping
  window files hold several copies of one message.
- **Then a live search** on the owner's USER token: `search.messages "<@owner> after:<day>"`, every hit re-judged
  locally (a mention run of the owner, not the owner's own message, inside the window), and a second search
  `from:<@owner>` for the owner's replies. The token's `auth.test` user must be the profile's `slackBot.ownerUserId`, or the live leg does not
  run — its search would be somebody else's view.
- A message both legs found is one row marked `both`. MEASURED on the owner's home
  (`slopweaver slack tagged --json | jq '.rows | group_by(.source) | map({(.[0].source): length})'`): 45 rows,
  all 45 `both`, 19 s wall for the whole run.

## What a row says

```text
2001-01-01T00:00:00.000Z · A Colleague in #dev · no later word from you in the thread up to <iso>
  @Ada Owner can you look at this
  https://…
```

`answered` is `true` when a later message of the owner's sits in the same thread — or anywhere in a one-to-one DM —
seen in either leg; `false` only for a corpus row, meaning no such reply up to that row's own `answeredThroughIso` —
the earliest of its channel's crawl cursor, the corpus's newest message and `--now` — which every `false` prints, or
says is unknown when the channel records no cursor. A reply after it is seen only when live search returns it; `null` for a row live search
alone found with no reply seen, because search collapsing nearby hits means not finding the owner's reply proves nothing.
A reaction is not an answer here, and a tag later edited out of its message may still be listed. The rule is stricter than `session-start`'s mention rows (which drop a thread the owner
spoke in at all, before or after the tag), so the two counts do not match and are not meant to.

## Unread state is not exposed

**Neither the corpus nor Slack's search says whether the owner has SEEN a message**, so every tag is listed read or
not. This is the residue's first line on every run, zero rows included — say so plainly when asked about
"unread" tags rather than implying the list is one.

## The residue, and why a partial read exits 1

The residue also names how far the corpus reaches (the pooled watermark capped by the furthest channel cursor,
since an empty fetch banks tomorrow's date as the pooled value; still an upper bound, since one channel may lag it), whether the live search ran and read every page, that search collapses nearby tags, that a
group mention (`@here`, `@channel`, a user group) is not a tag of the owner, and how many tags a bot, app, Slackbot or
Slopweaver wrote — excluded, like the DLP app that tags the owner on every alert.

`complete` exits 0. `incomplete` — a corpus line carrying the owner's id that did not parse, a corpus with no watermark
or no per-channel cursor, a listed tag in a channel with no cursor of its own,
a Slack members index absent or unreadable (a bot could then be listed as a person), no user token, the wrong user's token, or a search that stopped at its page bound — still lists every row it has
and exits 1. `unavailable` — no `slackBot.ownerUserId`, an unreadable corpus, or a home with no Slack corpus file
at all — lists nothing and exits 1. `--corpus-only`
skips the leg that reads the tail after the corpus's newest message, so it exits 0 only when the corpus already
reaches the run's instant (`--now`); any unread tail, a minute or a week, is incomplete and exits 1. Where the
corpus BEGINS is not checked — a corpus backfilled for fewer days than the window says so in its residue, never in
its status. A bad flag exits 2.

## One message: has the owner replied since — `slack replied`

```bash
slopweaver slack replied --url <slack-message-link> [--json] [--home <dir>]
```

Reads the link's whole thread LIVE (a reply link reads its root's thread; a bare reply link is followed to its root
once) and answers whether a message of the OWNER'S — `slackBot.ownerUserId` — sits strictly after the one the link names,
Slack `ts` against Slack `ts`, so the anchor itself never counts even when it is the owner's. In a one-to-one DM the
conversation after the message counts too, since there the owner answers at the top level. Three answers, never two:
`replied at <iso>: <reply link>` exits 0; `not yet: …` exits 3; `could not check: <why>` on stderr exits 1 — no
token, no owner id, a thread that would not read whole, or 14 s without Slack answering. It is the done-check
`handover register` writes onto an ask anchored to a Slack message, and the read `handover currency` makes
in-process for the Queue card's mark ([verifying a doc](../../handover/reference/verifying-a-doc.md)).
