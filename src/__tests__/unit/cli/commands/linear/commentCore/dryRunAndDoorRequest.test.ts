/*
 * `commentDryRunLines` and `commentDoorRequestFor` for a document destination: the dry run names the document, the
 * quote or thread and the anchor verdict, and the door request records the document and the thread.
 */
import { describe, expect, it } from "vitest";

import { commentDoorRequestFor, commentDryRunLines } from "../../../../../../cli/commands/linear/commentCore.js";
import type { LinearCommentForm } from "../../../../../../outbound/linear/commentTypes.js";
import { DOCUMENT_ID, FORM } from "./harness.js";

describe("commentDryRunLines / commentDoorRequestFor — a document destination", () => {
  it("names the document, the quote and the anchor verdict", () => {
    const lines = commentDryRunLines({ anchor: "resolved", form: FORM, id: "id-1" });

    expect(lines.slice(1, 5)).toEqual([
      `document:   ${DOCUMENT_ID}`,
      'quote:      "Lean: no, as a follow-up."',
      "anchor:     resolved",
      "evidence:   0 link(s)",
    ]);
  });

  it("names the thread in place of a quote for a reply", () => {
    const replyForm: LinearCommentForm = { ...FORM, fields: { documentId: DOCUMENT_ID, parentId: "root-1" } };

    const lines = commentDryRunLines({ form: replyForm, id: "id-1" });

    expect(lines.slice(1, 3)).toEqual([`document:   ${DOCUMENT_ID}`, "reply to:   root-1"]);
  });

  it("records the document, not an issue, on the door request", () => {
    const request = commentDoorRequestFor({
      destination: { id: DOCUMENT_ID, kind: "document", parentId: undefined, quotedText: undefined },
      home: "/h",
      id: "id-1",
    });

    expect(request.artifact).toEqual({ documentId: DOCUMENT_ID, id: "id-1" });
  });

  it("records the thread a reply lands in on the door request", () => {
    const request = commentDoorRequestFor({
      destination: { id: DOCUMENT_ID, kind: "document", parentId: "root-1", quotedText: undefined },
      home: "/h",
      id: "id-1",
    });

    expect(request.artifact).toEqual({ documentId: DOCUMENT_ID, id: "id-1", parentId: "root-1" });
  });
});
