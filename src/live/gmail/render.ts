/**
 * Human rendering for every Gmail document — the three reads (`list`, `read`, `labels`), a saved attachment,
 * and the two faces of a mutation (the unsent plan a `--dry-run` prints, and the applied outcome).
 *
 * The shared `renderProviderReadText` prints a header and then the raw provider payload as JSON, which is
 * the right call for a GitHub pull request an agent is about to reason over. It is the wrong call for a
 * mailbox: "list all of my emails" is a triage question, and a screen of JSON is not a triage answer. So
 * the `--json` lane keeps the shared, stable document renderer and the human lane gets these — the same
 * document, read out loud.
 *
 * All of them keep freshness and residue ABOVE the payload, for the same reason the shared renderer does: a
 * reader who scrolls past the residue has still seen it. A mutation has no document to head it — nothing was
 * READ — so its render leads with what changed and puts residue directly under that.
 *
 * Pure: no I/O, no clock.
 */
import type { ProviderReadDocument } from "../providerRead.js";
import type { GmailAttachmentResult } from "./attachment.js";
import type { GmailMeasureResult } from "./measure.js";
import type { GmailModifyOutcome, GmailModifyPlan } from "./modify.js";
import type {
  GmailLabelsResult,
  GmailListingResult,
  GmailMessageResult,
  GmailReadMessage,
  GmailReadUnsubscribe,
} from "./read.js";

/** How much of a snippet a listing line shows before it is cut. */
const SNIPPET_WIDTH = 96;

/** The header block every Gmail render leads with — what was read, when, and what it did not cover. */
function documentHeader({ document }: { document: ProviderReadDocument }): readonly string[] {
  const residue = document.coverage.residue;
  return [
    `gmail ${document.target.kind}: ${document.target.identity}`,
    `read at: ${document.readAtIso}`,
    `coverage: ${document.coverage.kind} — ${document.coverage.detail}`,
    ...(residue.length === 0 ? ["residue: none"] : ["residue:", ...residue.map((line) => `  - ${line}`)]),
    "",
  ];
}

/**
 * Cut a single-line preview to width, marking the cut rather than hiding it.
 *
 * `text` is optional because the parsed shape is honest about an absent header — see
 * {@link ../gmail/parse.ParsedGmailMessage}. The stand-in for a missing value is chosen HERE, at the point
 * of display, and it is a visible one (`(none)`, `(no subject)`) rather than a blank a reader would read as
 * "the sender left it empty".
 */
function preview({ text, width, missing }: { text: string | undefined; width: number; missing: string }): string {
  if (text === undefined || text.trim().length === 0) {
    return missing;
  }
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= width ? flat : `${flat.slice(0, width - 1)}…`;
}

/** The date column: the first 16 characters of the instant, or a visible stand-in when there is none. */
function dateColumn({ sentAtIso }: { sentAtIso: string | undefined }): string {
  return sentAtIso === undefined ? "(no date)      " : sentAtIso.slice(0, 16).replace("T", " ");
}

/**
 * Render a `gmail list` document for a human.
 *
 * The parameter type is spelled INLINE rather than as the imported `GmailListingResult` alias, because the
 * `jsdoc-tags` gate validates a tag against the fields of the declared type and cannot enumerate a type it
 * has to follow into another module — a required field could then hide behind a name the scanner cannot
 * read. It is structurally the same type the reader returns.
 *
 * @param document the listing document, for its freshness and residue header
 * @param listing the same read's typed payload
 * @returns the text block, newest-first as Gmail returned it
 */
export function renderGmailListingText({
  document,
  listing,
}: {
  document: ProviderReadDocument;
  listing: GmailListingResult["listing"];
}): string {
  if (listing.entries.length === 0) {
    return [...documentHeader({ document }), "no messages matched."].join("\n");
  }
  const rows = listing.entries.map((entry) => {
    const marks = [entry.unread ? "●" : "○", entry.hasAttachments ? "@" : " "].join("");
    return [
      `${marks} ${dateColumn({ sentAtIso: entry.sentAtIso })}  ${preview({ missing: "(no sender)", text: entry.from, width: 40 })}`,
      `   ${preview({ missing: "(no subject)", text: entry.subject, width: SNIPPET_WIDTH })}`,
      `   ${preview({ missing: "(no preview)", text: entry.snippet, width: SNIPPET_WIDTH })}`,
      `   id ${entry.id}  thread ${entry.threadId}  labels ${entry.labelIds.join(",")}`,
    ].join("\n");
  });
  return [...documentHeader({ document }), ...rows].join("\n\n");
}

/** The one line saying what way out a message's own headers offer, and the header itself when there is one. */
function unsubscribeLine({ unsubscribe }: { unsubscribe: GmailReadUnsubscribe }): string {
  if (unsubscribe.listUnsubscribe === undefined) {
    return "unsubscribe: none offered (no List-Unsubscribe header)";
  }
  const post = unsubscribe.listUnsubscribePost === undefined ? "" : ` · post ${unsubscribe.listUnsubscribePost}`;
  return `unsubscribe: ${unsubscribe.kind} · ${unsubscribe.listUnsubscribe}${post}`;
}

/** The `from:` value. A message whose headers carry no `From:` has no sender, and the line says so. */
function senderShown({ message }: { message: GmailReadMessage }): string {
  const { from } = message;
  if (from === undefined) {
    return "(no sender)";
  }
  return from;
}

/** The `date:` value. Gmail's `internalDate` was absent or unreadable, so the message has no instant to show. */
function sentAtShown({ message }: { message: GmailReadMessage }): string {
  const { sentAtIso } = message;
  if (sentAtIso === undefined) {
    return "(no date)";
  }
  return sentAtIso;
}

/** The `subject:` value. A message with no `Subject:` header has none, which is not an empty one. */
function subjectShown({ message }: { message: GmailReadMessage }): string {
  const { subject } = message;
  if (subject === undefined) {
    return "(no subject)";
  }
  return subject;
}

/** Render one message: its envelope, its attachment metadata, then its body. */
function renderMessage({ message }: { message: GmailReadMessage }): string {
  const attachments = message.attachments.map(
    (attachment) =>
      `attachment: ${attachment.filename} (${attachment.mimeType}, ${String(attachment.sizeBytes)} bytes, not downloaded)`,
  );
  return [
    `from:    ${senderShown({ message })}`,
    `to:      ${message.to.length > 0 ? message.to.join(", ") : "(no recipients)"}`,
    ...(message.cc.length > 0 ? [`cc:      ${message.cc.join(", ")}`] : []),
    `date:    ${sentAtShown({ message })}`,
    `subject: ${subjectShown({ message })}`,
    `id:      ${message.id}  labels ${message.labelIds.join(",")}  body from ${message.bodyFormat}`,
    unsubscribeLine({ unsubscribe: message.unsubscribe }),
    ...attachments,
    "",
    message.body.length > 0 ? message.body : "(no readable text body)",
  ].join("\n");
}

/**
 * Render a `gmail read` document for a human. The parameter type is spelled inline for the same reason
 * {@link renderGmailListingText}'s is.
 *
 * @param document the read document, for its freshness and residue header
 * @param payload the same read's typed payload
 * @returns the text block, one message per section in thread order
 */
export function renderGmailMessageText({
  document,
  payload,
}: {
  document: ProviderReadDocument;
  payload: GmailMessageResult["payload"];
}): string {
  if (payload.messages.length === 0) {
    return [...documentHeader({ document }), "no message was returned for that id."].join("\n");
  }
  const separator = `\n\n${"─".repeat(72)}\n\n`;
  return [
    documentHeader({ document }).join("\n"),
    payload.messages.map((message) => renderMessage({ message })).join(separator),
  ].join("\n");
}

/** A label id shown with its display name, so a report never asks a reader to recognise `Label_7`. */
function labelWithName({ id, names }: { id: string; names: Readonly<Record<string, string>> }): string {
  const name = names[id];
  return name === undefined || name === id ? id : `${name} (${id})`;
}

/** The `+ADDED  -REMOVED` line both the dry-run and the applied render lead with. */
function changeLine({ plan }: { plan: GmailModifyPlan }): string {
  const added = plan.plan.addLabelIds.map((id) => `+${labelWithName({ id, names: plan.labelNames })}`);
  const removed = plan.plan.removeLabelIds.map((id) => `-${labelWithName({ id, names: plan.labelNames })}`);
  return [...added, ...removed].join("  ");
}

/**
 * Render what a mutation WOULD do, for `--dry-run`. Nothing has been sent when this is printed, and the
 * text says so in its first line rather than leaving a reader to infer it from the absence of a result.
 *
 * @param plan the decided, unsent plan
 * @returns the text block
 */
export function renderGmailPlanText({ plan }: { plan: GmailModifyPlan }): string {
  const head = `would ${plan.intent}: ${plan.scope} ${plan.address}  (${plan.account})`;
  if (plan.plan.noop) {
    return [head, "NOTHING WOULD CHANGE — the mailbox is already in this state.", ""].join("\n");
  }
  return [
    head,
    `changes: ${changeLine({ plan })}`,
    `applies to: ${String(plan.before.length)} message(s)`,
    "",
    "DRY RUN — nothing was sent.",
    "",
  ].join("\n");
}

/**
 * Render an applied mutation: what changed, the state read back, and the residue.
 *
 * Residue sits ABOVE the per-message state for the same reason it does on every read here — a reader who
 * scrolls past it has still seen it.
 *
 * @param outcome the sent mutation and what the mailbox reported
 * @returns the text block
 */
export function renderGmailOutcomeText({ outcome }: { outcome: GmailModifyOutcome }): string {
  const { plan } = outcome;
  const head = plan.plan.noop
    ? `${plan.intent}: already done — ${plan.scope} ${plan.address} (${plan.account})`
    : `${plan.intent}: ${plan.scope} ${plan.address} (${plan.account})  ${changeLine({ plan })}`;
  const state = outcome.after.map((message) => `  ${message.id}  labels ${message.labelIds.join(",")}`);
  return [
    head,
    "residue:",
    ...outcome.residue.map((line) => `  - ${line}`),
    "",
    ...(state.length === 0 ? ["(no message state was returned)"] : ["labels now:", ...state]),
    "",
  ].join("\n");
}

/**
 * Render the mailbox's label vocabulary, system labels first and then the ones a person made.
 *
 * @param document the labels document, for its freshness and residue header
 * @param vocabulary the same read's typed payload
 * @returns the text block
 */
export function renderGmailLabelsText({
  document,
  vocabulary,
}: {
  document: ProviderReadDocument;
  vocabulary: GmailLabelsResult["vocabulary"];
}): string {
  const rows = vocabulary.labels
    .toSorted((left, right) => left.type.localeCompare(right.type) || left.name.localeCompare(right.name))
    .map((label) => `  ${label.type === "system" ? "sys " : "user"}  ${label.name}  →  ${label.id}`);
  return [...documentHeader({ document }), ...(rows.length === 0 ? ["no labels."] : rows)].join("\n");
}

/** The `query:` value. A measurement given no query walked the whole mailbox, and the line says so. */
function measuredQueryShown({ measurement }: { measurement: GmailMeasureResult["measurement"] }): string {
  const { query } = measurement;
  if (query === undefined) {
    return "(the whole mailbox)";
  }
  return query;
}

/** The `oldest:` value — absent when no message was listed or the oldest one's date could not be read. */
function oldestShown({ measurement }: { measurement: GmailMeasureResult["measurement"] }): string {
  const { oldestSentAtIso } = measurement;
  if (oldestSentAtIso === undefined) {
    return "(none — no message could be dated)";
  }
  return oldestSentAtIso;
}

/** The `newest:` value — absent when no message was listed or the newest one's date could not be read. */
function newestShown({ measurement }: { measurement: GmailMeasureResult["measurement"] }): string {
  const { newestSentAtIso } = measurement;
  if (newestSentAtIso === undefined) {
    return "(none — no message could be dated)";
  }
  return newestSentAtIso;
}

/**
 * Render a `gmail measure` document for a human — the three numbers a full backfill is decided on.
 *
 * Every figure is labelled with what it is: the count says it is a count of listable messages, the byte
 * total says ESTIMATE and carries its sample size beside it, and Gmail's own `messagesTotal` is printed as
 * a second, different number rather than reconciled with the first. The parameter type is spelled inline
 * for the same reason {@link renderGmailListingText}'s is.
 *
 * @param document the measurement document, for its freshness and residue header
 * @param measurement the same read's typed payload
 * @returns the text block
 */
export function renderGmailMeasureText({
  document,
  measurement,
}: {
  document: ProviderReadDocument;
  measurement: GmailMeasureResult["measurement"];
}): string {
  const mean = measurement.meanMessageBytes;
  const bytes = measurement.estimatedBytes;
  return [
    ...documentHeader({ document }),
    `mailbox:        ${measurement.account}`,
    `query:          ${measuredQueryShown({ measurement })}`,
    `messages:       ${String(measurement.messagesCounted)} listable${measurement.complete ? "" : " (FLOOR — the walk hit its page ceiling)"}`,
    `gmail's total:  ${measurement.messagesTotalReported === undefined ? "(not reported)" : `${String(measurement.messagesTotalReported)} (includes Spam and Trash)`}`,
    `oldest:         ${oldestShown({ measurement })}`,
    `newest:         ${newestShown({ measurement })}`,
    `size (ESTIMATE): ${bytes === undefined ? "(not projected)" : humanBytes({ bytes })} — mean ${mean === undefined ? "?" : humanBytes({ bytes: mean })}/message across ${String(measurement.bytesSampled)} sampled`,
    `cost of this measurement: ${String(measurement.listCalls)} listing call(s) + ${String(measurement.bytesSampled)} metadata read(s)`,
  ].join("\n");
}

/**
 * Bytes as a human figure, in the largest unit that keeps the number above one.
 *
 * @param bytes the byte count
 * @returns the figure with its unit
 */
export function humanBytes({ bytes }: { bytes: number }): string {
  const units = ["B", "KB", "MB", "GB", "TB"] as const;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? String(Math.round(value)) : value.toFixed(1)} ${units[unit]!}`;
}

/**
 * Render a saved `gmail attachment` for a human. The last line is the path, prefixed `READ THIS:` exactly as
 * `slack read-thread` prints a retained file, so a session reading the output knows the content is in that
 * file and has not yet been read.
 *
 * @param document the fetch document, for its freshness and residue header
 * @param saved what was written, and where
 * @returns the text block
 */
export function renderGmailAttachmentText({
  document,
  saved,
}: {
  document: ProviderReadDocument;
  saved: GmailAttachmentResult["saved"];
}): string {
  let mimeType = "unknown type";
  if (saved.mimeType !== undefined) {
    mimeType = saved.mimeType;
  }
  return [
    ...documentHeader({ document }),
    `attachment ${JSON.stringify(saved.filename)} (${mimeType}, ${String(saved.sizeBytes)} bytes, ` +
      `part ${saved.partId}) from message ${saved.messageId}`,
    `READ THIS: ${saved.localPath}`,
  ].join("\n");
}
