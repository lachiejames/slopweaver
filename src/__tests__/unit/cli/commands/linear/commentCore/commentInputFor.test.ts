/*
 * `commentInputFor` on a document: the content id, the quote and the parent a comment input carries, and no issue id.
 */
import { describe, expect, it } from "vitest";

import { commentInputFor } from "../../../../../../cli/commands/linear/commentCore.js";
import { CONTENT_ID, DOCUMENT_ID, FORM } from "./harness.js";

describe("commentInputFor", () => {
  it("sends the content id and the quote for a document, and no issue id", () => {
    const input = commentInputFor({
      form: FORM,
      target: {
        documentContentId: CONTENT_ID,
        id: DOCUMENT_ID,
        kind: "document",
        parentExcerpt: undefined,
        parentId: undefined,
        quotedText: "Lean: no, as a follow-up.",
      },
    });

    expect(input).toEqual({
      body: "i'd push to do this first, or at least alongside.",
      documentContentId: CONTENT_ID,
      quotedText: "Lean: no, as a follow-up.",
    });
  });

  it("omits quotedText and parentId for a top-level document comment", () => {
    const input = commentInputFor({
      form: FORM,
      target: {
        documentContentId: CONTENT_ID,
        id: DOCUMENT_ID,
        kind: "document",
        parentExcerpt: undefined,
        parentId: undefined,
        quotedText: undefined,
      },
    });

    expect(input).toEqual({ body: "i'd push to do this first, or at least alongside.", documentContentId: CONTENT_ID });
  });

  it("sends the parent id for a reply, with no quote", () => {
    const input = commentInputFor({
      form: FORM,
      target: {
        documentContentId: CONTENT_ID,
        id: DOCUMENT_ID,
        kind: "document",
        parentExcerpt: "How long?",
        parentId: "root-1",
        quotedText: undefined,
      },
    });

    expect(input).toEqual({
      body: "i'd push to do this first, or at least alongside.",
      documentContentId: CONTENT_ID,
      parentId: "root-1",
    });
  });
});
