/*
 * `resolveDocumentTarget`: the canonical document and content ids a comment attaches to, the excerpt of the thread
 * root a reply lands under, and every refusal of a reply, a quote or a document it cannot place.
 */
import { describe, expect, it } from "vitest";

import { resolveDocumentTarget } from "../../../../../../cli/commands/linear/commentCore.js";
import { unwrap, unwrapErr } from "../../../../../../lib/result.js";
import { CONTENT, CONTENT_ID, DOCUMENT_ID } from "./harness.js";

describe("resolveDocumentTarget", () => {
  const destination = {
    id: DOCUMENT_ID,
    kind: "document",
    parentId: undefined,
    quotedText: "Lean: no, as a follow-up.",
  } as const;
  const ROOT_ID = "3b07ede1-fb31-4e7c-8f5d-9337596d2c5b";
  const reply = { ...destination, parentId: ROOT_ID, quotedText: undefined } as const;
  const node = { content: CONTENT, documentContentId: CONTENT_ID, id: DOCUMENT_ID };

  it("resolves the canonical id and the content id the comment attaches to when the quote is there", () => {
    const target = resolveDocumentTarget({
      destination: { ...destination, id: "cdd0e58a1f3b" },
      node: { content: CONTENT, documentContentId: CONTENT_ID, id: DOCUMENT_ID },
    });

    expect(unwrap(target)).toEqual({
      documentContentId: CONTENT_ID,
      id: DOCUMENT_ID,
      kind: "document",
      parentExcerpt: undefined,
      parentId: undefined,
      quotedText: "Lean: no, as a follow-up.",
    });
  });

  it("resolves a reply to a thread root, carrying the root's first line as its excerpt", () => {
    const parent = { body: "\nHow long do refresh tokens last?\nsecond line", id: ROOT_ID, parentId: undefined };

    expect(unwrap(resolveDocumentTarget({ destination: reply, node, parent }))).toEqual({
      documentContentId: CONTENT_ID,
      id: DOCUMENT_ID,
      kind: "document",
      parentExcerpt: "How long do refresh tokens last?",
      parentId: ROOT_ID,
      quotedText: undefined,
    });
  });

  it("bounds a long first line of the parent at 80 characters plus an ellipsis", () => {
    const parent = { body: "x".repeat(120), id: ROOT_ID, parentId: undefined };

    const target = unwrap(resolveDocumentTarget({ destination: reply, node, parent }));

    expect(target).toMatchObject({ parentExcerpt: `${"x".repeat(80)}…` });
  });

  it("REFUSES a reply whose parent was not found, and one whose found comment is another id", () => {
    const absent = resolveDocumentTarget({ destination: reply, node, parent: undefined });
    const other = resolveDocumentTarget({
      destination: reply,
      node,
      parent: { body: "x", id: "someone-else", parentId: undefined },
    });

    expect(unwrapErr(absent).code).toBe("PARENT_NOT_FOUND");
    expect(unwrapErr(other).code).toBe("PARENT_NOT_FOUND");
  });

  it("REFUSES a reply to a reply, naming its root", () => {
    const parent = { body: "a reply", id: ROOT_ID, parentId: "the-root" };

    const refused = unwrapErr(resolveDocumentTarget({ destination: reply, node, parent }));

    expect(refused.code).toBe("PARENT_IS_REPLY");
    expect(refused.message).toContain("parentId the-root");
  });

  it("REFUSES a quote whose whitespace the content does not carry, rather than collapsing it (fallback review r4)", () => {
    const target = resolveDocumentTarget({
      destination: { ...destination, quotedText: "Lean: no,\tas a   follow-up." },
      node: { content: CONTENT, documentContentId: CONTENT_ID, id: DOCUMENT_ID },
    });

    expect(unwrapErr(target).code).toBe("QUOTE_NOT_FOUND");
  });

  it("sends a quote carrying the content's own double space byte for byte", () => {
    const target = resolveDocumentTarget({
      destination: { ...destination, quotedText: "two  spaces" },
      node: { content: "two  spaces here", documentContentId: CONTENT_ID, id: DOCUMENT_ID },
    });

    expect(unwrap(target)).toEqual({
      documentContentId: CONTENT_ID,
      id: DOCUMENT_ID,
      kind: "document",
      parentExcerpt: undefined,
      parentId: undefined,
      quotedText: "two  spaces",
    });
  });

  it("REFUSES a quote the current content does not hold, naming it", () => {
    const target = resolveDocumentTarget({
      destination: { ...destination, quotedText: "Lean: yes, now." },
      node: { content: CONTENT, documentContentId: CONTENT_ID, id: DOCUMENT_ID },
    });

    expect(unwrapErr(target).code).toBe("QUOTE_NOT_FOUND");
    expect(unwrapErr(target).message).toContain('quotedText "Lean: yes, now." is not in document');
  });

  it("REFUSES a document that carries no content id", () => {
    const target = resolveDocumentTarget({ destination, node: { content: CONTENT, id: DOCUMENT_ID } });

    expect(unwrapErr(target).code).toBe("DOCUMENT_UNREADABLE");
    expect(unwrapErr(target).message).toContain("carries no documentContentId");
  });

  it("REFUSES a document node that carries no id", () => {
    const target = resolveDocumentTarget({ destination, node: { content: CONTENT, documentContentId: CONTENT_ID } });

    expect(unwrapErr(target).code).toBe("DOCUMENT_UNREADABLE");
    expect(unwrapErr(target).message).toContain("carries no id");
  });

  it("does not need the content for a top-level comment with no quote", () => {
    const target = resolveDocumentTarget({
      destination: { ...destination, quotedText: undefined },
      node: { documentContentId: CONTENT_ID, id: DOCUMENT_ID },
    });

    expect(unwrap(target)).toEqual({
      documentContentId: CONTENT_ID,
      id: DOCUMENT_ID,
      kind: "document",
      parentExcerpt: undefined,
      parentId: undefined,
      quotedText: undefined,
    });
  });
});
