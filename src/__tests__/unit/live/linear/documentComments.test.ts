/** Finding one comment among a document's comments: paged to the end, and a broken page is never absence. */
import { describe, expect, it } from "vitest";

import { ok, unwrap, unwrapErr } from "../../../../lib/result.js";
import { findLinearDocumentComment } from "../../../../live/linear/documentComments.js";
import type { LinearReadRequest } from "../../../../live/linear/read.js";

const DOCUMENT_ID = "c4822fd3-4370-4a66-8864-5eea4376fe88";

/**
 * A node as Linear sends it: a node stating `parentId` also carries the matching `parent` relation, unless the
 * fixture sets one itself or states no parent at all.
 */
function asSent(node: Record<string, unknown>): Record<string, unknown> {
  if ("parent" in node || !("parentId" in node)) {
    return node;
  }
  const parentId = node["parentId"];
  if (parentId === null) {
    return { ...node, parent: null };
  }
  return { ...node, parent: { id: parentId } };
}

/** One response page, shaped as the SDK's `document_comments` query answers it. */
function page({
  nodes,
  hasNextPage,
  endCursor,
}: {
  nodes: readonly Record<string, unknown>[];
  hasNextPage: boolean;
  endCursor?: string;
}): unknown {
  return {
    document: { comments: { nodes: nodes.map(asSent), pageInfo: { endCursor, hasNextPage, hasPreviousPage: false } } },
  };
}

/** A transport answering each call with the next scripted page, recording the variables it was sent. */
function scripted({ pages }: { pages: readonly unknown[] }): {
  request: LinearReadRequest;
  sent: Readonly<Record<string, unknown>>[];
} {
  const sent: Readonly<Record<string, unknown>>[] = [];
  const request: LinearReadRequest = ({ variables }) => {
    const next = pages[sent.length];
    sent.push(variables);
    return Promise.resolve(ok(next));
  };
  return { request, sent };
}

describe("findLinearDocumentComment", () => {
  it("finds a thread root, reporting it carries no parent, only after reading every page", async () => {
    const { request, sent } = scripted({
      pages: [
        page({ hasNextPage: true, endCursor: "c1", nodes: [{ body: "How long?", id: "root", parentId: null }] }),
        page({ hasNextPage: false, nodes: [{ body: "a reply", id: "other", parentId: "root" }] }),
      ],
    });

    const found = unwrap(await findLinearDocumentComment({ commentId: "root", documentId: DOCUMENT_ID, request }));

    expect(found).toEqual({ body: "How long?", id: "root", parentId: undefined });
    expect(sent).toEqual([
      { first: 50, id: DOCUMENT_ID, includeArchived: true },
      { after: "c1", first: 50, id: DOCUMENT_ID, includeArchived: true },
    ]);
  });

  it("refuses a read listing the comment twice, on one page or across two, rather than picking one", async () => {
    const onePage = scripted({
      pages: [
        page({
          hasNextPage: false,
          nodes: [
            { id: "P", parentId: null },
            { id: "P", parentId: "R" },
          ],
        }),
      ],
    });
    const twoPages = scripted({
      pages: [
        page({ endCursor: "c1", hasNextPage: true, nodes: [{ id: "P", parentId: null }] }),
        page({ hasNextPage: false, nodes: [{ id: "P", parentId: "R" }] }),
      ],
    });

    const fromOne = unwrapErr(
      await findLinearDocumentComment({ commentId: "P", documentId: DOCUMENT_ID, request: onePage.request }),
    );
    const fromTwo = unwrapErr(
      await findLinearDocumentComment({ commentId: "P", documentId: DOCUMENT_ID, request: twoPages.request }),
    );

    expect(fromOne.message).toBe(
      `Linear listed comment P twice on document ${DOCUMENT_ID}, so which thread it is in cannot be read`,
    );
    expect(fromTwo.code).toBe("READ_FAILED");
  });

  it("refuses a read listing ANOTHER comment twice, even with the one searched for unique", async () => {
    const { request } = scripted({
      pages: [
        page({
          hasNextPage: false,
          nodes: [
            { id: "P", parentId: null },
            { id: "X", parentId: null },
            { id: "X", parentId: "R" },
          ],
        }),
      ],
    });

    const refused = unwrapErr(await findLinearDocumentComment({ commentId: "P", documentId: DOCUMENT_ID, request }));

    expect(refused.message).toBe(
      `Linear listed comment X twice on document ${DOCUMENT_ID}, so which thread it is in cannot be read`,
    );
  });

  it("refuses a first page that does not say nothing comes before it, rather than reading absence", async () => {
    const midway = scripted({
      pages: [{ document: { comments: { nodes: [], pageInfo: { hasNextPage: false, hasPreviousPage: true } } } }],
    });
    const unstated = scripted({ pages: [{ document: { comments: { nodes: [], pageInfo: { hasNextPage: false } } } }] });

    const fromMidway = unwrapErr(
      await findLinearDocumentComment({ commentId: "P", documentId: DOCUMENT_ID, request: midway.request }),
    );
    const fromUnstated = unwrapErr(
      await findLinearDocumentComment({ commentId: "P", documentId: DOCUMENT_ID, request: unstated.request }),
    );

    expect(fromMidway.message).toBe(
      `Linear returned a malformed comments page for document ${DOCUMENT_ID}, so absence cannot be read from it`,
    );
    expect(fromUnstated.code).toBe("READ_FAILED");
  });

  it("refuses a later page that does not say whether anything comes before it, even with the comment already found", async () => {
    const { request, sent } = scripted({
      pages: [
        page({ endCursor: "c1", hasNextPage: true, nodes: [{ id: "P", parentId: null }] }),
        { document: { comments: { nodes: [], pageInfo: { hasNextPage: false } } } },
      ],
    });

    const refused = unwrapErr(await findLinearDocumentComment({ commentId: "P", documentId: DOCUMENT_ID, request }));

    expect(refused.message).toBe(
      `Linear returned a malformed comments page for document ${DOCUMENT_ID}, so absence cannot be read from it`,
    );
    expect(sent.length).toBe(2);
  });

  it("refuses a cursor handed back twice, so the read always ends", async () => {
    const { request, sent } = scripted({
      pages: [
        page({ endCursor: "c1", hasNextPage: true, nodes: [{ id: "a", parentId: null }] }),
        page({ endCursor: "c1", hasNextPage: true, nodes: [{ id: "b", parentId: null }] }),
      ],
    });

    const refused = unwrapErr(await findLinearDocumentComment({ commentId: "zzz", documentId: DOCUMENT_ID, request }));

    expect(refused.message).toBe(
      `Linear handed back cursor c1 twice for document ${DOCUMENT_ID}'s comments, so the read would never end`,
    );
    expect(sent.length).toBe(2);
  });

  it("pages past a first page that does not hold it, following the cursor", async () => {
    const { request, sent } = scripted({
      pages: [
        page({ endCursor: "c1", hasNextPage: true, nodes: [{ body: "a", id: "other", parentId: null }] }),
        page({ hasNextPage: false, nodes: [{ body: "b", id: "reply", parentId: "root" }] }),
      ],
    });

    const found = unwrap(await findLinearDocumentComment({ commentId: "reply", documentId: DOCUMENT_ID, request }));

    expect(found).toEqual({ body: "b", id: "reply", parentId: "root" });
    expect(sent[1]).toEqual({ after: "c1", first: 50, id: DOCUMENT_ID, includeArchived: true });
  });

  it("answers undefined only once the last page has been read without it", async () => {
    const { request, sent } = scripted({
      pages: [
        page({ endCursor: "c1", hasNextPage: true, nodes: [{ id: "a", parentId: null }] }),
        page({ hasNextPage: false, nodes: [{ id: "b", parentId: "a" }] }),
      ],
    });

    expect(unwrap(await findLinearDocumentComment({ commentId: "zzz", documentId: DOCUMENT_ID, request }))).toBe(
      undefined,
    );
    expect(sent.length).toBe(2);
  });

  it("refuses a page claiming another page with no cursor to reach it, rather than calling the comment absent", async () => {
    const { request } = scripted({ pages: [page({ hasNextPage: true, nodes: [{ id: "a", parentId: null }] })] });

    const refused = unwrapErr(await findLinearDocumentComment({ commentId: "zzz", documentId: DOCUMENT_ID, request }));
    // Even the comment searched for is not taken off a page whose pagination is broken.
    const again = scripted({ pages: [page({ hasNextPage: true, nodes: [{ id: "a", parentId: null }] })] });
    const evenFound = unwrapErr(
      await findLinearDocumentComment({ commentId: "a", documentId: DOCUMENT_ID, request: again.request }),
    );

    expect(refused.message).toContain("has more comments but gave no cursor");
    expect(evenFound.message).toContain("has more comments but gave no cursor");
  });

  it("refuses a page that does not say whether more follow, or holds a node with no id, rather than reading absence", async () => {
    const silent = scripted({ pages: [{ document: { comments: { nodes: [], pageInfo: { endCursor: "c1" } } } }] });
    const idless = scripted({ pages: [page({ hasNextPage: false, nodes: [{ body: "who am i" }] })] });

    const fromSilent = unwrapErr(
      await findLinearDocumentComment({ commentId: "x", documentId: DOCUMENT_ID, request: silent.request }),
    );
    const fromIdless = unwrapErr(
      await findLinearDocumentComment({ commentId: "x", documentId: DOCUMENT_ID, request: idless.request }),
    );

    expect(fromSilent.message).toBe(
      `Linear returned a malformed comments page for document ${DOCUMENT_ID}, so absence cannot be read from it`,
    );
    expect(fromIdless.code).toBe("READ_FAILED");
  });

  it("refuses a node that does not state its parent, rather than reading it as a thread root", async () => {
    const unstated = scripted({ pages: [page({ hasNextPage: false, nodes: [{ body: "existing reply", id: "C" }] })] });
    const blank = scripted({ pages: [page({ hasNextPage: false, nodes: [{ id: "C", parentId: "" }] })] });
    const emptyId = scripted({ pages: [page({ hasNextPage: false, nodes: [{ id: "", parentId: null }] })] });
    const fromEmptyId = unwrapErr(
      await findLinearDocumentComment({ commentId: "C", documentId: DOCUMENT_ID, request: emptyId.request }),
    );

    const fromUnstated = unwrapErr(
      await findLinearDocumentComment({ commentId: "C", documentId: DOCUMENT_ID, request: unstated.request }),
    );
    const fromBlank = unwrapErr(
      await findLinearDocumentComment({ commentId: "C", documentId: DOCUMENT_ID, request: blank.request }),
    );

    expect(fromUnstated.code).toBe("READ_FAILED");
    expect(fromBlank.code).toBe("READ_FAILED");
    expect(fromEmptyId.code).toBe("READ_FAILED");
  });

  it("refuses a node whose parent relation contradicts its parentId, rather than reading it as a root", async () => {
    const readWith = async (node: Record<string, unknown>): ReturnType<typeof findLinearDocumentComment> =>
      findLinearDocumentComment({
        commentId: "C",
        documentId: DOCUMENT_ID,
        request: scripted({ pages: [page({ hasNextPage: false, nodes: [node] })] }).request,
      });

    const rootWithParent = unwrapErr(await readWith({ id: "C", parent: { id: "R" }, parentId: null }));
    const replyWithoutParent = unwrapErr(await readWith({ id: "C", parent: null, parentId: "R" }));
    const mismatched = unwrapErr(await readWith({ id: "C", parent: { id: "S" }, parentId: "R" }));
    const relationMissing = unwrapErr(await readWith({ id: "C", parent: undefined, parentId: null }));
    const agreeing = unwrap(await readWith({ id: "C", parent: { id: "R" }, parentId: "R" }));

    expect(rootWithParent.message).toBe(
      `Linear returned a malformed comments page for document ${DOCUMENT_ID}, so absence cannot be read from it`,
    );
    expect(replyWithoutParent.code).toBe("READ_FAILED");
    expect(mismatched.code).toBe("READ_FAILED");
    expect(relationMissing.code).toBe("READ_FAILED");
    expect(agreeing).toEqual({ body: undefined, id: "C", parentId: "R" });
  });

  it("names a missing document as NOT_FOUND and a missing connection as a read failure", async () => {
    const gone = scripted({ pages: [{ document: null }] });
    const broken = scripted({ pages: [{ document: { comments: null } }] });

    const missing = unwrapErr(
      await findLinearDocumentComment({ commentId: "x", documentId: DOCUMENT_ID, request: gone.request }),
    );
    const failed = unwrapErr(
      await findLinearDocumentComment({ commentId: "x", documentId: DOCUMENT_ID, request: broken.request }),
    );

    expect(missing.code).toBe("NOT_FOUND");
    expect(failed.message).toBe(`Linear returned no comments connection for document ${DOCUMENT_ID}`);
  });
});
