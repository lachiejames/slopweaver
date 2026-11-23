/**
 * Lazy manifest for the `outlook` noun — the Microsoft mail door, for a personal Outlook.com account.
 *
 * The same three contracts as `gmail`'s manifest, drawn on the same lines:
 *
 * - `list`, `read`, `folders`, `categories`, `measure` and `triage` are reads (`external-read`).
 * - `connect` writes a credential under `$SLOPWEAVER_HOME` and touches no mail, and `attachment` saves one file's
 *   bytes under it, so both are `local-state`.
 * - `category`, `mark`, `archive`, `draft` and `send` change the mailbox, so they are `external-write` and
 *   `doorRouted`. `send` is the one that reaches another person, and the only one whose door request declares
 *   `requiresApproval`: the shared mail approval gate HOLDS unless `--approve` carries the digest of the draft
 *   as Outlook holds it now.
 *
 * Every parser refuses a malformed tail before a credential is read (`../commands/outlook/core.ts`), so every
 * verb is `parseRejectIsIoFree`. A verb is `dryParseSafe` only when a bare invocation is itself a refusal.
 */
import {
  OUTLOOK_ARCHIVE_USAGE,
  OUTLOOK_ATTACHMENT_USAGE,
  OUTLOOK_CATEGORIES_USAGE,
  OUTLOOK_CATEGORY_USAGE,
  OUTLOOK_CONNECT_USAGE,
  OUTLOOK_DRAFT_USAGE,
  OUTLOOK_FOLDERS_USAGE,
  OUTLOOK_LIST_USAGE,
  OUTLOOK_MARK_USAGE,
  OUTLOOK_MEASURE_USAGE,
  OUTLOOK_READ_USAGE,
  OUTLOOK_SEND_USAGE,
  OUTLOOK_TRIAGE_USAGE,
} from "../commands/outlook/outlookUsage.js";
import { lazy, type VerbManifestEntry } from "../manifest.js";

/** Every `outlook` verb. */
export const outlookManifest: Readonly<Record<string, VerbManifestEntry>> = {
  archive: lazy({
    load: () => import("../commands/outlook/modifyRun.js").then((m) => m.outlookArchiveCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: true,
      // With no id it refuses on the pure parser, having read nothing.
      dryParseSafe: true,
      effect: "external-write",
      example: "slopweaver outlook archive AAMkAGI2-example-message-id --thread --dry-run",
      parseRejectIsIoFree: true,
      summary: "Move messages to the Archive folder (or back to the Inbox) — refused when the mailbox has none",
      usage: OUTLOOK_ARCHIVE_USAGE,
    },
  }),
  attachment: lazy({
    load: () => import("../commands/outlook/attachmentRun.js").then((m) => m.outlookAttachmentCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      // A read that persists bytes under the home: nothing changes in the mailbox, so no door.
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example: 'slopweaver outlook attachment AAMkAGI2-example-message-id --name "notes.pdf"',
      parseRejectIsIoFree: true,
      summary: "Save one file attachment's bytes owner-only under this home and print the path",
      usage: OUTLOOK_ATTACHMENT_USAGE,
    },
  }),
  categories: lazy({
    load: () => import("../commands/outlook/readRun.js").then((m) => m.outlookCategoriesCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: false,
      effect: "external-read",
      example: "slopweaver outlook categories",
      parseRejectIsIoFree: true,
      summary: "List the mailbox's categories — the names `outlook category` adds and removes",
      usage: OUTLOOK_CATEGORIES_USAGE,
    },
  }),
  category: lazy({
    load: () => import("../commands/outlook/modifyRun.js").then((m) => m.outlookCategoryCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: true,
      dryParseSafe: true,
      effect: "external-write",
      example: 'slopweaver outlook category AAMkAGI2-example-message-id --add "Waiting on" --dry-run',
      parseRejectIsIoFree: true,
      summary: "Add and remove categories on a message or its whole conversation, by name or id",
      usage: OUTLOOK_CATEGORY_USAGE,
    },
  }),
  connect: lazy({
    load: () => import("../commands/outlook/connectRun.js").then((m) => m.outlookConnectCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      // A bare `outlook connect` opens a socket and a browser, so it is not no-args-safe; its REJECT path is.
      dryParseSafe: false,
      effect: "local-state",
      example: "slopweaver outlook connect --grant manage",
      parseRejectIsIoFree: true,
      summary: "Authorise a personal Outlook mailbox by browser consent and store the grant owner-only",
      usage: OUTLOOK_CONNECT_USAGE,
    },
  }),
  draft: lazy({
    load: () => import("../commands/outlook/composeRun.js").then((m) => m.outlookDraftCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: true,
      // With no `--form` it refuses on the pure parser, having read nothing and not consumed stdin.
      dryParseSafe: true,
      effect: "external-write",
      example: 'echo \'{"to":["a@example.com"],"subject":"hi","body":"..."}\' | slopweaver outlook draft --form -',
      parseRejectIsIoFree: true,
      summary: "Store a message as a draft in your own Outlook mailbox — nothing is sent",
      usage: OUTLOOK_DRAFT_USAGE,
    },
  }),
  folders: lazy({
    load: () => import("../commands/outlook/readRun.js").then((m) => m.outlookFoldersCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: false,
      effect: "external-read",
      example: "slopweaver outlook folders",
      parseRejectIsIoFree: true,
      summary: "List every visible mail folder with its path, id and counts",
      usage: OUTLOOK_FOLDERS_USAGE,
    },
  }),
  list: lazy({
    load: () => import("../commands/outlook/readRun.js").then((m) => m.outlookListCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: false,
      effect: "external-read",
      example: 'slopweaver outlook list --query "invoice" --unread --limit 20',
      parseRejectIsIoFree: true,
      summary: "List or search a folder's messages — sender, subject, preview, never bodies",
      usage: OUTLOOK_LIST_USAGE,
    },
  }),
  mark: lazy({
    load: () => import("../commands/outlook/modifyRun.js").then((m) => m.outlookMarkCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: true,
      dryParseSafe: true,
      effect: "external-write",
      example: "slopweaver outlook mark AAMkAGI2-example-message-id --read --thread",
      parseRejectIsIoFree: true,
      summary: "Mark a message, or its whole conversation, read or unread",
      usage: OUTLOOK_MARK_USAGE,
    },
  }),
  measure: lazy({
    load: () => import("../commands/outlook/readRun.js").then((m) => m.outlookMeasureCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: false,
      effect: "external-read",
      example: "slopweaver outlook measure",
      parseRejectIsIoFree: true,
      summary: "Count the mailbox from Microsoft's own per-folder counters — not bytes, not dates",
      usage: OUTLOOK_MEASURE_USAGE,
    },
  }),
  read: lazy({
    load: () => import("../commands/outlook/readRun.js").then((m) => m.outlookReadCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "external-read",
      example: "slopweaver outlook read AAMkAGI2-example-message-id --thread",
      parseRejectIsIoFree: true,
      summary: "Read one message in full, or its whole conversation oldest first",
      usage: OUTLOOK_READ_USAGE,
    },
  }),
  send: lazy({
    load: () => import("../commands/outlook/composeRun.js").then((m) => m.outlookSendCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: true,
      dryParseSafe: true,
      effect: "external-write",
      example: "slopweaver outlook send AAMkAGI2-example-message-id",
      parseRejectIsIoFree: true,
      summary: "Send an existing draft — shown first, held until --approve carries its digest",
      usage: OUTLOOK_SEND_USAGE,
    },
  }),
  triage: lazy({
    load: () => import("../commands/outlook/readRun.js").then((m) => m.outlookTriageCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: false,
      effect: "external-read",
      example: "slopweaver outlook triage --limit 50",
      parseRejectIsIoFree: true,
      summary: "Group the inbox's newest messages by sender, newest group first — headers only",
      usage: OUTLOOK_TRIAGE_USAGE,
    },
  }),
};
