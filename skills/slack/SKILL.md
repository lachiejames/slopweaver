---
name: slack
description: Post to Slack from the world model — a schema-enforced card as the bot, or a freeform post under the owner's own name — previewed and gated before sending; read which followed threads now have somebody else's last word; and list the recent messages that tagged the owner. Use when the user asks to send, post, announce or share something in Slack, or to reply in a thread as themselves, or to set their own Slack status or presence, or asks which Slack threads they owe a reply in or are still waiting on, or where they were tagged recently. Phrases like "where was I tagged", "who mentioned me", "search Slack for messages tagging me", "post this to Slack", "send it to the team", "announce this", "reply as me", "set my Slack status", "mark me away", "which Slack threads do I owe", "threads I'm following", "who spoke after me", "nobody replied to me", "threads waiting on others".
argument-hint: "[what to say and where]"
---

Post to Slack from the world model, through the door. There are **two lanes and they are different
artifacts** — pick with `--as`, which is required and has no default:

|            | `--as bot`                                  | `--as me`                                        |
| ---------- | ------------------------------------------- | ------------------------------------------------ |
| what it is | ONE schema-enforced **card**                | a **drip**: several short messages               |
| chrome     | wrapper + author row, or **none** (no-fold) | none at all                                      |
| citations  | yes                                         | **never** — a human does not footnote themselves |
| media      | `--media` — attaches to the card            | `--media` — attaches under the LAST message      |
| token      | `xoxb` bot token                            | `xoxp` **user** token                            |

**Never post a bot card under `--as me`, and never simulate the human lane by writing a card that reads
as though the owner typed it.** A reader seeing the owner's avatar over a robot-labelled card is the failure this
split exists to prevent. A channel finding is the bot's: `slack draft record --as bot` ([why](reference/draft-review.md)).

The bundled CLI is `"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver"` (also on PATH as `slopweaver`).

## The contract you are working to

You fill in a **form**, not a message, and the bot lane has a REGISTRY of five (`BOT_FORM_KINDS`): the CARD,
the no-fold one ([reference/the-no-fold-form.md](reference/the-no-fold-form.md)), and three that DERIVE a card.
Layout, colours and block structure are never yours to pick, and hand-writing Block Kit is never correct.
**Never claim a message does not fold from a preview or a count** — only `slopweaver slack shot` answers that.

**Every text field is PLAIN TEXT.** Markdown is inert inside Slack's `rich_text`: writing `*important*`
renders literal asterisks. Emphasis is structural — set `"bold": true` on a text run. The one marker the
renderer honours is a line opening `> `, drawn as a quote (never in a code run). `--dry-run` warns if wrong.

## The form

The CARD (`{"kind":"update"}`) is one JSON object — `tldr`, an optional `primaryLink`, a required non-empty
`detail` of typed blocks, `citations` and `media`. **Read [reference/the-card-form.md](reference/the-card-form.md)**
before composing one: every field, every rule the schema enforces, and § The form kinds, which says which
kinds derive a layout rather than take one. Four of those rules decide whether a send is possible at all:

- **A text run never carries a raw link or a raw mention.** `rich_text` does not parse a text run, so a bare
  `https://…` renders as dead prose and a `<@U…>` shows the reader a user id. The form CONVERTS a bare URL,
  a `<url|label>`, a `<@U…>` and a `<!here>`/`<!channel>` into the typed run at composition, and the send
  door REFUSES any payload whose text runs still carry one — so a hand-built payload cannot slip past.
- **`<#C…>` is REFUSED**, not converted — name the channel in prose. `<!subteam^S…>` IS converted, into the
  `group` run: a Slack user group by handle, refused before any send if disabled, empty, named or ambiguous.
- **`tldr` is a plain string with nowhere to put a link**, so a URL in it is refused — `primaryLink` is
  where the one canonical link goes.
- **Never write a bare PR number or ticket key, nor a ticket key in code — always a link.** `#<n>` and `ABC-1`
  resolve into a `link` run wherever the repo or Linear workspace is unambiguous, a key that is a whole `code` run
  included; one it cannot resolve, or one inside a longer code span, is REFUSED rather than sent.
  the `bare-refs` hatch is the journalled break-glass; the rule covers `--as me` and `edit` too.

## Who you can mention

Mentions resolve through three layers, strictest first: the store's identity roster (a human
CONFIRMATION, always wins), the **member index** Slack's own `users.list` fills, and last the roster
`slopweaver derive` writes. **A mention names a PERSON, never `<@U…>`, and resolves by exact match** — an
unresolvable person is a hard error before anything is sent, not a guess; only a heard-as pin in the identity roster routes a miss.

What each layer takes, why a display name and a GitHub/Linear handle are never addressable through the
roster, and the four refusals the member layer raises are in [reference/mentions.md](reference/mentions.md).

## How to run it

0. **Confirm the lane you want can actually send:** `slopweaver connect slack --check` probes the `xoxb` (`--as
bot`) and the `xoxp` (`--as me`) SEPARATELY, and fails loudly if yours is absent, the wrong kind, or dead.
   Tokens: `slopweaver secrets set slack-bot-token` / `slack-user-token` — echo off (`--stdin` from a script).
1. **Ground the content in the corpus first.** Use `slopweaver store read` / `store cite` so the card says
   something true, and cite what you can. Never invent a number or a link.
2. **Always `--dry-run` first** and show the operator the rendered plan. The dry run prints the card as a
   READABLE preview — proof-read the wording, check where the bold lands, check what sits above the fold,
   and read the warnings out.
3. Only after they approve, run it for real. Pass the form on **stdin** with a quoted heredoc — inline JSON
   dies on the first apostrophe.

```bash
slopweaver slack post --as bot --channel <id> --form - --dry-run <<'JSON'
{ …the form… }
JSON
```

Drop `--dry-run` to send. `--media a.png,b.pdf` attaches files to the card itself, never a second message
([what it takes](reference/media.md) — a picture, a deliverable or an MP4/QuickTime video; a parked draft keeps the bytes). **A message citing a Datadog console page carries its screenshot**, on every lane, or is refused. `slack reply --thread-ts <ts>` threads it.
Preview markers (`[b]…[/b]`, `<@U…>`) and what `--json` prints: [reference/render-check.md](reference/render-check.md).

## Posting as the owner (`--as me`)

This lane has **three form shapes**, and the first rule is picking the right one:

- **A top-level post to a PUBLIC channel is ONE message** — `kind: "one-card"` (a discussion is much easier
  to have in one message); a multi-message top-level drip is refused, fail-closed. In a
  HIGH-STAKES channel (#defects) any top-level fleet post but a `finding` card is refused, and a second inside a
  day ([high-stakes-channels](reference/high-stakes-channels.md)).
- **A roster or batch ask is ONE LIST** — `kind: "one-list"`: a `lead` line, `bullets` Slack draws its own
  glyph in front of, `trailing` lines closing it. Ten PRs are ten dot points and no card line bound fits
  them; `--body` or an override instead is the defect ([the-list-form.md](reference/the-list-form.md)).
- **A thread is drip-fed**, because that is how the owner actually writes: one or two concise sentences in the
  owner's voice per section, in the owner's words — a `kind: "drip"` sequence of short messages, about 1.5s apart, in a channel or a DM alike.

Rules that are not yours to bend:

- **No internal line breaks in a DRIP** — the gap between messages IS the spacing; `one-card` and `one-list` refuse a `\n` because there is a field for it.
- **Each message stays a sentence or two**, bounded by `slackMe.drip.messageVisibleMax`; **a SOLE message is
  bounded differently** (`soleMessageVisibleMax`), and that shape is what a proposal or discussion piece MUST
  use (several top-level messages leave a reader unsure which to reply to).
- **No citations, and mentions are exact-match only**, exactly as on the card.
- **A defect a reader can see never reaches the wire, and a published one is reported.** The door refuses a
  `--form` text run carrying a bare `@handle` (a scoped npm package is not one) or literal `*bold*`; a public
  `--body` post proves its render in `slackMe.renderProofChannel` first; every send is read back ([render-check.md](reference/render-check.md)).
- **A send that went out wrong is EDITED, never corrected underneath** (a bot appending its own correction reads
  as ugly to humans). `slack edit`, or delete and repost.
- **A bump must tag the person, or the door refuses it** (a tagged person is more likely to see it): chase-shaped
  prose carrying no resolved mention is refused before anything sends, on `--form` and `--body` alike.
- **`--shape` is REQUIRED and has no default** for an as-me `post`. For a MULTI-message drip the choice is
  the owner's, so ask the owner; for a single message both values produce the identical call, so pick one — but
  REUSE it if you extend that drip, because shape is part of a message's duplicate identity.
- **Voice rules refuse rather than rewrite**, on `--form` and `--body` alike, before any network call.
  `slackMe.voice.exact` bans literals, words and phrases; `paragraphSpacing` makes a SINGLE message breathe
  (the owner types more like this in one card in their voice), which `one-card` and
  `one-list` do for you and a `--body` needs typed. A message that will not fit the form you picked means you
  picked the wrong FORM, never that the override is the answer: [reference/voice-gates.md](reference/voice-gates.md).
- **Run `slopweaver slack voice-rules` FIRST, before drafting a word on this lane.** Two labelled blocks no doc
  here may list: the ADVISORY response shape, then the ENFORCED vocabulary and spacing rules. It writes this
  session's receipt, and new words as the owner from a session holding none are refused with the brief printed
  ([the briefing receipt](reference/voice-gates.md#the-briefing-receipt)).

**Read [reference/as-me-lane.md](reference/as-me-lane.md) before your first send on this lane** — every verb
with an example, the media rule, the `--body` escape hatch and a half-sent drip. On this lane the reference,
not `--help`, is the authority.

## Editing, correcting or deleting a message, and the reads around every send

`slack edit|delete --channel <id> --ts <ts>` mutate a sent message; `--as` defaults to `bot`, whose edit takes a
form of its target's kind, and `edit --as me` one message, never a drip ([edit-and-delete](reference/edit-and-delete.md)). **A bot claim newer evidence
contradicts is CORRECTED in place** by `slack correct` (`--as me` for one released as the owner), never deleted or answered with a bare reply; a release
re-reads its thread first, a post reads back where it landed: [read-before-and-after](reference/read-before-and-after.md).
**A draft that asks a question declares whether we asked it before**, and an answered one parks only with the change
shown in pictures — never re-asked bare: [asked-before](reference/asked-before.md). **Every draft declares `problem`** — `none`, or `possible` with `affects` one, a few or many, that word in its first line: [problem-reach](reference/problem-reach.md). **A top-level channel draft declares `opening`** — what it is, then what it asks of the reader, both in its top region: [channel-opening](reference/channel-opening.md). **Every draft names who will see it**, and a reply under a bot alert tagging nobody is not a shape: [who-will-see-it](reference/who-will-see-it.md). **Every draft brings its receipts** — a link or `--media` file, derived with no flag, else `--self-evident "<why>"` or `--tried "<what>"`, which the card leads with: [receipts](reference/receipts.md). **A finding brings a screenshot, a link and `--impact` with its count in its first line**, no hatch: [receipts](reference/receipts.md#a-finding-owes-all-three-a-screenshot-a-link-the-impact-in-people). **A first message in a channel, any author, leads with an annotated, unobstructed screenshot and its link**, every picture's boxes drawn with `browser annotate` and recorded with `browser image-record`, no hatch; a group DM an `--as me` record stamps off `is_mpim` is a DM: [receipts](reference/receipts.md#a-first-message-in-a-channel-leads-with-an-annotated-screenshot-and-its-link).

## Shaping the workspace: channels, DMs and canvases

`slack channel create|invite`, `slack dm open` and `slack canvas create` change what the workspace CONTAINS rather
than sending anything. **Every one is harder to undo than a message** — Slack cannot delete a channel, only
archive it, and a repeated channel-canvas create mints a SECOND document rather than updating the first
(measured). Read [reference/workspace-shape.md](reference/workspace-shape.md) first; the MCP comparison is
[docs/slack-mcp-benchmark.md](../../docs/slack-mcp-benchmark.md).

## Reading one file, and a huddle's transcript (`slack read-file`)

`read-file` posts nothing: give it a Slack file id or link and it reports, downloads and prints the file.
A **huddle** is why it exists; **a PDF's text is extracted by its BYTES**, `read-thread` inlines it too, and
neither is OCR. **Treat the output as `docs/security/slack-huddles.md` treats a huddle, the same as mail**: [reference/read-file.md](reference/read-file.md). `slack channel-view <channel-id> [--workspace <host>] [--json]` reads a channel as it is NOW, newest page live with pictures as Slack's previews, the window the console opens on a hovered channel: [reference/channel-view.md](reference/channel-view.md).

## Unread, tagged, owed, awaiting (`slack unread`, `tagged`, `owed`, `awaiting`)

`slack unread [--days 3]`: the owner's unread DMs by Slack's own read marker, then threads where a person spoke after the owner's last word, one line each, live; `talk slack-open --url` opens one row whole ([unread](reference/unread.md)); `talk slack-channel --channel <#name|link|id>` reads one channel's newest 50 top-level messages with reply counts, live, by the name the Slack app shows ([channel](reference/channel.md)). `slack tagged [--days 7]`: every recent message a PERSON tagged the owner in, corpus then live search, permalink and whether the owner answered; **thread read state is not exposed** ([tagged](reference/tagged.md)). `slack replied --url <link>`: has the owner posted after that one message — exit 0 replied, 3 not yet, 1 could not check; an ask's done-check ([tagged](reference/tagged.md#one-message-has-the-owner-replied-since--slack-replied)). `slack owed [--json] [--write]`: threads the owner spoke in over 14 days whose last word is a person's ([owed](reference/owed.md)); `slack awaiting`: those whose last human word is the owner's ask, quiet two business days
([awaiting](reference/awaiting.md)); `slack finding-followups`: the findings the owner shared owed their ONE follow-up card — quiet a business day, stalled on an untimed acknowledgement, or claimed fixed ([finding-followups](reference/finding-followups.md)). `slack saved`: the owner's own Later list off the owner's client's first load, pointers not text ([saved](reference/saved.md)). All of them **read and never draft or send** — a reply or chase is a parked draft.

## Timestamps and your own status (`slack when`, `slack status`)

**Never convert a `ts` by hand** — `slopweaver slack when <ts-or-permalink>… [--json]` derives it. A hand
conversion once read a `ts` hours wrong, reaching a board row, two cron schedules and
two deadman deadlines: [reference/timestamps.md](reference/timestamps.md). `slack status
set|clear|show|presence` changes the OWNER's profile on the user token; a manual away never expires: [reference/status.md](reference/status.md).

## What will stop you, and what to do about it

- **Report the `channel` and `ts` a send returns** — a later edit or delete needs them.
- **`--as me` needs the USER token** (`xoxp`), which is a different token from the bot's, and `--media` on
  that lane additionally needs `files:write` on it. `slopweaver connect slack --check` reports the two lanes
  separately, and names the scope on each.
- **Never the same message twice.** Every post and reply READS its place and refuses the same words or opening
  line from the same identity within 7 days, naming the permalink to EDIT; `slack repeats` audits the past and a
  draft release spends its other cuts ([repeats.md](reference/repeats.md)). A reserved send **never confirmed**
  (a lost response) needs `--resend-unconfirmed` once you have read the target; one Slack refused just re-runs.
- **If media fails to attach the message is deleted** and the whole send fails, on both lanes: a message
  that looks fine while silently missing its files is worse than no message.
- **`slack reply` refuses a send that would take OUR unbroken run in that thread past 5 consecutive
  messages**, counting the messages the send itself is about to post, so one multi-message `--as me` drip can
  trip it. `slack post` carries no `--thread-ts` and never triggers it. For one deliberate append, re-run
  after `slopweaver hatch open wall --reason "<why>"`, once you have checked with the operator, never automatically. What a run is, why
  the two lanes COUNT differently, and the two costs of that split:
  [the-wall-gate.md](reference/the-wall-gate.md).
- **A SCHEDULED post is refused anywhere but the owner's bot DM** — the bot stops posting what no one is asking
  for, and posts to the owner's bot DM for the owner to share. The door reads the slot
  key a recipe firing carries, so a person's direct ask of the bot is untouched and needs nothing from you.
  Point the row at `slackBot.promptChannel`, or record the owner's own approval on it; there is no hatch.
  [automation/reference/the-owners-dm-not-a-channel.md](../automation/reference/the-owners-dm-not-a-channel.md).

## Running this from Codex

This skill runs on both hosts. In Claude Code, `${CLAUDE_PLUGIN_ROOT}` above is substituted for you. In Codex
it is not: resolve this `SKILL.md` on disk, take the plugin root two directories above it, and invoke
`<plugin-root>/bin/slopweaver` by absolute path for every CLI call — never bare `slopweaver` on either host,
because an ambient `PATH` may point at another checkout.

Ground content first. For cards, fill only the typed form; never hand-write Block Kit or final wire text. Select `--as bot` or `--as me` explicitly — a bot post aimed at `slackBot.ownerUserId` or `promptChannel` declares `--dm-purpose` ([the card form](reference/the-card-form.md)) — run the exact operation with `--dry-run`, inspect and report the rendered preview, then send only when the user's request already authorises that send or they approve the preview; a message to a person that nobody asked for is parked with `slack draft record` for the owner's yes (rule 10), a thread reply with `--thread-ts <root ts>` and released by `slack reply`, never `slack post` ([draft-review](reference/draft-review.md)). A draft the owner already said yes to, on a call or anywhere, is SENT: fix how the owner types (em-dash, drip split, tag, lowercase, link) without asking, and only a change of meaning or a materially moved thread asks again; the owner's yes landing on a card naming a draft is judged on that row with `slack draft approve <id> --anchor <a>` (refused when the relay ruled anything but `send-it`, an unruled relay's or the landing's words carry no yes, it or the landing was about another card, or a later relay on that call took it back) or `slack draft hold <id> --reason <code> --why "<w>"`, and a hold is printed on the owner's Queue card ([pre-approved](reference/pre-approved.md)). A held as-me row's words are rewritten with `slack draft revise <id>`, or an earlier version put back with `slack draft restore <id> --version <n>`, every version kept and nothing sent ([draft-revisions](reference/draft-revisions.md)). An approved `--draft` release into a PUBLIC channel the owner is not in JOINS it as the owner first and then posts, in one run, the join recorded on the autonomy ledger as its own act; a private channel, or a row without the owner's recorded yes, is refused before anything joins or posts ([a channel the owner is not in](reference/pre-approved.md#a-channel-the-owner-is-not-in)). Use one payload and one send path. Never bypass Slopweaver with a raw Slack API call.
