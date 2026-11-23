/**
 * The PURE core of `linear comment create` — argument parsing, form validation, the dry-run preview, and the
 * deterministic intent id. No I/O, so all of it is unit-testable without a mock.
 *
 * ## The intent id is what makes "one comment per ticket" true
 *
 * A comment is append-shaped, so the failure a retry causes is not a lost edit but a DUPLICATE: the same
 * finding posted twice, notifying a colleague twice about one thing. The id is a UUID v4-shaped digest of
 * the destination issue plus the RENDERED body, so the same comment on the same ticket computes the same id
 * in any process on any day — the second attempt finds the reservation and is refused. Changing a word
 * changes the id, which is correct: that is a different comment.
 *
 * `CommentCreateInput.id` accepts a caller-chosen UUID, exactly as `IssueCreateInput.id` does, so the id
 * exists before the request and a lost response can be settled by asking Linear whether that id exists
 * rather than by guessing from content.
 */
import { createHash } from "node:crypto";

import type { DoorRequest } from "../../../admit/types.js";
import type { ReadComment, WrittenObject } from "../../../corpus/linear/write.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { LinearDocumentComment } from "../../../live/linear/documentComments.js";
import { linearCommentFormSchema } from "../../../outbound/linear/commentSchema.js";
import {
  commentDestination,
  type LinearCommentDestination,
  type LinearCommentForm,
} from "../../../outbound/linear/commentTypes.js";
import { renderCommentBody, renderDocumentCommentBody } from "../../../outbound/linear/render.js";
import { booleanFlagsOf, type FlagSpec, stringFlagsOf } from "../../parseFlags.js";
import { readerHolds } from "./documentReader.js";
import { type LinearVerbError, LinearVerbErrors } from "./errors.js";
import { parseLinearFormCreateArgs } from "./formCreateArgs.js";
import { parseLinearForm } from "./formParse.js";

/** A parsed `linear comment create` invocation. */
export interface LinearCommentArgs {
  readonly formSource: string;
  readonly dryRun: boolean;
  readonly json: boolean;
  readonly home: string | undefined;
  /** The `--mention-id key=<linear-user-id>` pairs the caller verified live — see `./formCreateArgs.ts`. */
  readonly mentionIds: ReadonlyMap<string, string>;
}

/** The flags this verb accepts, as a {@link FlagSpec}; `helpTruth.test.ts` reads the names derived below. */
const LINEAR_COMMENT_FLAGS: FlagSpec = {
  boolean: ["dry-run", "json"],
  string: ["form", "home", "mention-id"],
};

/** Every accepted flag, WITH the `--`, for the help-truth ratchet. */
export const LINEAR_COMMENT_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: LINEAR_COMMENT_FLAGS }),
  ...booleanFlagsOf({ spec: LINEAR_COMMENT_FLAGS }),
].map((name) => `--${name}`);

/**
 * Parse `linear comment create …`.
 *
 * @param argv the verb's arguments, excluding the noun
 * @returns the parsed arguments, or the operator-facing errors
 */
export function parseLinearCommentArgs({
  argv,
}: {
  argv: readonly string[];
}): Result<LinearCommentArgs, LinearVerbError> {
  return parseLinearFormCreateArgs({ argv, flags: LINEAR_COMMENT_FLAGS, noun: "comment" });
}

/**
 * Validate a filled form.
 *
 * @param raw the JSON text of the form
 * @returns the typed form, or one line per rejection naming its path
 */
export function parseLinearCommentForm({ raw }: { raw: string }): Result<LinearCommentForm, LinearVerbError> {
  return parseLinearForm({ raw, schema: linearCommentFormSchema });
}

/**
 * The deterministic comment id for an intent, in UUID v4 layout — same construction as `intentId`, over the
 * destination issue plus the rendered body.
 *
 * @param form the complete write
 * @returns the UUID this intent always maps to
 */
export function commentIntentId({ form }: { form: LinearCommentForm }): string {
  const material = JSON.stringify({ body: commentBodyFor({ form }), fields: form.fields });
  const hex = createHash("sha256").update(material, "utf8").digest("hex").slice(0, 32);
  const variant = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  const uuid = `${hex.slice(0, 12)}4${hex.slice(13, 16)}${variant}${hex.slice(17, 32)}`;
  return [uuid.slice(0, 8), uuid.slice(8, 12), uuid.slice(12, 16), uuid.slice(16, 20), uuid.slice(20, 32)].join("-");
}

/**
 * The exact markdown a comment sends: the issue arrangement on an issue, the empty-fold arrangement on a
 * document. The one place the destination picks the renderer, so the preview, the id and the send agree.
 *
 * @param form the validated form
 * @returns the comment markdown
 */
function commentBodyFor({ form }: { form: LinearCommentForm }): string {
  return commentDestination({ fields: form.fields }).kind === "document"
    ? renderDocumentCommentBody({ artifact: form.artifact })
    : renderCommentBody({ artifact: form.artifact });
}

/**
 * A destination with everything the create needs — for a document, the content id it attaches to and, for a
 * reply, the thread root it was checked against.
 */
export type ResolvedCommentTarget =
  | { readonly kind: "issue"; readonly id: string }
  | {
      readonly kind: "document";
      readonly id: string;
      readonly documentContentId: string;
      readonly quotedText: string | undefined;
      readonly parentId: string | undefined;
      /** The parent's first line, so a preview shows which thread the reply joins. */
      readonly parentExcerpt: string | undefined;
    };

/** How much of a parent comment's first line the preview shows. */
const PARENT_EXCERPT_MAX = 80;

/**
 * The first non-empty line of a parent comment, bounded, for the preview.
 *
 * @param body the parent's markdown body, when Linear returned one
 * @returns the excerpt, or `undefined` for a comment with no readable body
 */
function parentExcerptOf({ body }: { body: string | undefined }): string | undefined {
  if (body === undefined) {
    return undefined;
  }
  const line = body
    .split("\n")
    .map((text) => text.trim())
    .find((text) => text.length > 0);
  if (line === undefined) {
    return undefined;
  }
  return line.length > PARENT_EXCERPT_MAX ? `${line.slice(0, PARENT_EXCERPT_MAX)}…` : line;
}

/**
 * Whether a quoted passage is in a document's current content, as a reader would see it — the rendered text of
 * ONE line of one block (`./documentReader.ts`), since an inline comment anchors to a selection within one block.
 * The RFC this was built for stores `to** \`node\` **directly` where a reader sees "to node directly", and that is
 * what matches. The comparison is exact, whitespace included, and the quote is SENT exactly as given, so what
 * Linear anchors to is what was found; a quote carrying `**` quotes markup no reader sees, and is refused rather
 * than silently repaired into a different passage.
 *
 * @param quote the passage the comment anchors to
 * @param content the document's stored markdown
 * @returns true when one readable run of the content holds the passage whole
 */
export function quoteAnchors({ quote, content }: { quote: string; content: string }): boolean {
  return readerHolds({ content, quote });
}

/**
 * Resolve a document destination against the document's node as read now: the content id the comment
 * attaches to, when the comment quotes a passage proof the passage is there, and when it REPLIES proof its
 * parent is a thread root on this document.
 *
 * @param destination the document destination from the form
 * @param node the provider's document node, read just before the write
 * @param parent for a reply, the parent as found among the document's comments — `undefined` when every page
 *   was read without it, which is the refusal; ignored when the destination names no `parentId`
 * @returns the resolved target, or the refusal naming what did not resolve
 */
export function resolveDocumentTarget({
  destination,
  node,
  parent,
}: {
  destination: Extract<LinearCommentDestination, { kind: "document" }>;
  node: Readonly<Record<string, unknown>>;
  parent?: LinearDocumentComment | undefined;
}): Result<ResolvedCommentTarget, LinearVerbError> {
  const canonicalId = node["id"];
  if (typeof canonicalId !== "string" || canonicalId.length === 0) {
    return err(LinearVerbErrors.documentUnreadable({ documentId: destination.id, reason: "it carries no id" }));
  }
  const documentContentId = node["documentContentId"];
  if (typeof documentContentId !== "string" || documentContentId.length === 0) {
    return err(
      LinearVerbErrors.documentUnreadable({ documentId: destination.id, reason: "it carries no documentContentId" }),
    );
  }
  const topLevel = {
    documentContentId,
    id: canonicalId,
    kind: "document",
    parentExcerpt: undefined,
    parentId: undefined,
    quotedText: undefined,
  } as const;
  if (destination.parentId !== undefined) {
    return replyTarget({ documentId: destination.id, parent, parentId: destination.parentId, topLevel });
  }
  if (destination.quotedText === undefined) {
    return ok(topLevel);
  }
  const content = node["content"];
  if (typeof content !== "string") {
    return err(LinearVerbErrors.documentUnreadable({ documentId: destination.id, reason: "it returned no content" }));
  }
  if (!quoteAnchors({ content, quote: destination.quotedText })) {
    return err(LinearVerbErrors.quoteNotFound({ documentId: destination.id, quotedText: destination.quotedText }));
  }
  // The quote SENT is the one checked, byte for byte, so what Linear anchors to is exactly what was found.
  return ok({ ...topLevel, quotedText: destination.quotedText });
}

/**
 * A reply's target: the top-level target joined to the thread its parent roots, or the refusal saying why the
 * parent roots no thread on this document.
 *
 * @param documentId the document as the form named it, for the refusal
 * @param parent the parent as found among the document's comments, `undefined` when it was not
 * @param parentId the parent the form named
 * @param topLevel the document's resolved top-level target
 * @returns the reply target, or `PARENT_NOT_FOUND` / `PARENT_IS_REPLY`
 */
function replyTarget({
  documentId,
  parent,
  parentId,
  topLevel,
}: {
  documentId: string;
  parent: LinearDocumentComment | undefined;
  parentId: string;
  topLevel: Extract<ResolvedCommentTarget, { kind: "document" }>;
}): Result<ResolvedCommentTarget, LinearVerbError> {
  if (parent?.id !== parentId) {
    return err(LinearVerbErrors.parentNotFound({ documentId, parentId }));
  }
  if (parent.parentId !== undefined) {
    return err(LinearVerbErrors.parentIsReply({ parentId: parent.id, rootId: parent.parentId }));
  }
  // The schema refuses a reply carrying a quote, so a reply resolves here with none.
  return ok({ ...topLevel, parentExcerpt: parentExcerptOf({ body: parent.body }), parentId: parent.id });
}

/**
 * The comment id for a RESOLVED write. An issue keeps {@link commentIntentId}. A document is keyed on its
 * canonical id, the quote exactly as sent and the thread it replies in, so the same comment named once by slug
 * and once by uuid maps to one id and posts once, while the same words in two threads are two comments.
 *
 * @param form the validated form
 * @param target where it lands, as resolved against the provider
 * @returns the UUID this write always maps to
 */
export function resolvedCommentIntentId({
  form,
  target,
}: {
  form: LinearCommentForm;
  target: ResolvedCommentTarget;
}): string {
  if (target.kind === "issue") {
    return commentIntentId({ form });
  }
  const quote = target.quotedText === undefined ? {} : { quotedText: target.quotedText };
  const reply = target.parentId === undefined ? {} : { parentId: target.parentId };
  return commentIntentId({ form: { ...form, fields: { documentId: target.id, ...quote, ...reply } } });
}

/**
 * The `CommentCreateInput` fields, built from the validated form and its resolved destination.
 *
 * @param form the validated form
 * @param target where it lands; a document target carries the content id Linear attaches the comment to
 * @returns the provider input
 */
export function commentInputFor({
  form,
  target,
}: {
  form: LinearCommentForm;
  target: ResolvedCommentTarget;
}): Readonly<Record<string, unknown>> {
  const body = commentBodyFor({ form });
  if (target.kind === "issue") {
    return { body, issueId: target.id };
  }
  return {
    body,
    documentContentId: target.documentContentId,
    ...(target.quotedText === undefined ? {} : { quotedText: target.quotedText }),
    ...(target.parentId === undefined ? {} : { parentId: target.parentId }),
  };
}

/**
 * Where on a document a comment sits: a reply in a thread, anchored to a passage, or top-level.
 *
 * @param destination the document destination from the form
 * @returns the preview's one placement line
 */
function documentPlacementLine({
  destination,
}: {
  destination: Extract<LinearCommentDestination, { kind: "document" }>;
}): string {
  if (destination.parentId !== undefined) {
    return `reply to:   ${destination.parentId}`;
  }
  if (destination.quotedText !== undefined) {
    return `quote:      "${destination.quotedText}"`;
  }
  return "quote:      none (a top-level document comment)";
}

/**
 * The dry-run preview: the exact bytes that would be sent, plus the destination.
 *
 * The body shown is the SAME string the writer sends — rendered once, by the same function — because a
 * preview produced by a second code path is a preview of something else.
 *
 * @param form the validated form
 * @param id the deterministic intent id
 * @param anchor for a document comment, what the read of the document said about its anchor
 * @returns the operator-facing lines
 */
export function commentDryRunLines({
  form,
  id,
  mentions = [],
  anchor,
}: {
  form: LinearCommentForm;
  id: string;
  mentions?: readonly string[];
  anchor?: string | undefined;
}): readonly string[] {
  const body = commentBodyFor({ form });
  const destination = commentDestination({ fields: form.fields });
  const where =
    destination.kind === "issue"
      ? [`issue:      ${destination.id}`]
      : [
          `document:   ${destination.id}`,
          documentPlacementLine({ destination }),
          ...(anchor === undefined ? [] : [`anchor:     ${anchor}`]),
        ];
  return [
    `comment id: ${id}  (derived from the intent, so a retry reuses it)`,
    ...where,
    `evidence:   ${String(form.artifact.evidence.length)} link(s)`,
    ...(mentions.length === 0 ? [] : [`notifies:   ${mentions.join(", ")}`]),
    `body bytes: ${String(Buffer.byteLength(body, "utf8"))}`,
    "--- comment ---",
    body,
    "--- end ---",
  ];
}

/**
 * What became of a comment write.
 *
 * The same six arms an issue create has, minus `landedAfterError`'s update ambiguity: every comment id this
 * verb sees is freshly reserved, so finding an object at it proves the create landed.
 */
export type LinearCommentOutcome =
  | { readonly kind: "written"; readonly comment: ReadComment }
  | { readonly kind: "unconfirmed"; readonly comment: WrittenObject }
  | { readonly kind: "landed"; readonly comment: ReadComment; readonly reason: string }
  | { readonly kind: "indeterminate"; readonly reason: string }
  | { readonly kind: "duplicate"; readonly reservedIso: string }
  | { readonly kind: "failed"; readonly reason: string };

/**
 * The operator-facing report for a comment outcome.
 *
 * @param outcome what happened
 * @returns the lines to print
 */
export function commentOutcomeLines({ outcome }: { outcome: LinearCommentOutcome }): readonly string[] {
  switch (outcome.kind) {
    case "written":
      return ["posted the comment", outcome.comment.url];
    case "unconfirmed":
      return [
        "the comment was posted but could NOT be read back, so its state is unverified.",
        `Linear echoes only an id on a write, so there is no URL to print until a read succeeds: ${outcome.comment.id}`,
        "Do not re-run this: the mutation may have landed. Check the issue, then reconcile.",
      ];
    case "landed":
      return [
        "posted the comment, despite a transport error — it was found at the id we chose.",
        outcome.comment.url,
        `the error was: ${outcome.reason}`,
      ];
    case "duplicate":
      return [
        `refused: this exact comment was already reserved at ${outcome.reservedIso}.`,
        "The comment id is derived from the issue and the rendered body, so the same words on the same",
        "ticket map to the same comment and cannot be posted twice.",
        "Change the comment, or delete the ledger record if the earlier attempt definitely did not land.",
      ];
    case "indeterminate":
      return [
        "the mutation errored AND the comment could not be read back, so it is unknown whether it landed.",
        `the error was: ${outcome.reason}`,
        "Do NOT re-run this. Look at the issue in Linear, then reconcile.",
      ];
    case "failed":
      return [`the write failed: ${outcome.reason}`];
  }
}

/**
 * A document comment's audit artifact: the document, the id, and the thread when it is a reply.
 *
 * @param destination the document destination
 * @param id the comment id
 * @returns the door artifact
 */
function documentArtifactOf({
  destination,
  id,
}: {
  destination: Extract<LinearCommentDestination, { kind: "document" }>;
  id: string;
}): Readonly<Record<string, string>> {
  if (destination.parentId === undefined) {
    return { documentId: destination.id, id };
  }
  return { documentId: destination.id, id, parentId: destination.parentId };
}

/**
 * The door request for a comment write.
 *
 * `createsWorkItem` is FALSE, and that is a judgement rather than an oversight: a comment lands on a ticket
 * or document a team already has, so it creates no item anyone has to triage. It still notifies people, which
 * is why it is an `external-write` requiring approval like every other outbound send.
 *
 * @param home the resolved state home
 * @param id the comment id
 * @param destination the issue or document, recorded so the audit trail says where the write landed
 * @returns the request to admit
 */
export function commentDoorRequestFor({
  home,
  id,
  destination,
}: {
  home: string;
  id: string;
  destination: LinearCommentDestination;
}): DoorRequest {
  return {
    action: { kind: "verb", noun: "linear", verb: "comment create" },
    artifact: destination.kind === "issue" ? { id, issueId: destination.id } : documentArtifactOf({ destination, id }),
    meta: {
      createsWorkItem: false,
      effect: "external-write",
      home,
      requiresApproval: false,
    },
  };
}
