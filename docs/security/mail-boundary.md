# The mail boundary (`gmail`)

Part of [Security & trust](../security.md).

Two things make Gmail different from every other source here, and both are stated rather than left to be
discovered.

- **It opens a listening socket, which almost nothing else here does.** Every other verb in this product is
  outbound-only — `listen` says so about itself in [the section above](slack-inbound.md) — and the sole exception is the shared
  Google consent flow, which the Drive door runs too. Google retired the out-of-band OAuth redirect, so the
  installed-app flow it replaced it with delivers the authorisation code to `http://127.0.0.1:<port>`, and
  `gmail connect` therefore binds a server to receive it. Every property that bounds it is deliberate: it
  binds to the **loopback interface only**, on an **ephemeral port the kernel picks**, it serves **one**
  request and closes, and it is torn down on a five-minute deadline whether or not anything arrives. It
  cannot outlive the `gmail connect` invocation that opened it, and nothing outside your machine can reach
  it.
- **The stored grant is a long-lived credential for a mailbox.** `$SLOPWEAVER_HOME/secrets/gmail-oauth.json`
  holds a Google **refresh token**, `0600` under the `0700` secrets directory. Anyone holding that file can
  read — and at a `manage` or `full` grant, modify — that mailbox until the grant is revoked at
  <https://myaccount.google.com/permissions>. It is never printed, logged or synced;
  `gmail connect --status` and `connect gmail --check` report the account, the granted scopes and the file's
  path, and no token material. **Revoking the grant at Google is what actually ends the access** — deleting
  the file locally stops this machine using it and leaves the grant standing on the account. A
  Testing-status OAuth client's refresh token also lapses by itself seven days after consent; the grant
  records that instant, and both verbs report it.

Four further properties worth stating plainly:

- **Consent is scoped per verb family, and Google decides what you get.** `--grant read` asks for
  `gmail.readonly`; `manage` adds `gmail.modify`; `full` adds `gmail.compose` and `gmail.send`. The consent
  screen lets you untick scopes, so what is stored is what was **actually approved**, which may be narrower
  than what was asked for. A verb missing its scope refuses by name before the call rather than failing at
  the API.
- **Every grant, including the narrowest, also asks for `documents.readonly` — a scope that is not Gmail's.**
  Google Meet mails an inline summary and a LINK to the Google Doc holding the meeting's notes and
  transcript, so a mailbox grant alone ingests half of every meeting and cannot say which half. It is the
  narrowest scope that reads a document you can already open: it reads a document **by id**, it cannot list
  or search a Drive, and it cannot write. The only ids it is ever handed are the ones inside a message
  whose sender is one of Google's own meeting addresses — never a link from arbitrary mail, because
  following a URL from a message body with your own credential is exactly the operation not to perform on
  attacker-chosen input. Declining it is legitimate: `connect gmail --check` reports it as a **warning**,
  and meetings still ingest with their emailed summary as their whole text.
- **`gmail read` output is UNREDACTED**, exactly as `slack read-thread` is, and for the same reason:
  reasoning about the actual message is the point. It is meant for a visible agent session, so the content
  enters that conversation and leaves your machine with it, under [the visible-session egress](data-flow.md) above. That is
  an accepted trade. If a message is too sensitive to send to that host, do not read it here.
- **`gmail send` is an outward action toward a third party, and it is gated by a `hold`.**
  Sending is deliberately not something composing can do: `gmail draft` stores a draft in your own mailbox
  and delivers nothing, and `gmail send` sends an existing draft and composes nothing, so no message can be
  delivered that was not first written down and readable. The console can press `gmail draft --board <slug>
--expect <digest>` and nothing else of this surface: the press carries two tokens, the verb reads the mail a
  visible session recorded on that board row, and a digest that is not the row's current mail is refused. A bare `gmail send <draft-id>` prints the message
  as Gmail holds it — every recipient field by field, `Bcc` included, the subject and the body — prints a
  SHA-256 digest over exactly that content, and is then refused by the door. Only `--approve <digest>` admits
  it, and the digest is recomputed from the draft at send time, so a message edited after approval is
  refused rather than sent.

  **The refusal is a `hold`, which `$SLOPWEAVER_DOOR_OVERRIDE` cannot waive** — the door's finding type
  gives an override token to a `warn` and none to a `hold`, so this is enforced by the type system rather
  than by a convention. Both the refusal and the send are recorded in the door ledger, carrying the digest
  and the recipient COUNTS and never an address, a subject or a body.

  **What this does NOT do, stated because a gate believed to do more than it does is worse than none: it
  does not authenticate a human.** The same process that prints a digest can compute one, exactly as
  `slopweaver handover answer` records an authorisation without authenticating one. What it does guarantee
  is that an approval cannot be transplanted onto content nobody read, and that sending takes a second,
  separate act with the full message already on screen. The remaining protection is procedural and lives in
  the skill: an agent must not approve its own draft.

  `drafts.send` is also the one Gmail call here that is **never retried** (`retryMode: "never"`). A retry
  after a lost response would deliver the same mail twice to a real person, and nothing downstream could
  undo it — so a failed send surfaces as a failure to investigate rather than as a silent duplicate.

- **Every Gmail write runs the outbound privacy check first, under the verb's own home.** The Gmail auth client's
  `fetch` is the guard (`src/live/gmail/guardedFetch.ts`, installed by `guardedGmailSdk` in `client.ts`, the one
  place the SDK is built). Eight measured GET routes are reads and pass without loading anything; every other Gmail
  request (a label change, `drafts.create`, `drafts.send`, and any route nobody has listed) is judged `strict`
  against the private terms, the denylist and the forbidden identifiers, after the dead-Datadog-host refusal and
  before the wire. A draft is judged on its decoded MIME message: subject, addresses and display names, every
  header, the text and HTML bodies, attachment names and types and text-like attachment bytes; malformed MIME
  refuses. A send re-reads the draft as `format=raw` first and judges what Gmail holds, sending nothing if that
  read fails. `gmail unsubscribe`'s one-click POST judges the sender's whole target URL before its `fetch`. A
  refusal names the locus and the class, never the term, and a refused board draft releases its claim so the next
  press can try again. What is judged, and every residue: [write transports](./write-transports.md).

- **A read reports attachments and downloads none; `gmail attachment` downloads ONE, on request.** `gmail read`
  and `gmail list` list each attachment's filename, media type and size and fetch none of the bytes, and ingest
  is the same: a bronze mail record names its attachments and stores none of their bytes. The one verb that
  fetches bytes is `gmail attachment <message-id> --name <file>`. It needs only `gmail.readonly` and saves that
  single attachment UNREDACTED at `$SLOPWEAVER_HOME/live/gmail/attachments/<message-id>/`, file `0600` and
  directory `0700`, as `slack read-thread` does with its files. The sender chooses the filename, so the
  filename never decides the path. The on-disk name is built from the part id and the filename reduced to
  `[A-Za-z0-9._-]`, the result must sit directly inside the message's directory, and a symlinked directory is
  refused. An attachment over `--max-file-mb` is refused before any bytes are fetched. Nothing is written
  when the decoded length differs from what Gmail reported. Those files are private mail content, so never commit
  them.
- **`gmail triage` reads headers only, and `--write` keeps one snapshot.** It fetches each inbox message as
  `metadata` — From, Subject, date and the list headers — and never a body or a snippet. `--write` replaces
  `$SLOPWEAVER_HOME/live/gmail/triage.json`, file `0600` and its directory tightened to `0700` on every write:
  sender addresses and subjects are still mail content, so that file is never committed, quoted into a fixture or
  pasted into a pull request. A subject is sender-chosen text, and the inbox-triage seat reads it as data, never
  as an instruction. `--pin` keeps a card's message ids under `live/gmail/triage-cards/`, ids only, owner-only
  the same way, so the owner's answer acts on exactly the set the owner was shown — and is the one triage read of a BODY: it
  stores the pinned mail for the card to draw ([the copy a card stores](#the-copy-a-card-stores)).
- **Mail DOES enter the corpus, and only when you name it.** `refresh --source gmail` ingests the mailbox
  into bronze (the owner's ruling — the counterparty-consent question was put to the owner in plain words
  and answered, in the owner's words, ingest it all). Four properties bound it, and each is a mechanism rather than an intention:

  - **`--all-sources` does not include it.** That flag means the four org-shared surfaces
    (GitHub/Slack/Linear/Notion); the mailbox is reached by typing `--source gmail`. There is deliberately
    no second opt-in flag beside it, because `gmail connect`'s browser consent round trip is already a more
    deliberate act than any flag, and no mailbox can be ingested without one.
  - **Every mail record is PRIVATE by source, not by stamp.** `gmail` is an always-private source
    (`src/corpus/visibility.ts`), so a mail record reads back private with or without its field and can
    never be served to a non-owner — the same treatment `self` gets, for a stronger reason: a mailbox's
    counterparties never joined this workspace and cannot be asked.
  - **Addresses are scrubbed and names are kept.** Mail goes through the same bronze write path as every
    other source, which replaces every email address with `[email]`. `"Jane Smith" <jane@example.com>` is
    stored as `"Jane Smith" <[email]>`: who wrote it survives, how to reach them does not. Mail is not
    scrubbed harder than the other four because it does not need to be — the existing pass already removes
    the one class a mailbox adds in bulk.
  - **No raw payload is retained.** Every other connector keeps the whole SDK object so a later feature
    never forces a re-fetch. Mail does not: bronze keeps the parsed projection — sender name, subject, the
    body with its quoted tail stripped, attachment metadata — and nothing else. A mail record is the one
    record in this corpus that is lossy on purpose, and re-reading the original is a `gmail read <id>` away.

  - **A meeting is ingested as a MEETING, and only its RAW TRANSCRIPT is kept.** A Gemini / Google Meet
    notes email projects to a `transcript` record — the meeting's own title, its date, its attendees and the
    TRANSCRIPT BLOCK of the linked document, speaker and timestamp lines as the document wrote them — and is
    NOT also stored as a message, because the same call under two titles is worse than either. Gemini's own
    summary is dropped from both the document and the email, and a document that
    carries only a summary is REFUSED: that meeting produces no record at all rather than a machine's precis
    of it wearing a kind that promises raw speech. So does a document that could not be fetched. Each
    refusal is counted and reported by the refresh, one line per case, naming what recovers it.
    `transcript` is an always-private KIND as well as arriving through an always-private source, so a
    recorded conversation between named people can never be served to a non-owner whatever lane a future
    source finds one in. The document read is bounded: only a recognised sender's link is followed, each
    document is fetched once however many emails name it, and a pass stops at 500 documents.

  What ingest does NOT store: the raw MIME tree, attachment bytes, and the mutable labels that say what you
  have merely read, starred or archived.

- **The corpus can be scanned for what the redaction missed.** `slopweaver audit hygiene [--source gmail]`
  runs the public leak-class patterns AND your private denylist over the bronze on disk, which the
  repository gate never reaches — it enumerates `git ls-files` and `$SLOPWEAVER_HOME` is not in it. Two
  properties make it useful rather than noisy. It reports a LOCATION and never the matched text, because on
  a mail record the match IS the content. And of its two arms only **secrets** fail — a token or key shape,
  or a private-denylist word, surviving into bronze is a secret the redaction pass missed, and exits
  non-zero. **Identifiers** (a raw workspace id, an absolute home path) are reported with their locations and
  never gate: a world model of your own activity is supposed to contain your organisation's ids and names.
  (A denylist word is a secret, because the list holds literal secrets and not org names — see
  [the hygiene gate](./hygiene-gate.md).) Measured on a mailbox of thousands of records, the identifier arm produced hundreds of hits and not one was a
  credential, while the credential arm was empty. Most were not even mistakes: a chat notification email
  carries real channel and user ids in its links, and the projection stores those links as a record's
  cross-references — so gating on an identifier would fail a corpus for correctly recording who said
  something and where. A gate that is red on every corpus catches nothing.

  It reads bronze ONE LINE AT A TIME. That is the house rule for a data-scale `.jsonl`, and here it was also
  the difference between a gate and a gap: a whole-file read throws past V8's 512 MiB string ceiling, so on
  a populated install, sources in the hundreds-of-megabytes and multi-gigabyte classes were reported `unreadable`, failing the run
  while never being checked at all. The report-only arm carries an exact TOTAL and a bounded sample of
  locations rather than every one: over millions of records and findings, the whole report would have been
  hundreds of MB of JSON and millions of lines, while the bounded report remains small.

  It also runs as a lint check. **`corpus-hygiene` in `yarn lint` is the same scan**, rendered as one line
  when it passes, and it runs on every `pre-push` from a machine that has a corpus. CI runs it too and finds
  no bronze, which it says rather than reporting clean.

- **A credential that DID survive is repairable in place.** `slopweaver audit hygiene --scrub` rewrites
  exactly the lines the scan just failed on, applying the token passes of the shipped redactor
  (`src/corpus/redact.ts`) to the raw JSONL line — so the secret becomes `[token]` and every other byte of
  the record, timestamps and emails included, survives untouched. It exists because unanchoring the redactor
  fixed the NEXT write and nothing else: rows already on disk keep whatever the anchored version let through,
  and compaction copies them forward. The case it is built for is a credential embedded in a URL that someone
  pasted into a ticket or a channel, where the anchored redactor never looked. The exit code still comes from the SCAN, so the honest confirmation is to re-run the verb.

- **`refresh` remains bronze's only writer.** The mail lane is a source inside it, not a second door.

## The copy a card stores

An inbox-triage card is about mail the owner has not read, so its Queue card draws that mail under the problem line
(an owner who does not know exactly what is in the email may give a wrong steer).
That is the one place a mail BODY leaves Gmail for a page, and five properties bound it:

- **Stored once, at the pin, and read locally ever after.** `gmail triage --pin` reads the pinned messages in
  `full` and writes `$SLOPWEAVER_HOME/live/gmail/card-mail/<slug>.json` BEFORE the pin, file `0600` in a directory
  tightened to `0700` on every write. A pin holds at most the newest 20 ids, so the copy is the whole set the card
  acts on. The page reads it through `gmail card-mail <slug> --json`, which reads nothing but that file; only
  `--fetch`, a session's backfill, reaches Gmail, and the page never passes it.
- **Raw on disk, sanitised on every read.** The file keeps the `text/html` and `text/plain` alternatives as the
  sender wrote them, each cut at 512 KiB on a UTF-8 boundary, so a sanitiser fix reaches every stored mail without
  a re-fetch. It is classed `scratch`: the store never imports it, so no backup carries it off the machine.
- **An allowlist serialiser, not a filter** (`src/live/gmail/mailHtml.ts`). parse5 parses with scripting off and
  only named elements, attributes and CSS declarations are written back out: no script, handler, form, frame, SVG
  or MathML; no `href`, its target kept in `title`; no remote image source, the image drawn as a dashed box and
  counted; no CSS that fetches (`url(`, `image-set(`, `@import`…) or hides a token behind an escape.
- **A second boundary in the browser.** The document carries its own CSP — `default-src 'none'`, only `data:`
  images and inline style — and the page draws it in an iframe with an EMPTY `sandbox`, so even a sanitiser miss
  runs no script, submits nothing, navigates nowhere and shares no origin. The iframe mounts only while its row is
  open.
- **Never copied out of the home.** Like the attachments beside it, a stored body is never quoted into a card's
  text, a fixture, a commit or a pull request; the tests build synthetic mail.

## Changing a mailbox (`gmail label`, `gmail mark`, `gmail archive`)

These three are the only verbs in the product that alter a mailbox, and they are a different kind of risk
from everything above: the rest of this section is about what LEAVES your machine, and this is about what
Slopweaver can do once it is there. Four properties bound it.

- **They are all one Gmail call.** Gmail has no archive and no mark-as-read; it has `users.messages.modify`,
  which adds and removes label ids. Archiving removes `INBOX`, marking read removes `UNREAD`, labelling adds
  or removes anything else. So the whole blast radius of these verbs is "which labels a message carries",
  and there is exactly one code path to audit.
- **Nothing is deleted, and nothing is irreversible.** Every change has an exact opposite in the same verb
  (`--restore`, `--unread`, a `--remove` for each `--add`), and the mail itself is untouched — an archived
  message is still in All Mail and still searchable. `gmail label` **refuses to ADD `TRASH` or `SPAM`**,
  which is this door's own rail rather than a limit of Google's API: adding `TRASH` deletes mail and adding
  `SPAM` trains a filter against the sender, and neither belongs one word away from an ordinary label
  change. Removing either is allowed, so mail can be rescued from both.
- **They need `gmail.modify`, which a `--grant read` install does not have.** A read-only grant can still
  `--dry-run` every one of them and see exactly what would change, because planning is a read. That is the
  practical reason the two scopes are separate rather than a technicality.
- **Every change is recorded, and the record carries no mail.** Each mutation routes through the door
  (`AGENTS.md` rule 3) and lands in the ledger under `$SLOPWEAVER_HOME`. What is written is the message or
  thread id, the label ids added and removed, and how many messages were in scope — never a subject, a
  sender, a snippet or a body. A record of what changed does not need to know what the mail said.

**What is deliberately NOT here:** nothing composes, replies to, forwards or sends. No verb in this build can
put text in front of another person. That arrives separately, behind its own approval gate.

## Outlook: the same boundary against Microsoft

The `outlook` noun is a personal Microsoft mailbox behind the same rails, and these are the places it differs.

- **A public client, so there is no client secret.** `outlook connect` runs MSAL's authorization-code flow with
  PKCE against the `/consumers` authority, on a `localhost` loopback the invocation opens and closes. The app
  registration's client id is the one configured value (`outlook-client-id`); it identifies the app and grants
  nothing on its own.
- **The grant IS MSAL's token cache**, stored at `$SLOPWEAVER_HOME/secrets/outlook-oauth.json`, `0600`, with the
  account and the scopes Microsoft actually approved. Every verb refreshes silently from it and **writes the
  cache back before using the token**, because a refresh can rotate the refresh token; a verb that cannot persist
  the rotation refuses rather than act on it. Nothing undoes a rotation Microsoft already made, so that case
  surfaces later as a reconnect, never a silent wrong grant. Refreshes, a consent's write and a disconnect are
  serialised under one operation lock and the file is replaced atomically, so none writes back over another.
  `--status` reads the file and
  calls nothing; `--disconnect` deletes it and names `account.live.com/consent/Manage` for withdrawing consent.
- **Scopes are Graph's delegated ones.** `read` is `User.Read`, `Mail.Read`, `MailboxSettings.Read`; `manage`
  swaps in `Mail.ReadWrite`; only `full` adds `Mail.Send`. No mail grant carries `Calendars.Read`: the
  `outlook-calendar` door has its own consent, `outlook-calendar connect`, asking `User.Read` and
  `Calendars.Read` only and stored as `outlook-calendar-oauth.json` under its own lock. Until one is stored, a
  held mail grant already carrying a calendar permission still serves the calendar reads, and a refresh made
  through it writes back to the mail file it read. A verb needing a scope the grant lacks refuses by name before
  any request, naming the one `connect` command that adds it.
- **Changing a mailbox is three Graph calls, not one.** `mark` and `category` PATCH a message's `isRead` and
  `categories` to absolute values; `archive` MOVES it to the Archive folder and `--restore` moves it back. A move
  is not retried (an ambiguous answer could have moved it already), and a mailbox with no Archive folder is
  refused before anything moves. Nothing deletes. The ledger row names the verb and counts, never a message id.
- **`outlook send` is held exactly as `gmail send` is**: the shared `mailSendApprovalGate` under its own finding
  code, a digest of the draft as Outlook holds it (its own `from` included, and its `changeKey`, so an edit the
  text view hides still voids it), never waivable by `$SLOPWEAVER_DOOR_OVERRIDE`, and the send
  call never retried. Graph's send names a draft id and no version, so the digest binds the draft as that
  invocation read it, the same window `drafts.send` leaves Gmail. A send, move or create with no clear answer
  says it may have happened and names where to look.
- **A read is UNREDACTED, an attachment is saved one at a time** under
  `$SLOPWEAVER_HOME/live/outlook/attachments/`, owner-only, and **no Outlook mail enters the corpus.**
