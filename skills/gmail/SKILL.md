---
name: gmail
description: Authorise a Google mailbox once by browser consent, then list, read, organise, draft and send mail through the slopweaver door with explicit bounds, stated residue, and an approval the owner alone can give before anything reaches another person. Use when the user asks what is in their inbox, to find or triage email, to read a specific message or thread, to archive or label mail, to mark it read or unread, to draft or reply to an email, to send a draft they have approved, to unsubscribe from a sender's mailing, to check which mailbox slopweaver is connected to, or to connect Gmail in the first place. Phrases like "what's in my inbox", "any email from", "read that email", "archive that", "mark those read", "label it waiting", "draft a reply to that", "write an email to", "send that draft", "unsubscribe me from", "find the thread about", "connect my gmail", "am I connected to gmail", "archive the meeting notes", "are all the transcripts in".
argument-hint: connect [--grant read|manage|full] | measure | list [--query "is:unread"] | triage [--key <key>] | triage-rules [--set <path>] | clear-meeting-notes [--dry-run | --audit] | read <id> [--thread] | attachment <id> --name <file> | archive <id>... | mark <id> --read | label <id> --add X | labels | draft --form - | send <draft-id> --approve <digest> | unsubscribe <id> [--dry-run]
---

Run `"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" gmail $ARGUMENTS` and report the result.

## The door, and what is behind it

`connect`, `measure`, `list`, `triage`, `triage-rules`, `clear-meeting-notes`, `read`, `attachment`, `labels`, `label`, `mark`, `archive`, `draft`,
`unsubscribe` and `send` are the whole of the Gmail surface. Never reach for raw HTTP, `curl`, a Google MCP tool, a browser scrape or a second
client to do something a verb does not: the absence is the answer, not an obstacle. Use the world model for
history and discovery; it cannot establish current mailbox state.

**`send` is the one verb here that reaches another person, and you cannot approve it yourself.** Compose
with `gmail draft`, then run `gmail send <draft-id>` with no `--approve`: it prints the message exactly as
Gmail holds it, prints a digest of that content, refuses, and sends nothing. Only the owner supplies the
digest back. Do not run the approving command on the owner's behalf from a digest you just printed — the whole
point of the two steps is that a person read the message in between. No forwarding verb but [spend's](../spend/SKILL.md).

## Sizing the mailbox before a backfill

`gmail measure` answers "how big is this, how far back does it go, how many bytes" — the three numbers a
full-history backfill is decided on, established before the long pull rather than discovered during it. It
walks message IDS only (one call per hundred messages, none per message), so it is cheap: a 1,738-message
mailbox measured in 18 listing calls and about twenty seconds.

Three things to carry into how you report it:

- **The count and the two dates are EXACT.** The count is what a crawl would read; Gmail's own
  `messagesTotal` is printed beside it as a SECOND, different number, because it counts Spam and Trash a
  listing never returns. Report both, never reconcile them.
- **The byte figure is an ESTIMATE and every rendering says so**, projected from an evenly-spread sample
  whose size travels with the number. Never quote it without the sample.
- **`--query` measures within a Gmail search expression**, which is how you price a slice
  (`--query "from:gemini-notes@google.com"`) rather than the whole mailbox.

## Mail IS in the corpus now — but only if it was ingested

`slopweaver refresh --source gmail` ingests the mailbox into the local corpus, so `store read` and
`store cite` can answer from mail history the way they answer from Slack or Linear. Two things follow that change what you
should say:

- **It is opt-in by NAMING.** `--all-sources` does not include the mailbox. So "the world model has no mail" and "the world model has mail up to the last `--source gmail` run" are both live possibilities, and `slopweaver audit` is what distinguishes them. Do not assume either.
- **A Gemini notes mail leaves the inbox once its transcript is PROVEN held, or its notes hold none**: `gmail clear-meeting-notes` checks bronze by the mail's own title and date, ingests what is missing, then archives; a mail whose notes document was read with no transcript in it is archived uncarded; a mail it cannot prove stays with one Queue card. `--audit` is "is every transcript so far in": [reference/clear-meeting-notes.md](reference/clear-meeting-notes.md).
- **What is stored is a projection, not the message.** Sender NAME (never the address — every address is
  scrubbed to `[email]` on write), subject, the body with its quoted tail and signature stripped, and
  attachment metadata. No raw MIME, no attachment bytes, and none of the labels that merely record what has
  been read or archived. So a corpus answer can be thinner than the live message, and `gmail read <id>` is
  the way to get the whole thing back.
- **A MEETING is not a message, and only the RAW TRANSCRIPT is stored.** A Gemini / Google Meet notes email
  projects to a `transcript` record carrying the meeting's own title, its date, its attendees and the
  transcript block of the Google Doc the email links — speaker and timestamp lines as the document wrote
  them — and is not also stored as a message. Gemini's summary is dropped entirely, from both the document
  and the email, because a summary produced by other software is not worth keeping. So "what did we decide in the working group" retrieves what was SAID, not a machine's
  precis of it and not the notification that announced it.
- **A meeting with no transcript is REFUSED, not stored as its summary.** Three cases produce no record at
  all: the linked document was not read (a moved doc, a missing `documents.readonly` scope, a capped pass),
  it was read and carries only Gemini's summary because the call was never transcribed, or the carrier email
  has no send time. The refresh reports one line per case naming how many and what recovers it — the first
  is fixed by restoring access and refreshing again, the second only by turning transcription on for the
  meeting itself. `attrs.transcriptFoundBy` (`tab` or `inline`) and `attrs.transcriptSpeakerLines` say how
  the transcript was recognised and on what evidence.

**Scan what the scrub missed, rather than trusting it.** `slopweaver audit hygiene --source gmail` runs the
public leak-class patterns and the private denylist over the bronze on disk — the repository gate reaches
only `git ls-files`, so nothing else ever checked this. It reports three arms and **only the first fails**:
a **credential** (a token or key shape) is a secret the redaction pass missed; an **identifier** (a raw
workspace id, an absolute home path) and a **private-denylist word** are reported with their locations and
never gate, because a world model of the owner's own activity is made of exactly those. Do not report either
of the two report-only arms as a defect. It prints locations and never the matched text, because on a mail
record the match IS the content. **A credential that IS found is repairable:** `slopweaver audit hygiene
--scrub` rewrites exactly the flagged lines with the shipped redactor's token passes and leaves every other
byte alone. The exit code still comes from the scan, so confirm by re-running the verb. The whole-corpus
version of this scan also runs as the `corpus-hygiene` check in `yarn lint`, so it is never opt-in.

Every mail record is private by source and can never be served to a non-owner —
[docs/security/mail-boundary.md](../../docs/security/mail-boundary.md) § "The mail boundary".

## Connecting, once

Gmail is the only source here that needs the owner's own consent in a browser rather than a token pasted
into a prompt. Two steps, in order: **a Desktop-app OAuth client** the owner creates once in Google Cloud
and stores with `slopweaver secrets set google-client-id` / `google-client-secret`, then **`slopweaver gmail
connect`**, which prints a consent URL, listens on `127.0.0.1` for the single redirect and stores the grant
`0600`. That pair is the USER-DATA client, shared with the Drive and calendar doors; the Google Admin door
has its own (`google-admin-client-id`), which is what keeps an administrator credential read-only.
`slopweaver gmail connect --revoke` withdraws the grant at Google — all three user-data doors at once,
because Google revokes the whole (client, account) grant.

Three things to say BEFORE they open the page, not after: the project needs the **Gmail API** and the
**Google Docs API** enabled; the client type must be **Desktop app**, because a Web application client fails
consent with `redirect_uri_mismatch`, which explains nothing to the person reading it; and **the client
secret is shown ONCE**, in the dialog that appears the moment the client is created, with no page that will
ever show it again — tell them to save the ID and the secret into their password manager before closing it.

`--grant` chooses how much to ask for — `read`, `manage` (the default) or `full` — and **the grant records
what Google ACTUALLY approved**, which can be narrower, because the consent screen lets a person untick
scopes. A verb needing a missing scope then refuses BY NAME rather than failing at the API with a 403. Two of
Google's own rules are worth knowing rather than discovering: `gmail.modify` subsumes `gmail.readonly`, but
**`gmail.send` does NOT subsume `gmail.compose`** — which is what makes "drafts are the default, sending is a
separate deliberate act" a property of the credential rather than of a code path.

**`slopweaver gmail connect --status` answers "which mailbox, and what may I do with it" with no browser, no
socket and no network call.** Reach for that, never a fresh consent flow, to check a connection;
`slopweaver connect gmail --check` is the fuller preflight that adds one live call. The scope-to-verb table,
why `documents.readonly` rides on every grant, and what a `--grant read` install can still dry-run are in
[reference/connecting.md](reference/connecting.md).

## Listing is a page, never the mailbox

`gmail list` reads **metadata only** — sender, subject, snippet, labels, and the flags for unread and
attachments. No bodies. `--query` takes a Gmail search expression exactly as the Gmail search box does
(`is:unread`, `from:someone label:important newer_than:7d`), `--label` restricts by label ID and repeats,
and `--limit` caps the page at 100.

Every listing states its residue and **that residue is part of the answer**. Gmail's own
`resultSizeEstimate` is an ESTIMATE of the query, not a count of what was read, and it is reported as one;
when more matched than fit the page, the document says so. Never "all" of anything when the residue says another page
exists. `gmail triage` is the INBOX grouped by sender, headers only; its `--pin` stores the card's newest 20 in full
for the Queue to draw, read back with `gmail card-mail`, and this install's own triage policy is `gmail triage-rules`,
the store's row; the code ships none, so with none declared every group is carded
([reference/triage.md](reference/triage.md)).

## Reading one message

`gmail read <message-id>` reads one message in full, `authored` beside `body`; `--thread` reads the whole thread of a
thread or message id, `DRAFT`s included. A bare read says in its residue that the thread may hold more.

Two properties to carry into whatever you write from it:

- **The output is UNREDACTED**, like `slack read-thread` and for the same reason: reasoning about the actual
  message is the point. It enters this session and therefore leaves the machine with it. If a message is too
  sensitive for that, do not read it here.
- **A read reports attachments and downloads none.** `gmail attachment <id> --name <file>` saves ONE owner-only
  and prints `READ THIS: <path>`; open that file before claiming its contents ([reference/attachments.md](reference/attachments.md)).

`--json` on any read verb emits the same document shape every live provider read uses — freshness, bounded
coverage, residue, payload — which is what to pass on when another step will consume it.

## Organising mail: three verbs, one Gmail call

Gmail has no archive and no mark-as-read. It has ONE mutation — add and remove label ids — and `gmail
archive`, `gmail mark` and `gmail label` are that call wearing a person's names for it, so "why is it still in my
inbox" is a label `gmail read <id>` shows. `gmail unsubscribe <id>` is instead RFC 8058's one-click POST to the
SENDER, refused for one publishing none ([reference/unsubscribing.md](reference/unsubscribing.md)).

**`--dry-run` first when the request is broad or the label is unfamiliar**, and **`--thread` is usually what
a person means** — archiving ONE message leaves the rest of the conversation in the inbox, which reads to
them as "it didn't work"; `archive` takes up to 100 ids. **Nothing here is destructive, and nothing is
irreversible**: archiving does not delete, and every change has an exact opposite in the same verb. `gmail
label` will not ADD `TRASH` or `SPAM`, and there is no other route to a refused add. **Each mutation reads
label state BEFORE the change and Gmail offers no compare-and-set**, so a change made elsewhere in between is
neither detected nor reported — never present a mutation result as proof of the mailbox's current state. All
six, with the label table: [reference/organising.md](reference/organising.md).

## Drafting, and the one gate you cannot open

`gmail draft --form -` stores a draft in the owner's own mailbox and delivers nothing, so it is the first move
for "write X" or "reply to that", reversible by deleting it in Gmail. **It is the shape the owner wants for any
mail the owner sends**: every recipient set and the body written, so the owner presses send or edits, never a
card of text to paste. **Pass the form on stdin**: the shell rewrites a body in a command line, and
backtick substitution has already eaten text here. **Write each paragraph as one line**; a body hard-wrapped
inside a paragraph is refused. **Every Gmail write runs the outbound privacy check under the verb's `--home`** — a
draft, a send (on the draft as Gmail holds it), a label change, an unsubscribe — and a refusal sends nothing: reword.

**Asked to SEND it, run `gmail send <draft-id>` with no `--approve` and show the owner the output**: the preview,
which refuses, exits non-zero and sends nothing. **The digest covers content, not the draft**, so editing the
draft stops the old digest matching and an approval cannot be moved onto a message the owner did not read.
**`$SLOPWEAVER_DOOR_OVERRIDE` cannot waive this** — it is a `hold`, which carries no override token by the
door's own type-level contract — and **an accepted send is not a delivered mail**; nothing here can recall
one. The form's five fields, what `--reply-to` does not infer, `--board` drafting a board row's previewed mail,
and the two limits worth knowing before you promise something are in [reference/drafting-and-sending.md](reference/drafting-and-sending.md).

## Never put mail content in a commit

Email bodies are the leakiest content this repository touches: a correspondent's real name and address, a
signature block, a password reset, an API key pasted into a thread. Nothing read here goes into a fixture, a
cassette, a test, a commit message or a pull request.

**This rule is wider than the no-names line** in `AGENTS.md`, and stands on its own footing: mail carries a
THIRD PARTY's personal data, which is not ours to redistribute whoever can read the repository, and mail is
the likeliest place in any source to find a real pasted credential. A synthetic stand-in fixes a name; it
does not make a real correspondent's message ours to commit. Both reasons are about the content, not about
who can see the tree.

**Recording a gmail cassette is pre-approved, and this rule is what bounds it.** The owner's
ruling: a record lap against **the owner's own mailbox** is expected test traffic and needs nobody's word
([`.claude/rules/testing.md` § Recording a cassette is
pre-approved](../../.claude/rules/testing.md#recording-a-cassette-is-pre-approved--never-stop-to-ask)). The
two do not conflict: recording is greenlit, and what the cassette may KEEP of what it recorded is decided by
the allowlist redactor, never by a body reaching a committed file.

## Running this from Codex

This skill runs on both hosts. In Claude Code, `${CLAUDE_PLUGIN_ROOT}` above is substituted for you. In
Codex it is not: resolve this `SKILL.md` on disk, take the plugin root two directories above it, and invoke
`<plugin-root>/bin/slopweaver` by absolute path for every CLI call. Never run bare `slopweaver` on either
host, because an ambient `PATH` may point at another checkout.
