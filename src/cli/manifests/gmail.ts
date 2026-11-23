/**
 * Lazy manifest for the `gmail` noun — the mail door.
 *
 * ## Three contracts, and the lines between them
 *
 * `connect`, `list`, `read` and `labels` cannot change a mailbox: `connect` writes a credential under
 * `$SLOPWEAVER_HOME` and touches no mail, and the other three are reads. `label`, `mark`, `archive` and
 * `draft` can, so they are `external-write` + `doorRouted` — a different contract, and one the door-coverage
 * ratchet enforces rather than trusts. `send` is `external-write` too, and is the only verb here that can
 * reach another person. `unsubscribe` is `external-write` and routed as well, and the one whose write goes to
 * the SENDER rather than to Google: RFC 8058's one-click POST, which changes what reaches this mailbox.
 *
 * `attachment` is a read that WRITES LOCALLY: it changes nothing in the mailbox, and it saves one
 * attachment's bytes under `$SLOPWEAVER_HOME/live/gmail/attachments/`, so it is `local-state`, not a read.
 * `triage` and `card-mail` are the same contract, declared in `./gmailTriage.ts`: the verbs behind an inbox-triage
 * card, which store the mail a card pins and print it back from this home alone.
 *
 * `clear-meeting-notes` is `external-write` + `doorRouted` because its one mailbox write is `archive`'s own run;
 * before that it ingests a missing Gemini transcript into gmail bronze, and it archives a mail only once that
 * transcript is proven held, or once its notes document is read and holds no transcript at all.
 *
 * These rows used to carry a `requiresApproval: true` boolean that `catalog` rendered as `[approval]`. It
 * was this file's own words that it was "the CATALOG's mutation marker … not an interactive prompt" — a
 * second, unenforced spelling of `effect: "external-write"`, printed as a safety property nothing supplied.
 * The field is gone; `catalog` prints `[external-write]` from the field the coverage gate enforces.
 * `src/admit/approval.ts` carries the finding.
 *
 * `send` is the exception every other verb here exists to keep narrow, and it is the only one here whose DOOR
 * request declares `requiresApproval`. Its gate is `gmailSendApprovalGate`
 * (`src/outbound/gmail/approvalGate.ts`), which the shell attaches to the door and which HOLDS unless
 * `--approve` carries the digest of the draft as it currently stands. A hold is un-waivable by
 * `$SLOPWEAVER_DOOR_OVERRIDE` at the type level, which is why the gate is expressed as one — and the door
 * refuses the claim outright if that gate ever stops being attached.
 *
 * `label`, `mark`, `archive` and `draft` take `--dry-run`, which prints exactly what would happen and
 * changes nothing — see `../commands/gmail/modifyRun.js` for why a dry run stops BEFORE the door. `send`
 * deliberately has no `--dry-run`: an unapproved send IS its preview, and it is routed so that the refusal
 * is recorded. See `../commands/gmail/composeRun.js`.
 */
import { GMAIL_CLEAR_MEETING_NOTES_USAGE } from "../commands/gmail/clearMeetingNotesUsage.js";
import { GMAIL_UNSUBSCRIBE_USAGE } from "../commands/gmail/unsubscribeUsage.js";
import { lazy, type VerbManifestEntry } from "../manifest.js";
import { gmailTriageManifest } from "./gmailTriage.js";

const CONNECT_USAGE =
  "usage: slopweaver gmail connect [--grant <read|manage|full>] [--status] [--revoke] [--json]\n" +
  "       [--home <dir>]\n" +
  "  Opens Google's consent screen in your browser and stores the resulting grant, owner-only (0600)\n" +
  "  --grant   which capabilities to request (default manage: read + labels/read-state/archive)\n" +
  "            read = gmail.readonly · manage = + gmail.modify · full = + gmail.compose + gmail.send\n" +
  "  --status  report the stored grant's account and scopes and stop — no browser, no socket, no network\n" +
  "  --revoke  withdraw the stored grant at Google and delete it — Google revokes the whole\n" +
  "            (client, account) grant at once, so every door sharing this OAuth client goes with it\n" +
  "  --json    emit the token-free grant status as one machine-readable document\n" +
  "  Needs the USER-DATA Desktop-app OAuth client: `slopweaver secrets set google-client-id` and\n" +
  "  `slopweaver secrets set google-client-secret` — the one the mail, Drive and calendar doors share.\n" +
  "  The Google Admin door consents through `google-admin-client-id` instead, so no admin consent can\n" +
  "  put a write scope on this credential. The grant records the scopes Google ACTUALLY approved";

const LIST_USAGE =
  "usage: slopweaver gmail list [--query <gmail-search>] [--label <ID>]... [--limit <1..100>] [--json] " +
  "[--home <dir>]\n" +
  "  Lists matching messages as metadata only — sender, subject, snippet, labels. No bodies are read\n" +
  "  --query   a Gmail search expression, exactly as the Gmail search box takes it (`is:unread from:x`)\n" +
  "  --label   restrict to a label ID (repeatable); INBOX, UNREAD and STARRED are the built-in ones\n" +
  "  --limit   how many messages to read (default 25, maximum 100)\n" +
  "  --json    emit one machine-readable document with freshness, coverage and residue\n" +
  "  One page, never the whole mailbox: the residue says when more matched than was read";

const READ_USAGE =
  "usage: slopweaver gmail read <message-id> [--thread] [--json] [--home <dir>]\n" +
  "  Reads one message in full, bodies included, and states what the read did not establish\n" +
  "  --thread  read every message in the thread the id names — a thread id, or any message's id in it\n" +
  "  --json    emit one machine-readable document with freshness, coverage and residue\n" +
  "  Attachments are reported by name, media type and size and never downloaded — `gmail attachment` fetches one";

const ATTACHMENT_USAGE =
  "usage: slopweaver gmail attachment <message-id> [--name <filename>] [--part <partId>] [--max-file-mb <n>] " +
  "[--json] [--home <dir>]\n" +
  "  Fetches ONE attachment's bytes and saves them owner-only (0600) under\n" +
  "  $SLOPWEAVER_HOME/live/gmail/attachments/<message-id>/, then prints READ THIS: <path>\n" +
  "  --name        the attachment's exact filename, as `gmail read` lists it\n" +
  "  --part        the attachment's part id — what a refusal lists when two attachments share a name\n" +
  "  --max-file-mb refuse, BEFORE fetching, an attachment larger than this (default 25)\n" +
  "  --json        emit one machine-readable document naming the saved path, never the bytes\n" +
  "  At least one of --name or --part is required; given both, both must match. The saved file is\n" +
  "  UNREDACTED and named from the part id, never from the sender-chosen filename alone";

const MEASURE_USAGE =
  "usage: slopweaver gmail measure [--query <gmail-search>] [--sample-bytes <0..500>] [--json] [--home <dir>]\n" +
  "  Sizes the mailbox BEFORE a full-history backfill — how many messages, how far back, how many bytes\n" +
  "  --query        measure within a Gmail search expression instead of the whole mailbox\n" +
  "  --sample-bytes how many messages to read for their size (default 40, maximum 500)\n" +
  "  --json         emit one machine-readable document with freshness, coverage and residue\n" +
  "  The count and the two dates are EXACT — the walk enumerates ids and reads no bodies. The byte\n" +
  "  figure is an ESTIMATE projected from the sample, and every rendering says so and names the sample";

const LABELS_USAGE =
  "usage: slopweaver gmail labels [--json] [--home <dir>]\n" +
  "  Lists every label in the mailbox with its display name and the ID the API takes\n" +
  "  --json    emit one machine-readable document with freshness, coverage and residue\n" +
  "  Gmail's API takes label IDs and its interface shows label NAMES; this is how you see both";

const LABEL_USAGE =
  "usage: slopweaver gmail label <message-id> [--add <name-or-id>]... [--remove <name-or-id>]... [--thread] " +
  "[--dry-run] [--json] [--home <dir>]\n" +
  "  Adds and removes labels on one message, or on every message in its thread\n" +
  "  --add     a label to add, by display name or ID (repeatable)\n" +
  "  --remove  a label to remove, by display name or ID (repeatable)\n" +
  "  --thread  treat the id as a THREAD id and change every message in it\n" +
  "  --dry-run resolve and print exactly what would change, and send nothing\n" +
  "  At least one --add or --remove is required. TRASH and SPAM cannot be ADDED through this verb —\n" +
  "  one deletes mail and the other trains a filter against the sender; removing either is allowed";

const MARK_USAGE =
  "usage: slopweaver gmail mark <message-id> (--read | --unread) [--thread] [--dry-run] [--json] " +
  "[--home <dir>]\n" +
  "  Marks one message read or unread — Gmail's UNREAD label, removed or added\n" +
  "  --read    mark it read\n" +
  "  --unread  mark it unread\n" +
  "  --thread  treat the id as a THREAD id and change every message in it\n" +
  "  --dry-run print exactly what would change, and send nothing\n" +
  "  Exactly one of --read or --unread is required; neither is a default, because the two are opposites\n" +
  "  and the wrong one is invisible until someone notices unread mail they never opened is not bold";

const ARCHIVE_USAGE =
  "usage: slopweaver gmail archive <message-id>... [--restore] [--thread] [--dry-run] [--json] [--home <dir>]\n" +
  "  Archives each message — Gmail's INBOX label, removed. Nothing is deleted and the mail stays searchable\n" +
  "  --restore put it BACK in the inbox instead\n" +
  "  --thread  treat each id as a THREAD id and archive every message in it\n" +
  "  --dry-run print exactly what would change, and send nothing\n" +
  "  Archiving ONE message leaves the rest of its thread in the inbox — --thread moves the conversation.\n" +
  "  Up to 100 ids, each its own change and its own report; any id that fails makes the exit 1";

const DRAFT_USAGE =
  "usage: slopweaver gmail draft (--form <json|-> [--reply-to <message-id>] | --board <slug> --expect <digest>) " +
  "[--dry-run] [--json] [--home <dir>]\n" +
  "  Composes a message and stores it as a draft in your own mailbox. Nothing is sent\n" +
  "  --form     the message as JSON: { to, cc, bcc, subject, body }. `-` reads it from stdin\n" +
  "  --board    draft the MAIL action a board row's open ask offers, instead of a form — a reply when it records one\n" +
  "  --expect   the digest its console preview printed; a row whose mail changed since is refused\n" +
  "  --reply-to compose as a reply to this message id, inheriting its thread and its subject\n" +
  "  --dry-run  print the composed message and store nothing\n" +
  "  Prefer `--form -`: a body on a command line is a body the shell rewrites. The form is STRICT,\n" +
  "  so a key it does not know is refused with the nearest field named rather than silently dropped";

const SEND_USAGE =
  "usage: slopweaver gmail send <draft-id> [--approve <digest>] [--json] [--home <dir>]\n" +
  "  Sends an existing draft. THIS PUTS MAIL IN FRONT OF ANOTHER PERSON and cannot be undone\n" +
  "  --approve the digest printed by the unapproved run, which covers that exact content\n" +
  "  Run it with no --approve first: that prints the message as Gmail holds it, plus its digest,\n" +
  "  and sends nothing. There is no separate dry-run mode: the unapproved run IS the preview, and it is\n" +
  "  routed through the door so a refused attempt is recorded rather than silently discarded";

export const gmailManifest: Readonly<Record<string, VerbManifestEntry>> = {
  archive: lazy({
    load: () => import("../commands/gmail/modifyRun.js").then((m) => m.gmailArchiveCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: true,
      // Genuinely no-args-safe: `gmail archive` with no id refuses on the pure parser, having read nothing.
      dryParseSafe: true,
      effect: "external-write",
      example: "slopweaver gmail archive 19c4f2a1b0d3e5f7 --thread --dry-run",
      parseRejectIsIoFree: true,
      summary: "Archive one message or a whole thread — Gmail's INBOX label removed, nothing deleted",
      usage: ARCHIVE_USAGE,
    },
  }),
  attachment: lazy({
    load: () => import("../commands/gmail/attachmentRun.js").then((m) => m.gmailAttachmentCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      // A READ, not a write: nothing changes in the mailbox and nothing leaves for Google but the request, so it
      // does not go through the admit door. It does persist the attachment's bytes under the home, which is
      // why the effect is `local-state` — the same classification `slack read-thread` carries.
      doorRouted: false,
      // Genuinely no-args-safe: with no id, or no --name/--part, it refuses on the pure parser.
      dryParseSafe: true,
      effect: "local-state",
      example: 'slopweaver gmail attachment 19c4f2a1b0d3e5f7 --name "notes.txt"',
      parseRejectIsIoFree: true,
      summary: "Fetch one attachment's bytes and save them owner-only under this home, printing the path",
      usage: ATTACHMENT_USAGE,
    },
  }),
  "clear-meeting-notes": lazy({
    load: () => import("../commands/gmail/clearMeetingNotesRun.js").then((m) => m.gmailClearMeetingNotesCommand),
    meta: {
      // A mail whose transcript the owner has to reach themselves gets ONE Queue card, through `handover register`.
      createsWorkItem: true,
      diagnostic: false,
      // The archive is `gmail archive`'s own run, so every mailbox change goes through that verb's door request.
      doorRouted: true,
      // A bare run reads the inbox and may archive, so it is not no-args-safe; its REJECT path is.
      dryParseSafe: false,
      effect: "external-write",
      example: "slopweaver gmail clear-meeting-notes --dry-run",
      parseRejectIsIoFree: true,
      summary:
        "Archive each Gemini meeting-notes mail once its transcript is proven in the corpus (ingesting it first), or its notes hold none",
      usage: GMAIL_CLEAR_MEETING_NOTES_USAGE,
    },
  }),
  connect: lazy({
    load: () => import("../commands/gmail/connectRun.js").then((m) => m.gmailConnectCommand),
    meta: {
      createsWorkItem: false,
      // Not a diagnostic: `--status` reporting "not connected" is a finding, but the flow itself either
      // stores a grant or fails, and a failed consent is a broken run rather than a reported state.
      diagnostic: false,
      doorRouted: false,
      // NOT dryParseSafe, and the distinction is the point: a bare `gmail connect` is a valid invocation
      // that opens a socket and a browser, so "no args does nothing" is false of it. The narrower claim IS
      // true — a bad flag or an unknown `--grant` is refused by the pure parser before any of that.
      dryParseSafe: false,
      effect: "local-state",
      example: "slopweaver gmail connect --grant manage",
      parseRejectIsIoFree: true,
      summary: "Authorise a Google mailbox by browser consent and store the grant owner-only under this home",
      usage: CONNECT_USAGE,
    },
  }),
  draft: lazy({
    load: () => import("../commands/gmail/composeRun.js").then((m) => m.gmailDraftCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: true,
      // Genuinely no-args-safe: `gmail draft` with no `--form` refuses on the pure parser, having read
      // nothing and — the part that matters on this verb — not having consumed stdin.
      dryParseSafe: true,
      effect: "external-write",
      example: 'echo \'{"to":["a@example.com"],"subject":"hi","body":"..."}\' | slopweaver gmail draft --form -',
      parseRejectIsIoFree: true,
      summary: "Compose a message and store it as a draft in your own mailbox — nothing is sent",
      usage: DRAFT_USAGE,
    },
  }),
  list: lazy({
    load: () => import("../commands/gmail/readRun.js").then((m) => m.gmailListCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      // A bare `gmail list` is a valid whole-mailbox read, so it is not no-args-safe; its REJECT path is.
      dryParseSafe: false,
      effect: "external-read",
      example: 'slopweaver gmail list --query "is:unread" --limit 20',
      parseRejectIsIoFree: true,
      summary: "List matching messages as metadata only — sender, subject, snippet, labels, never bodies",
      usage: LIST_USAGE,
    },
  }),
  label: lazy({
    load: () => import("../commands/gmail/modifyRun.js").then((m) => m.gmailLabelCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: true,
      dryParseSafe: true,
      effect: "external-write",
      example: 'slopweaver gmail label 19c4f2a1b0d3e5f7 --add "Waiting on" --remove INBOX',
      parseRejectIsIoFree: true,
      summary: "Add and remove labels on one message or a whole thread, resolving display names to IDs",
      usage: LABEL_USAGE,
    },
  }),
  labels: lazy({
    load: () => import("../commands/gmail/modifyRun.js").then((m) => m.gmailLabelsCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      // A bare `gmail labels` is a valid whole-vocabulary read, so it is not no-args-safe; its REJECT path is.
      dryParseSafe: false,
      effect: "external-read",
      example: "slopweaver gmail labels --json",
      parseRejectIsIoFree: true,
      summary: "List the mailbox's whole label vocabulary — display name and the ID the API takes",
      usage: LABELS_USAGE,
    },
  }),
  mark: lazy({
    load: () => import("../commands/gmail/modifyRun.js").then((m) => m.gmailMarkCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: true,
      dryParseSafe: true,
      effect: "external-write",
      example: "slopweaver gmail mark 19c4f2a1b0d3e5f7 --read --thread",
      parseRejectIsIoFree: true,
      summary: "Mark one message or a whole thread read or unread — Gmail's UNREAD label, removed or added",
      usage: MARK_USAGE,
    },
  }),
  measure: lazy({
    load: () => import("../commands/gmail/readRun.js").then((m) => m.gmailMeasureCommand),
    meta: {
      createsWorkItem: false,
      // A finding about the mailbox, not a change to it: it answers "how big is this" and nothing else,
      // which is the same shape as `connect --check` reporting what a token can reach.
      diagnostic: true,
      doorRouted: false,
      // A bare `gmail measure` is a valid whole-mailbox measurement, so it is not no-args-safe; its
      // REJECT path is — an unparseable `--sample-bytes` is refused before a credential is read.
      dryParseSafe: false,
      effect: "external-read",
      example: "slopweaver gmail measure --json",
      parseRejectIsIoFree: true,
      summary: "Size the mailbox before a backfill — how many messages, how far back, and roughly how many bytes",
      usage: MEASURE_USAGE,
    },
  }),
  read: lazy({
    load: () => import("../commands/gmail/readRun.js").then((m) => m.gmailReadCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      // Genuinely no-args-safe: `gmail read` with no id refuses on the pure parser, having read nothing.
      dryParseSafe: true,
      effect: "external-read",
      example: "slopweaver gmail read 19c4f2a1b0d3e5f7 --thread",
      parseRejectIsIoFree: true,
      summary: "Read one message or one whole thread in full, with explicit bounds and stated residue",
      usage: READ_USAGE,
    },
  }),
  send: lazy({
    load: () => import("../commands/gmail/composeRun.js").then((m) => m.gmailSendCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: true,
      // Genuinely no-args-safe: `gmail send` with no draft id refuses on the pure parser.
      dryParseSafe: true,
      effect: "external-write",
      example: "slopweaver gmail send r-8891234567890123456 --approve 3f9a2c7e1b4d5006",
      parseRejectIsIoFree: true,
      summary: "Send an existing draft — held by the door until an --approve digest matches that draft",
      usage: SEND_USAGE,
    },
  }),
  // `triage` and `card-mail` are declared in `./gmailTriage.ts` and spread in here.
  ...gmailTriageManifest,
  unsubscribe: lazy({
    load: () => import("../commands/gmail/unsubscribeRun.js").then((m) => m.gmailUnsubscribeCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      // The POST goes to the SENDER, not to Google, and it changes what reaches this mailbox: an external write.
      doorRouted: true,
      // Genuinely no-args-safe: `gmail unsubscribe` with no id refuses on the pure parser, having read nothing.
      dryParseSafe: true,
      effect: "external-write",
      example: "slopweaver gmail unsubscribe 19c4f2a1b0d3e5f7 --dry-run",
      parseRejectIsIoFree: true,
      summary: "Perform a sender's RFC 8058 one-click unsubscribe, refusing a sender that publishes none",
      usage: GMAIL_UNSUBSCRIBE_USAGE,
    },
  }),
};
