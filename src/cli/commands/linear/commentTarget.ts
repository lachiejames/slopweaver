/**
 * Where a `linear comment create` lands, resolved against the provider: nothing to read for an issue, and for a
 * document a read NOW of the content id it attaches to and proof its quoted passage is there. The live path and
 * the dry run both come through here, so the preview's verdict is the write's.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import { commentDestination, type LinearCommentForm } from "../../../outbound/linear/commentTypes.js";
import { EXIT_ERROR, EXIT_USAGE } from "../../exitCodes.js";
import { type ResolvedCommentTarget, resolveDocumentTarget, resolvedCommentIntentId } from "./commentCore.js";
import type { LinearCommentWriteDeps } from "./commentDeps.js";
import { type LinearVerbError, LinearVerbErrors } from "./errors.js";

/**
 * Resolve where the comment lands. An issue needs nothing more; a document is read NOW for the content id
 * the comment attaches to and, when it quotes a passage, proof the passage is still there.
 *
 * A reply's parent is looked up among THIS document's comments, keyed on the canonical id the node read
 * returned, so a parent on another document is absent by construction.
 *
 * @param deps the edges reached: the document read, and for a reply the parent lookup
 * @param form the validated form
 * @param token the Linear token the read goes out under
 * @returns the resolved target, or the refusal naming what did not resolve
 */
export async function resolveTarget({
  deps,
  form,
  token,
}: {
  deps: Pick<LinearCommentWriteDeps, "readDocument" | "readDocumentComment">;
  form: LinearCommentForm;
  token: string;
}): Promise<Result<ResolvedCommentTarget, LinearVerbError>> {
  const destination = commentDestination({ fields: form.fields });
  if (destination.kind === "issue") {
    return ok(destination);
  }
  const node = await deps.readDocument({ id: destination.id, token });
  if (node.isErr()) {
    return err(LinearVerbErrors.documentUnreadable({ documentId: destination.id, reason: node.error.message }));
  }
  const canonicalId = node.value["id"];
  if (destination.parentId === undefined || typeof canonicalId !== "string") {
    // With no id the node refuses in `resolveDocumentTarget` before a parent is ever asked about.
    return resolveDocumentTarget({ destination, node: node.value });
  }
  const parent = await deps.readDocumentComment({ commentId: destination.parentId, documentId: canonicalId, token });
  if (parent.isErr()) {
    return err(
      LinearVerbErrors.documentUnreadable({
        documentId: destination.id,
        reason: `its comments could not be read to find parentId ${destination.parentId}: ${parent.error.message}`,
      }),
    );
  }
  return resolveDocumentTarget({ destination, node: node.value, parent: parent.value });
}

/** The refusals the caller fixes by changing the form, rather than failures of fact. */
const CALLER_FIXABLE: ReadonlySet<LinearVerbError["code"]> = new Set([
  "PARENT_IS_REPLY",
  "PARENT_NOT_FOUND",
  "QUOTE_NOT_FOUND",
]);

/**
 * The exit code a target refusal carries: an unanchored quote or a parent that is no thread root is the
 * caller's to fix, an unreadable document is a failure of fact.
 *
 * @param error the refusal from {@link resolveTarget}
 * @returns the process exit code
 */
export function targetRefusalCode({ error }: { error: LinearVerbError }): number {
  return CALLER_FIXABLE.has(error.code) ? EXIT_USAGE : EXIT_ERROR;
}

/**
 * The dry run's reading of a document comment's anchor — the same read and check the live path makes, since a
 * read is no effect — and the id the live write would use. An issue comment has no anchor to check and keeps
 * the id it was given; so does a document the dry run could not resolve.
 *
 * @param deps the two edges reached: the token and the document read
 * @param form the form as previewed, whose destination is read
 * @param id the id computed before resolution, kept when nothing resolves
 * @param intentForm the form as parsed, which the resolved id is computed over
 * @returns the id to print, the `anchor:` line (none for an issue), and whether the anchor refused
 */
export async function dryRunAnchor({
  deps,
  form,
  home,
  id,
  intentForm,
}: {
  deps: Pick<LinearCommentWriteDeps, "readDocument" | "readDocumentComment" | "resolveToken">;
  form: LinearCommentForm;
  home: string;
  id: string;
  intentForm: LinearCommentForm;
}): Promise<{ readonly id: string; readonly line: string | undefined; readonly refused: boolean }> {
  const destination = commentDestination({ fields: form.fields });
  if (destination.kind === "issue") {
    return { id, line: undefined, refused: false };
  }
  const token = deps.resolveToken({ home });
  if (token === undefined) {
    // A reply's whole check is the parent read, so a preview that skipped it has not previewed the reply.
    const isReply = destination.parentId !== undefined;
    return {
      id,
      line: `${isReply ? "REFUSED" : "not checked"} — no Linear token for this home, so the document was not read`,
      refused: isReply,
    };
  }
  const target = await resolveTarget({ deps, form, token });
  if (target.isErr()) {
    return { id, line: `REFUSED — ${target.error.message}`, refused: true };
  }
  const resolved = target.value;
  return {
    id: resolvedCommentIntentId({ form: intentForm, target: resolved }),
    line: resolvedAnchorLine({ target: resolved }),
    refused: false,
  };
}

/**
 * The dry run's `anchor:` line for a resolved target: the content it attaches to, and for a reply the thread
 * root it joins and how that root opens.
 *
 * @param target the resolved destination
 * @returns the anchor line
 */
function resolvedAnchorLine({ target }: { target: ResolvedCommentTarget }): string {
  if (target.kind === "issue") {
    return `resolved — attaches to issue ${target.id}`;
  }
  const attaches = `resolved — attaches to document content ${target.documentContentId}`;
  if (target.parentId === undefined) {
    return attaches;
  }
  const opens = target.parentExcerpt === undefined ? "" : `, which opens "${target.parentExcerpt}"`;
  return `${attaches}, replying in thread ${target.parentId}${opens}`;
}
