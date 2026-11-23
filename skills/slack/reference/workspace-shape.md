# Shaping the workspace: channels, DMs and canvases

Three verbs that change what the workspace CONTAINS rather than sending a message: `slack channel`
(create, invite, archive), `slack dm` and `slack canvas`. They are grouped because they share one property no send has — **each one's
retraction is weaker than a delete**, and each refuses more before touching Slack because of it.

| verb                      | endpoint                             | undo                                | idempotent?                          |
| ------------------------- | ------------------------------------ | ----------------------------------- | ------------------------------------ |
| `channel create`          | `conversations.create`               | **archive only** — name stays taken | Slack refuses `name_taken`           |
| `channel invite`          | `conversations.invite`               | remove by hand in Slack             | yes — `already_in_channel` is landed |
| `channel archive`         | `conversations.archive`              | unarchive by hand in Slack          | yes — `already_archived` is success  |
| `dm open`                 | `conversations.open`                 | none needed                         | **yes, by Slack's own guarantee**    |
| `canvas create`           | `canvases.create`                    | `canvas delete`                     | **NO — a repeat mints a second one** |
| `canvas create --channel` | `conversations.canvases.create`      | `canvas delete`                     | **NO — measured, see below**         |
| `canvas replace`          | `canvases.edit` (whole-body replace) | rewrite again                       | yes                                  |
| `canvas delete`           | `canvases.delete`                    | none                                | yes — `canvas_not_found` is success  |

## Which lane each needs, measured rather than assumed

MEASURED — reproduce with `slopweaver slack probe --method auth.test --scopes` and again with
`--bot`:

- **`channel create` and `channel invite` run on `--as me` and that is their default.** The BOT token on
  this install holds neither `channels:manage` nor `groups:write`, so the bot can neither create a channel
  nor invite into one; the USER token holds `channels:write`, `groups:write` and `groups:write.invites`.
  MEASURED: `slack channel invite --channel C0SYN000042 --invite U0SYN000005` on the user lane
  put the bot into `alerts-platform-p1`, the one alerts channel it was not yet a member of — the bot's
  own id resolves through the self layer, and is the key to use for it. `--as bot` is still accepted rather
  than pre-refused, because the owner can grant a scope at any time and a hard-coded refusal would become a
  lie about the workspace — instead a `missing_scope` failure names the exact scope that lane needs.
- **`dm open` and `canvas create` run on either lane, and default to `--as bot`.** Both tokens hold
  `im:write`, `mpim:write` and `canvases:write`. The bot is the default because the conversation it opens is
  one the bot can then post into, and a canvas it authors is one it can later rewrite.

**The onboarding tiers do NOT grant these scopes.** `src/onboard/tiers.ts` builds an app that can read, be
tagged and answer; `channels:write`, `groups:write`, `groups:write.invites` and `canvases:write` are none of
those, and were not added to a tier by the change that added these verbs — widening what every fresh install
is asked to grant is the owner's call, not a side effect. On this install they are already present because
the app predates the tiers. Elsewhere the first run of one of these verbs, or of an approved release's join
into a public channel the owner is not in ([pre-approved](pre-approved.md#a-channel-the-owner-is-not-in), `channels:write`
on the user token), fails `missing_scope`, and the
failure names the exact scope that lane needs; add it in the Slack app config and re-install the app.

## What each refuses before touching Slack

- **A channel name Slack would silently rewrite.** Slack does not reject `Design Review` — it stores
  `design-review`. So the name is REFUSED with the canonical form named (`re-run with --name design-review`),
  because a channel cannot be deleted and a reference written to the name you asked for would point at
  nothing. A name with no letter, digit or underscore in it at all is refused with no suggestion, since
  there is none to give.
- **An invitee, or a `--with` person, that does not resolve.** Exact match only, through the same identity
  layers a mention uses ([mentions.md](mentions.md)). One unresolvable key refuses the WHOLE create — a
  channel minted with the wrong people in it cannot be un-minted — and the whole `channel invite` too, since
  an invite this verb cannot take back is not sent half-right. `invite` also refuses an `--invite` that
  names nobody, rather than making a call for nobody and reporting `0/0` as success.
- **A group DM naming more than 8 other people.** Slack's own ceiling, checked here because its error
  (`too_many_users`) names no number and the remedy is a different verb.
- **An empty canvas body or a blank title.** Slack accepts both and mints a blank, unfindable document —
  which is exactly what an unreadable `--markdown` path or an empty stdin looks like. `canvas replace` with
  an empty body is refused too, harder: that one BLANKS a document that already has content.
- **A repeated `canvas create` inside 24 hours.** The duplicate-send gate the poll lane uses, keyed on the
  destination and title. Override with the token the refusal names, after checking you meant it.

`--dry-run` on any of them prints every irreversible step in order and touches nothing.

## Two measurements that are the opposite of the obvious guess

Both were found by running the real API while writing the cassettes, and both had already been written into
the code the other way round first.

- **A second `conversations.canvases.create` for one conversation mints a SECOND document.** There is no
  per-conversation uniqueness, no `channel_canvas_already_exists` refusal, and no update-in-place: two calls
  answered `ok: true` with two different ids, both independently deletable. This is why the create is
  at-most-once at the transport AND gated at the verb, and why a successful channel-canvas create prints
  "running this again would add a SECOND canvas there".
- **`conversations.invite` reports a failed invite WITHOUT naming who.** With `force: true` a bad id comes
  back in `errors` as `{"ok": false, "error": "org_user_not_in_team"}` — no `user` field, contrary to
  Slack's own reference. So the outcome carries an `unattributed` arm, the report says "Slack refused N
  invite(s) without saying which person — open the channel and check", and it never claims everybody landed.

## The MCP benchmark

Measured and written up separately, because it is about two surfaces rather than about these verbs:
**[docs/slack-mcp-benchmark.md](../../../docs/slack-mcp-benchmark.md)**. The headline for this page is that
**channel creation, group-DM opening, channel archive, channel invite and canvas delete have NO tool in the
official Slack MCP at all** — so for two of the three things the owner asked for the comparison is a
capability gap rather than a benchmark. Canvases are the one overlap; that file says what the door adds
around the same call, and states plainly which half of the comparison it could not measure and why.

## Recording the cassettes again

`src/__tests__/integration/slackConversationWrite.test.ts` and `slackCanvasWrite.test.ts` replay offline by
default. Re-recording **creates for real**, and the two files differ in what they leave behind: the canvas
tests delete everything they make, while each channel create is permanent — Slack has no delete for a
channel — so a re-record archives what it minted and leaves one archived `slopweaver-int-*` channel per lap.
Each file's own header carries the exact command and the environment it needs.

**Do not stop to ask whether you may.** Recording is pre-approved, and the
self-addressed traffic a lap makes (the bot's own DM, a `slopweaver-int-*` channel it archives afterwards)
is expected, not exceptional. [`.claude/rules/testing.md` § Recording a cassette is
pre-approved](../../../.claude/rules/testing.md#recording-a-cassette-is-pre-approved--never-stop-to-ask) is
the whole statement, and a run journal that records a question asking permission reads as a doctrine
violation on the board.
