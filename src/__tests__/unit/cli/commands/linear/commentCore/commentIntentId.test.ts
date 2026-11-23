/*
 * `commentIntentId` on a document form: the quoted passage is part of what makes two comments two.
 */
import { describe, expect, it } from "vitest";

import { commentIntentId } from "../../../../../../cli/commands/linear/commentCore.js";
import type { LinearCommentForm } from "../../../../../../outbound/linear/commentTypes.js";
import { DOCUMENT_ID, FORM } from "./harness.js";

describe("commentIntentId", () => {
  it("differs when only the quoted passage differs — two anchors are two comments", () => {
    const other: LinearCommentForm = { ...FORM, fields: { documentId: DOCUMENT_ID, quotedText: "Rejected." } };

    expect(commentIntentId({ form: other })).not.toBe(commentIntentId({ form: FORM }));
  });
});
