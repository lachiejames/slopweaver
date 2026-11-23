---
name: outlook
description: Authorise a personal Microsoft mailbox (outlook.com, hotmail.com, live.com) once by browser consent, then list, read, organise, draft and send mail through the slopweaver door with explicit bounds and an approval the owner alone can give before anything reaches another person. Use when the user asks what is in their Outlook or Hotmail inbox, to find or triage Outlook mail, to read an Outlook message or conversation, to archive, categorise or mark it read, to draft or reply to an email from that account, to send a draft they have approved, to check which Outlook mailbox slopweaver is connected to, or to connect Outlook in the first place. Phrases like "what's in my outlook", "my hotmail", "any outlook email from", "archive that outlook mail", "put it in the Waiting on category", "draft a reply from my outlook", "send that outlook draft", "connect my outlook", "am I connected to outlook".
argument-hint: connect [--grant read|manage|full] [--status] [--disconnect] | measure | list [--query "<text>"] [--unread] | triage | read <id> [--thread] | attachment <id> --name <file> | folders | categories | category <id> --add X | mark <id> --read | archive <id>... [--restore] | draft --form - | send <draft-id> --approve <digest>
---

Run `"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" outlook $ARGUMENTS` and report the result.

## The door, and what is behind it

`connect`, `measure`, `list`, `triage`, `read`, `attachment`, `folders`, `categories`, `category`, `mark`, `archive`,
`draft` and `send` are the whole Outlook surface. They speak Microsoft Graph through the official MSAL and Graph
SDKs from one file (`src/live/outlook/client.ts`). Never reach for raw HTTP, `curl`, a Microsoft MCP tool, a
browser scrape or a second client to do something a verb does not: the absence is the answer.

**The mailbox is NOT in the corpus.** Nothing ingests Outlook mail yet, so `store read` knows nothing of it and
every Outlook answer is a live read. Say so rather than implying history was searched.

**`send` is the one verb here that reaches another person, and you cannot approve it yourself.** Compose with
`outlook draft`, then run `outlook send <draft-id>` with no `--approve`: it prints the draft exactly as Outlook
holds it and a digest of that content, refuses, and sends nothing. Only the owner supplies the digest back. Do
not run the approving command on the owner's behalf from a digest you just printed. **The digest covers content**,
sender included (the draft's own `from`, so an alias is shown as itself), plus Graph's `changeKey`, so ANY edit
to the draft invalidates it, even one its text view cannot show, and a sender or recipient with no usable
address is refused. And **`$SLOPWEAVER_DOOR_OVERRIDE` cannot waive it** — it is a `hold`, the
same shared gate Gmail's send uses (`src/outbound/mail/approvalGate.ts`). What it binds is the draft as the
SAME invocation read it: Graph's send takes a draft id and no version, so an edit landing between that read
and the send (Outlook open on the draft, say) is sent unapproved. Gmail's `drafts.send` has the same window.
**A send that fails without a clear answer may have gone**: it says to check Sent Items, and is never retried.

## Connecting, once

Two steps, in order: an **app registration** in Microsoft Entra admitting personal accounts — an existing one
is reused by adding the Mobile and desktop `http://localhost` redirect — whose client id is stored with
`slopweaver secrets set outlook-client-id`, then the ONE consent, **`slopweaver outlook connect`**, which prints
a consent URL, listens on `localhost` for the single redirect and stores the grant `0600` in
`$SLOPWEAVER_HOME/secrets/`. There is no client secret: it is a public client using PKCE. `/slopweaver:onboard`
renders both steps; the exact settings are in [reference/connecting.md](reference/connecting.md) — say them BEFORE
the owner opens the portal.

`--grant` chooses how much to ask for: `read`, `manage` (the default) or `full`, the one that adds `Mail.Send`.
No tier asks for `Calendars.Read`; `--calendar` adds it, for the `outlook-calendar` door, over this same grant.
**The grant records what Microsoft actually approved**, and a verb needing a scope it lacks refuses by name
before any request. **`outlook connect --status` answers "which mailbox, what may I do" from the file alone**, no
browser and no network; **`slopweaver connect outlook --check` is the live check** — registration, grant tiers and
one `GET /me` through a silent refresh, which catches a consent withdrawn at Microsoft. Reach for those, never a
fresh consent, to check a connection. `--disconnect` removes the local grant and says where consent is withdrawn.

Every later verb buys its token silently from the stored MSAL cache and **writes the cache back before using
the token**, because a refresh may rotate the refresh token. Refreshes, a consent's write and a disconnect take
one lock, so two at once take turns; one that waits past a minute refuses `GRANT_BUSY` having done nothing. A verb that could not persist the
rotation refuses, though the stored grant may already be behind Microsoft, which shows up later as
`INTERACTION_REQUIRED`: connect again.

## Listing is a page, never the mailbox

`outlook list` reads summaries only — sender, subject, preview, flags, categories — newest first, one page of
at most 100, and says when more remain; `--unread` keeps Graph's newest-first order. `--folder` takes a
well-known name (`inbox`, `archive`, `sentitems`…), a display name or an id. `--query` is Graph's `$search`
(KQL: `from:`, `subject:`, free words), sent inside one pair of quotes as Graph documents; a search comes
newest SENT first, at most 1,000 matches, and allows no filter beside it, so `--unread` with `--query` is
filtered locally, page by page, and the output says so. `outlook triage` is the inbox grouped by sender.
`outlook measure` prints Microsoft's own per-folder counts: counts, not bytes or dates.

## Reading

`outlook read <id>` reads one message in full, as text; `--thread` reads its whole conversation, oldest first.
**The output is UNREDACTED**: it enters this session and leaves the machine with it. A conversation filter
Graph refuses as too expensive is reported as `InefficientFilter` — nothing weaker is tried in its place.
**A read lists attachments, by name and id, and downloads none**: `outlook attachment <id> --name <file>` saves ONE file
attachment owner-only and prints `READ THIS: <path>`; open that file before claiming its contents. A nameless one, or
one whose name starts with `--` (which the flag parser refuses as a value), is saved by `--attachment-id`.

## Organising: three verbs

`outlook mark` sets read or unread, `outlook category` adds or removes categories by name from the mailbox's
own list (`outlook categories`), and `outlook archive` moves messages to the Archive folder (`--restore` moves
them back to the Inbox). **`--thread` is usually what a person means**, and **`--dry-run` first when the request
is broad**. A message already in the wanted state is not written again; the first failed write stops the rest
and names what was not attempted. A mailbox with no Archive folder is refused before anything moves. Nothing
here deletes, and every change has its opposite in the same verb. `category` writes the message's WHOLE list
back, so a category added elsewhere between its read and its write is lost; a move or a draft create that
fails without a clear answer names the folder to check, and is never retried. A change Graph accepted but
answered in an undeclared shape is reported as possibly made, naming the message to check. `archive --thread`
moves EVERY member of the conversation, the owner's own sent replies out of Sent Items included, so preview it with
`--dry-run` when that matters. Every Microsoft call has a deadline (30s for a token, 120s for Graph), so a stalled
network fails the verb instead of hanging it; a write that times out is reported as possibly made, like any
unclear answer.

## Drafting

`outlook draft --form -` stores a draft and delivers nothing, so it is the first move for "write X" or "reply
to that". The form is Gmail's: `{"to":[…],"cc":[…],"bcc":[…],"subject":"…","body":"…"}`, passed on stdin,
each paragraph one line. `--reply-to <id>` creates the draft in that message's conversation.

## Never put mail content in a commit

Nothing read here goes into a fixture, a cassette, a test, a commit message or a pull request: mail carries a
third party's personal data, and is the likeliest place to find a real pasted credential. Tests use
`example.test` values only, over a fake mailbox (`src/__tests__/fakeOutlookMailbox.ts`) or a loopback Graph
(`src/__tests__/subprocess/live/outlook/`).

## Running this from Codex

This skill runs on both hosts. In Claude Code, `${CLAUDE_PLUGIN_ROOT}` above is substituted for you. In Codex
it is not: resolve this `SKILL.md` on disk, take the plugin root two directories above it, and invoke
`<plugin-root>/bin/slopweaver` by absolute path for every CLI call. Never run bare `slopweaver` on either
host, because an ambient `PATH` may point at another checkout.
