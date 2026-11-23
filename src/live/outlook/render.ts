/**
 * The Outlook verbs' human output. Pure: every function takes what a verb read and returns the text block it
 * prints, so the shells stay dispatch and exit codes, and the wording is tested without a mailbox.
 *
 * Every block says what it does NOT cover where a reader would otherwise assume it does — a search that
 * filtered unread locally may have underfilled, a listing with more behind it says so, a dry run says nothing
 * was written, and a send preview says nothing was sent.
 */
import { previewBody } from "../gmail/compose.js";
import type { OutlookAttachmentEntry, OutlookReadMessage, OutlookSavedAttachment } from "./attachments.js";
import type { OutlookCategory } from "./categories.js";
import type { OutlookDraftOutcome, OutlookSendPlan } from "./drafts.js";
import type { FolderWalk } from "./folders.js";
import type { OutlookMeasure } from "./measure.js";
import {
  formatOutlookAddress,
  type OutlookListing,
  type OutlookMessage,
  type OutlookMessageSummary,
} from "./messages.js";
import type { OutlookChangeOutcome, OutlookChangePlan } from "./mutations.js";
import type { OutlookTriage } from "./triage.js";

// Each absent field below is NAMED by an early return: the ternary spelling is what oxlint's
// `prefer-nullish-coalescing` rewrites into the `??` that `no-silent-fallback` refuses.

/** A subject as a line shows it. */
function subjectOf({ subject }: { subject: string | null }): string {
  if (subject === null) {
    return "(no subject)";
  }
  return subject;
}

/** A received instant as a line shows it. */
function receivedOf({ message }: { message: OutlookMessageSummary }): string {
  if (message.receivedIso === null) {
    return "(no date)";
  }
  return message.receivedIso;
}

/** A sender as a line shows it. */
function senderOf({ message }: { message: OutlookMessageSummary }): string {
  return message.from === null ? "(no sender)" : formatOutlookAddress({ address: message.from });
}

/** One listing row: a read marker, when, who, what, then the id on its own line to copy. */
function summaryLines({ message }: { message: OutlookMessageSummary }): readonly string[] {
  const marker = message.isRead ? " " : "*";
  const received = receivedOf({ message });
  const clip = message.hasAttachments ? "  [attachments]" : "";
  return [
    `${marker} ${received}  ${senderOf({ message })}`,
    `    ${subjectOf({ subject: message.subject })}${clip}`,
    `    id: ${message.id}`,
  ];
}

/**
 * Render a folder listing or search.
 *
 * @param folder what the owner asked to list, as typed
 * @returns the text block
 */
export function renderOutlookListingText({ listing, folder }: { listing: OutlookListing; folder: string }): string {
  const lines = [`${String(listing.messages.length)} message(s) in ${folder}  (* = unread)`];
  for (const message of listing.messages) {
    lines.push(...summaryLines({ message }));
  }
  if (listing.unreadFilteredLocally) {
    lines.push("unread was filtered over the fetched search results, so fewer than --limit may be shown");
  }
  if (listing.more) {
    lines.push("more messages match — raise --limit or narrow --query");
  }
  return lines.join("\n");
}

/**
 * One attachment line: a file by the name and id `outlook attachment` takes, anything else by its kind, which
 * that verb refuses to save.
 */
function attachmentLine({ attachment }: { attachment: OutlookAttachmentEntry }): string {
  // A nameless one gets its own prefix rather than a placeholder name, which a file could carry for real. A name
  // carrying a control character is not printed: a line break (Cc, or the Zl/Zp separators) could forge that
  // prefix on a line of its own, and a format character (Cf) such as U+202E, a right-to-left override, shows
  // `report<RLO>fdp.exe` as `reportexe.pdf`. Cf also holds the zero-width joiner some emoji use; such a name is
  // saved by id too, which costs a reader a copy and never a spoofed file.
  let label = `attachment: ${String(attachment.name)}`;
  if (attachment.name === null) {
    label = "attachment (no name, save it by id):";
  } else if (/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(attachment.name)) {
    label = "attachment (name has control characters, save it by id):";
  }
  if (attachment.kind !== "fileAttachment") {
    return `${label} [${attachment.kind}] — not a file, so it cannot be saved  id: ${attachment.attachmentId}`;
  }
  let type = "unknown type";
  if (attachment.contentType !== null) {
    type = attachment.contentType;
  }
  const size = attachment.sizeBytes === null ? "size unknown" : `${String(attachment.sizeBytes)} bytes`;
  return `${label} (${type}, ${size}, not downloaded)  id: ${attachment.attachmentId}`;
}

/** One message in full, headers then body. */
function messageLines({ read }: { read: OutlookReadMessage }): readonly string[] {
  const { message, attachments } = read;
  const list = ({ addresses }: { addresses: OutlookMessage["to"] }): string =>
    addresses.map((address) => formatOutlookAddress({ address })).join(", ");
  const saveHint = `save one: \`slopweaver outlook attachment ${message.id} --name <file>\` (or --attachment-id <id>)`;
  const lines = [
    `from: ${senderOf({ message })}`,
    `to: ${list({ addresses: message.to })}`,
    ...(message.cc.length > 0 ? [`cc: ${list({ addresses: message.cc })}`] : []),
    `subject: ${subjectOf({ subject: message.subject })}`,
    `received: ${receivedOf({ message })}`,
    `id: ${message.id}`,
    ...(message.categories.length > 0 ? [`categories: ${message.categories.join(", ")}`] : []),
    ...attachments.map((attachment) => attachmentLine({ attachment })),
    ...(attachments.length > 0 ? [saveHint] : []),
    "",
    message.body,
  ];
  return lines;
}

/**
 * Render one message, or a whole conversation oldest first, each with its attachments listed.
 *
 * @param messages one message, or every message in the conversation, each beside its attachments
 * @returns the text block
 */
export function renderOutlookMessagesText({ messages }: { messages: readonly OutlookReadMessage[] }): string {
  if (messages.length === 1) {
    return messageLines({ read: messages[0]! }).join("\n");
  }
  const blocks = messages.map((read, index) =>
    [`--- ${String(index + 1)} of ${String(messages.length)} ---`, ...messageLines({ read })].join("\n"),
  );
  return blocks.join("\n\n");
}

/**
 * Render the folder hierarchy.
 *
 * @param walk the walked folders, and whether the walk stopped early
 * @returns the text block
 */
export function renderOutlookFoldersText({ walk }: { walk: FolderWalk }): string {
  const lines = walk.folders.map(
    (folder) =>
      `${folder.path.join("/")}  ${String(folder.totalItemCount)} total, ${String(folder.unreadItemCount)} unread  id: ${folder.id}`,
  );
  if (walk.truncated) {
    lines.push("the folder walk stopped at its page ceiling — this list is a prefix of the hierarchy");
  }
  return lines.join("\n");
}

/**
 * Render the mailbox's category list.
 *
 * @returns the text block
 */
export function renderOutlookCategoriesText({ categories }: { categories: readonly OutlookCategory[] }): string {
  if (categories.length === 0) {
    return "no categories defined in this mailbox";
  }
  return categories.map((category) => `${category.displayName}  (${category.color})  id: ${category.id}`).join("\n");
}

/** One planned step as a dry run prints it. */
function stepLine({ step }: { step: OutlookChangePlan["steps"][number] }): string {
  if (step.kind === "unchanged") {
    return `  ${step.id}: already as asked`;
  }
  if (step.kind === "move") {
    return `  ${step.id}: move to ${step.destinationId}`;
  }
  return `  ${step.id}: set ${JSON.stringify(step.patch)}`;
}

/**
 * Render a change plan, for `--dry-run`.
 *
 * @returns the text block, ending on the fact that nothing was written
 */
export function renderOutlookChangePlanText({ plan }: { plan: OutlookChangePlan }): string {
  const writes = plan.steps.filter((step) => step.kind !== "unchanged").length;
  return [
    `${plan.intent}: ${String(writes)} write(s) planned over ${String(plan.steps.length)} message(s)${plan.thread ? " (whole conversations)" : ""}`,
    ...plan.steps.map((step) => stepLine({ step })),
    "DRY RUN — nothing was written",
  ].join("\n");
}

/**
 * Render what applying a change did.
 *
 * @returns the text block, naming a failure and everything it left unattempted
 */
export function renderOutlookChangeOutcomeText({ outcome }: { outcome: OutlookChangeOutcome }): string {
  const lines = [
    `${outcome.intent}: ${String(outcome.changed.length)} changed, ${String(outcome.unchanged.length)} already as asked`,
    ...outcome.changed.map((id) => `  changed: ${id}`),
  ];
  if (outcome.failed !== undefined) {
    lines.push(`  FAILED: ${outcome.failed.id} — ${outcome.failed.message}`);
    lines.push(...outcome.notAttempted.map((id) => `  not attempted: ${id}`));
  }
  return lines.join("\n");
}

/**
 * Render a stored draft, and the one command that previews its send.
 *
 * @returns the text block
 */
export function renderOutlookDraftOutcomeText({ outcome }: { outcome: OutlookDraftOutcome }): string {
  return [
    `DRAFT STORED${outcome.isReply ? " (reply)" : ""}: ${outcome.draftId}`,
    `conversation: ${outcome.conversationId}`,
    "Nothing was sent. To preview the send and get its approval digest:",
    `  slopweaver outlook send ${outcome.draftId}`,
  ].join("\n");
}

/** The envelope lines a send preview and a sent report share. */
function envelopeLines({ plan }: { plan: OutlookSendPlan }): readonly string[] {
  return [
    `from: ${plan.from}`,
    `to: ${plan.to.join(", ")}`,
    ...(plan.cc.length > 0 ? [`cc: ${plan.cc.join(", ")}`] : []),
    ...(plan.bcc.length > 0 ? [`bcc: ${plan.bcc.join(", ")}`] : []),
    `subject: ${subjectOf({ subject: plan.subject })}`,
  ];
}

/**
 * Render a send preview: the draft as Outlook holds it, and the command that sends exactly that.
 *
 * @returns the text block
 */
export function renderOutlookSendPlanText({ plan }: { plan: OutlookSendPlan }): string {
  return [
    `would send draft ${plan.draftId}`,
    ...envelopeLines({ plan }),
    "",
    previewBody({ body: plan.body }),
    "",
    "This preview sends nothing. To send exactly this content:",
    `  slopweaver outlook send ${plan.draftId} --approve ${plan.digest}`,
  ].join("\n");
}

/**
 * Render a sent draft.
 *
 * @returns the text block
 */
export function renderOutlookSentText({ plan }: { plan: OutlookSendPlan }): string {
  return [`SENT: draft ${plan.draftId}`, ...envelopeLines({ plan })].join("\n");
}

/**
 * Render a measurement, its coverage line first so the counts are never read as more than they are.
 *
 * @returns the text block
 */
export function renderOutlookMeasureText({ measure }: { measure: OutlookMeasure }): string {
  const lines = [
    `coverage: ${measure.coverage}`,
    `total: ${String(measure.totalItemCount)} messages, ${String(measure.unreadItemCount)} unread`,
    ...measure.folders.map(
      (folder) => `  ${folder.path}  ${String(folder.totalItemCount)} / ${String(folder.unreadItemCount)} unread`,
    ),
  ];
  if (measure.truncated) {
    lines.push("the folder walk stopped at its page ceiling — the totals cover a prefix of the mailbox");
  }
  return lines.join("\n");
}

/**
 * Render the inbox grouped by sender.
 *
 * @returns the text block
 */
export function renderOutlookTriageText({ triage }: { triage: OutlookTriage }): string {
  const lines = [`${String(triage.messages)} inbox message(s) from ${String(triage.groups.length)} sender(s)`];
  for (const group of triage.groups) {
    const who = formatOutlookAddress({ address: { address: group.address, name: group.name } });
    lines.push(`${who}  ${String(group.count)} message(s), ${String(group.unread)} unread`);
    for (const message of group.messages) {
      lines.push(`  ${message.isRead ? " " : "*"} ${subjectOf({ subject: message.subject })}  id: ${message.id}`);
    }
  }
  if (triage.more) {
    lines.push("the inbox holds more — raise --limit to group further back");
  }
  return lines.join("\n");
}

/**
 * Render a saved attachment: where it is, first, for the reader to open.
 *
 * @returns the text block
 */
export function renderOutlookAttachmentText({ saved }: { saved: OutlookSavedAttachment }): string {
  let type = "(unstated)";
  if (saved.contentType !== null) {
    type = saved.contentType;
  }
  return [`READ THIS: ${saved.path}`, `name: ${saved.name}`, `type: ${type}`, `bytes: ${String(saved.sizeBytes)}`].join(
    "\n",
  );
}
