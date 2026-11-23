# The threads you owe — `slack owed`

`slopweaver slack owed` lists the Slack threads the owner SPOKE in during the last 14 days whose last word is
now a person's, not the owner's. It reads the local corpus and nothing else, and it **never drafts, posts or sends**.

```bash
slopweaver slack owed                         # text: one block per thread, then the residue
slopweaver slack owed --json                  # exactly one document on stdout, nothing else
slopweaver slack owed --write                 # also replace $SLOPWEAVER_HOME/live/slack/owed.json
slopweaver slack owed --now <iso> --home <dir>  # freeze the window's end; read and write another home
```

## What a row says

```text
ADDRESSED · asks a question · a direct message · Alex spoke last 2001-01-02T03:04:05.000Z
  you last spoke 2001-01-01T22:10:00.000Z
  https://…
```

- **`ADDRESSED`** — a direct message, or a last message carrying the owner's mention. **`AMBIENT`** — a channel message
  naming nobody. The document's `audience` is exactly one of the two.
- **`asks a question`** — an addressed message with a `?` in it, or an AMBIENT one with a `?` that tags
  nobody and answers the owner: under a thread the OWNER started, or from the person the owner's LATEST message
  in the thread tagged, whoever's root it sits under. A `?` tagging anybody, or in somebody else's thread from
  somebody the owner did not just tag, does not count — that is a colleague's ask in a room the owner is in. A
  separate flag (`asksQuestion`), never a third audience: "aimed at the owner" and "somebody is demonstrably
  waiting" are two claims, and collapsing them made a DM saying "thanks" read as somebody blocked on the owner.
  Both ambient halves are measured: a colleague's "what are you trying to achieve there?" under the owner's post
  read as nothing owed and sat 38 hours; a colleague's untagged "Is it fixed cost or variable cost?"
  answering the owner's sign-off tag, under a teammate's root, was never drafted.
- **`you last spoke`** — the owner's LATEST message in the thread, ordered by Slack's own `ts` rather than the
  second-resolution `tsIso`.

Rows are newest last word first, `nativeId` (`<channel>:<threadTs>`) breaking a tie.

## One detector, shared with `session-start`

The selection is `slackOwedThreads` in `src/sessionStart/slackLeg.ts` — the same filter `session-start`'s
movement leg ranks, over the same streaming reader (`src/cli/commands/sessionStart/slackRead.ts`). The two
cannot disagree about which threads qualify: a person spoke last, and the row is complete enough to link.

A reply sent "also to the channel" is read in its thread only. Slack stores a second, top-level copy, and read as a
thread of its own it was a phantom: a tag the owner had already answered in the real thread, owed again (fixing it moved both this verb's and `session-start`'s counts).

## The residue, printed on every run

Every document carries `coverage.residue` as data, and the text rendering always ends with it, zero rows
included:

- the rows are the corpus's own copy, 14 days back, and **nothing was re-read live** — somebody may have
  replied for the owner since the last Slack resync;
- only threads the owner spoke in inside that window qualify;
- a record with no author field at all — a file share, a huddle, a canvas — is nobody's word, so a reply posted
  that way is not seen;
- **a DM the owner never answered is invisible** — the reader reaches a thread only through a message of the
  owner's;
- threads that tagged the owner and the owner has not spoken in are counted and NOT listed — `slack tagged`
  ([tagged](tagged.md)) lists every tag;
- threads whose last word is a bot, an app or Slackbot are excluded, with their count.

Gmail is not read here; its conversational leg stays in `session-start`.

## Unavailable is never an all-clear

A read that could not see — `profile.json` declares no `slackBot.ownerUserId`, or a corpus file is
unreadable — is `status: "unavailable"` with zero threads, its reason first in the residue, the text
rendering opening on `UNAVAILABLE`, and **exit 1**. A read that ran but met a line it could not parse —
in a thread it follows, or carrying the owner's id — or a thread a person spoke last in that could not be listed, is
`status: "incomplete"`: it lists what it could read, names
the lost lines first in the residue, opens on `INCOMPLETE`, and also **exits 1**. A home with no Slack
corpus at all is a complete, empty read (exit 0). A bad flag or an unparseable `--now` exits 2.

## `--write` is local persistence only

`--write` atomically replaces `live/slack/owed.json` (the path is `stateHomePaths(...).live.slack.owedJson`)
with the same document `--json` prints; a failed write leaves the previous file standing and exits 1. Under
`--json` stdout stays one parseable document; the text rendering ends `written: <path>`. The document's strict
schema and `parseSlackOwedDocument` live in `src/live/slack/owedDocument.ts` — a reader validates the bytes,
never casts them.

The standing row `slack-owed-daily` runs `slack owed --write` at 08:55 daily, SEATED as kind `owed-reply`
([declared-rows.md](../../automation/reference/declared-rows.md)).

## It never drafts or sends

This verb READS. An unasked Slack reply to a person is a **queue card with its draft attached**, drafted in a
visible session the owner can watch (rule 2) — never an act of this verb, and never a send on the owner's
behalf. That session is the `slack-owed-daily` seat: every `asks a question` row gets one parked reply as the
owner, or a named reason it
has none ([owed-reply](../../automation/reference/owed-reply.md)).
