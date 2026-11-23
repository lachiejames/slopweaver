/*
 * `resolvedCommentIntentId`: the intent id of a comment whose target is resolved, keyed on the thread and the quote
 * sent rather than how the form named the document, and unchanged for an issue comment.
 */
import { describe, expect, it } from "vitest";

import { commentIntentId, resolvedCommentIntentId } from "../../../../../../cli/commands/linear/commentCore.js";
import type { LinearCommentForm } from "../../../../../../outbound/linear/commentTypes.js";
import { CONTENT_ID, DOCUMENT_ID, FORM } from "./harness.js";

describe("resolvedCommentIntentId", () => {
  const target = {
    documentContentId: CONTENT_ID,
    id: DOCUMENT_ID,
    kind: "document",
    parentExcerpt: undefined,
    parentId: undefined,
    quotedText: "Lean: no, as a follow-up.",
  } as const;

  it("differs between two threads for the same words — two replies are two comments", () => {
    const inOne = { ...target, parentId: "root-1", quotedText: undefined };
    const inTwo = { ...target, parentId: "root-2", quotedText: undefined };

    expect(resolvedCommentIntentId({ form: FORM, target: inOne })).not.toBe(
      resolvedCommentIntentId({ form: FORM, target: inTwo }),
    );
  });

  it("is the same whether the form named the document by slug or by uuid", () => {
    const bySlug: LinearCommentForm = {
      ...FORM,
      fields: { documentId: "cdd0e58a1f3b", quotedText: "Lean: no, as a follow-up." },
    };

    expect(resolvedCommentIntentId({ form: bySlug, target })).toBe(resolvedCommentIntentId({ form: FORM, target }));
  });

  it("differs when the quote sent differs", () => {
    expect(resolvedCommentIntentId({ form: FORM, target: { ...target, quotedText: "Lean: no" } })).not.toBe(
      resolvedCommentIntentId({ form: FORM, target }),
    );
  });

  it("keeps an issue comment's id exactly as commentIntentId computes it", () => {
    const issueForm: LinearCommentForm = {
      artifact: { evidence: [{ label: "run", url: "https://x.test/1" }], summary: "s" },
      fields: { issueId: "INFR-1" },
    };

    expect(resolvedCommentIntentId({ form: issueForm, target: { id: "INFR-1", kind: "issue" } })).toBe(
      commentIntentId({ form: issueForm }),
    );
  });
});
