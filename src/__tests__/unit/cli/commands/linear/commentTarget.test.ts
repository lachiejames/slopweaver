/** Where a comment lands, resolved: the document read, the refusal's exit code, and the dry run's verdict. */
import { err, ok } from "neverthrow";
import { describe, expect, it } from "vitest";

import { commentIntentId, resolvedCommentIntentId } from "../../../../../cli/commands/linear/commentCore.js";
import type { LinearCommentWriteDeps } from "../../../../../cli/commands/linear/commentDeps.js";
import { dryRunAnchor, resolveTarget, targetRefusalCode } from "../../../../../cli/commands/linear/commentTarget.js";
import { LinearVerbErrors } from "../../../../../cli/commands/linear/errors.js";
import { EXIT_ERROR, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import type { LinearDocumentComment } from "../../../../../live/linear/documentComments.js";
import type { LinearCommentForm } from "../../../../../outbound/linear/commentTypes.js";

const DOCUMENT_ID = "f0a8e983-ffe3-4334-8a0c-cae7404502e3";
const CONTENT_ID = "50dd356c-f486-40c3-9759-0736ad45ab4e";
const NODE = { content: "**Lean: no, as a follow-up.**", documentContentId: CONTENT_ID, id: DOCUMENT_ID };

const DOCUMENT_FORM: LinearCommentForm = {
  artifact: { evidence: [], summary: "i'd push to do this first." },
  fields: { documentId: "cdd0e58a1f3b", quotedText: "Lean: no, as a follow-up." },
};

const ISSUE_FORM: LinearCommentForm = {
  artifact: { evidence: [{ label: "run", url: "https://x.test/1" }], summary: "Staging exhausted its pool." },
  fields: { issueId: "INFR-1" },
};

const ROOT_ID = "3b07ede1-fb31-4e7c-8f5d-9337596d2c5b";
const REPLY_ID = "40e6425a-0000-4000-8000-000000000000";

/** The document's comments as the fake lookup holds them: one thread root and one reply under it. */
const COMMENTS: readonly LinearDocumentComment[] = [
  { body: "How long do refresh tokens last?", id: ROOT_ID, parentId: undefined },
  { body: "OK with a long duration.", id: REPLY_ID, parentId: ROOT_ID },
];

const REPLY_FORM: LinearCommentForm = {
  artifact: { evidence: [], summary: "google sets no fixed lifetime." },
  fields: { documentId: "cdd0e58a1f3b", parentId: ROOT_ID },
};

/** The three edges this module reaches, recording which document ids were read and which comments looked up. */
function edges({ token }: { token: string | undefined }): {
  deps: Pick<LinearCommentWriteDeps, "readDocument" | "readDocumentComment" | "resolveToken">;
  lookups: string[];
  reads: string[];
} {
  const reads: string[] = [];
  const lookups: string[] = [];
  return {
    deps: {
      readDocument: ({ id }) => {
        reads.push(id);
        return Promise.resolve(ok(NODE));
      },
      readDocumentComment: ({ documentId, commentId }) => {
        lookups.push(`${documentId}/${commentId}`);
        return Promise.resolve(ok(COMMENTS.find((comment) => comment.id === commentId)));
      },
      resolveToken: () => token,
    },
    lookups,
    reads,
  };
}

describe("resolveTarget", () => {
  it("reads nothing for an issue comment", async () => {
    const { deps, reads } = edges({ token: "t" });

    expect(unwrap(await resolveTarget({ deps, form: ISSUE_FORM, token: "t" }))).toEqual({
      id: "INFR-1",
      kind: "issue",
    });
    expect(reads).toEqual([]);
  });

  it("reads the document it names and resolves its canonical id and content id, looking up no parent", async () => {
    const { deps, lookups, reads } = edges({ token: "t" });

    expect(unwrap(await resolveTarget({ deps, form: DOCUMENT_FORM, token: "t" }))).toEqual({
      documentContentId: CONTENT_ID,
      id: DOCUMENT_ID,
      kind: "document",
      parentExcerpt: undefined,
      parentId: undefined,
      quotedText: "Lean: no, as a follow-up.",
    });
    expect(reads).toEqual(["cdd0e58a1f3b"]);
    expect(lookups).toEqual([]);
  });

  it("names a failed read as DOCUMENT_UNREADABLE carrying the read's own reason", async () => {
    const { deps: base } = edges({ token: "t" });
    const deps = { ...base, readDocument: () => Promise.resolve(err({ message: "socket hang up" })) };

    const refused = unwrapErr(await resolveTarget({ deps, form: DOCUMENT_FORM, token: "t" }));

    expect(refused.code).toBe("DOCUMENT_UNREADABLE");
    expect(refused.message).toContain("socket hang up");
  });

  it("resolves a reply to a thread root, looked up on the CANONICAL document id", async () => {
    const { deps, lookups } = edges({ token: "t" });

    expect(unwrap(await resolveTarget({ deps, form: REPLY_FORM, token: "t" }))).toEqual({
      documentContentId: CONTENT_ID,
      id: DOCUMENT_ID,
      kind: "document",
      parentExcerpt: "How long do refresh tokens last?",
      parentId: ROOT_ID,
      quotedText: undefined,
    });
    expect(lookups).toEqual([`${DOCUMENT_ID}/${ROOT_ID}`]);
  });

  it("refuses a reply whose parent is itself a reply, naming the root to use", async () => {
    const { deps } = edges({ token: "t" });
    const form: LinearCommentForm = { ...REPLY_FORM, fields: { documentId: DOCUMENT_ID, parentId: REPLY_ID } };

    const refused = unwrapErr(await resolveTarget({ deps, form, token: "t" }));

    expect(refused.code).toBe("PARENT_IS_REPLY");
    expect(refused.message).toContain(`reply to its thread's root, parentId ${ROOT_ID}`);
  });

  it("refuses a reply whose parent is not on the document", async () => {
    const { deps } = edges({ token: "t" });
    const form: LinearCommentForm = { ...REPLY_FORM, fields: { documentId: DOCUMENT_ID, parentId: "nope" } };

    const refused = unwrapErr(await resolveTarget({ deps, form, token: "t" }));

    expect(refused.code).toBe("PARENT_NOT_FOUND");
    expect(refused.message).toContain("parentId nope is not a comment on document");
  });

  it("names a failed comments read as DOCUMENT_UNREADABLE, never as an absent parent", async () => {
    const { deps: base } = edges({ token: "t" });
    const deps = { ...base, readDocumentComment: () => Promise.resolve(err({ message: "rate limited" })) };

    const refused = unwrapErr(await resolveTarget({ deps, form: REPLY_FORM, token: "t" }));

    expect(refused.code).toBe("DOCUMENT_UNREADABLE");
    expect(refused.message).toContain(`its comments could not be read to find parentId ${ROOT_ID}: rate limited`);
  });
});

describe("targetRefusalCode", () => {
  it("answers usage for an unanchored quote or a bad parent and error for an unreadable document", () => {
    const quote = LinearVerbErrors.quoteNotFound({ documentId: DOCUMENT_ID, quotedText: "x" });
    const missing = LinearVerbErrors.parentNotFound({ documentId: DOCUMENT_ID, parentId: "x" });
    const nested = LinearVerbErrors.parentIsReply({ parentId: REPLY_ID, rootId: ROOT_ID });
    const unreadable = LinearVerbErrors.documentUnreadable({ documentId: DOCUMENT_ID, reason: "gone" });

    expect(targetRefusalCode({ error: quote })).toBe(EXIT_USAGE);
    expect(targetRefusalCode({ error: missing })).toBe(EXIT_USAGE);
    expect(targetRefusalCode({ error: nested })).toBe(EXIT_USAGE);
    expect(targetRefusalCode({ error: unreadable })).toBe(EXIT_ERROR);
  });
});

describe("dryRunAnchor", () => {
  it("prints no anchor for an issue comment and keeps the id it was given", async () => {
    const { deps, reads } = edges({ token: "t" });

    expect(await dryRunAnchor({ deps, form: ISSUE_FORM, home: "/h", id: "given", intentForm: ISSUE_FORM })).toEqual({
      id: "given",
      line: undefined,
      refused: false,
    });
    expect(reads).toEqual([]);
  });

  it("says the anchor was not checked when the home has no token, and reads nothing", async () => {
    const { deps, reads } = edges({ token: undefined });

    const anchor = await dryRunAnchor({
      deps,
      form: DOCUMENT_FORM,
      home: "/h",
      id: "given",
      intentForm: DOCUMENT_FORM,
    });

    expect(anchor).toEqual({
      id: "given",
      line: "not checked — no Linear token for this home, so the document was not read",
      refused: false,
    });
    expect(reads).toEqual([]);
  });

  it("REFUSES a reply's preview when the home has no token, since the parent check is the whole preview", async () => {
    const { deps, reads } = edges({ token: undefined });

    const anchor = await dryRunAnchor({ deps, form: REPLY_FORM, home: "/h", id: "given", intentForm: REPLY_FORM });

    expect(anchor).toEqual({
      id: "given",
      line: "REFUSED — no Linear token for this home, so the document was not read",
      refused: true,
    });
    expect(reads).toEqual([]);
  });

  it("resolves the anchor and prints the id the live write would use", async () => {
    const { deps } = edges({ token: "t" });
    const target = unwrap(await resolveTarget({ deps, form: DOCUMENT_FORM, token: "t" }));

    const anchor = await dryRunAnchor({
      deps,
      form: DOCUMENT_FORM,
      home: "/h",
      id: commentIntentId({ form: DOCUMENT_FORM }),
      intentForm: DOCUMENT_FORM,
    });

    expect(anchor).toEqual({
      id: resolvedCommentIntentId({ form: DOCUMENT_FORM, target }),
      line: `resolved — attaches to document content ${CONTENT_ID}`,
      refused: false,
    });
  });

  it("names the thread a reply joins on the anchor line, and keys the id on that thread", async () => {
    const { deps } = edges({ token: "t" });

    const anchor = await dryRunAnchor({ deps, form: REPLY_FORM, home: "/h", id: "given", intentForm: REPLY_FORM });
    const elsewhere = resolvedCommentIntentId({
      form: REPLY_FORM,
      target: {
        documentContentId: CONTENT_ID,
        id: DOCUMENT_ID,
        kind: "document",
        parentExcerpt: undefined,
        parentId: "another-root",
        quotedText: undefined,
      },
    });

    expect(anchor.line).toBe(
      `resolved — attaches to document content ${CONTENT_ID}, replying in thread ${ROOT_ID}, which opens ` +
        '"How long do refresh tokens last?"',
    );
    expect(anchor.refused).toBe(false);
    expect(anchor.id).not.toBe(elsewhere);
  });

  it("refuses a quote the document does not hold, naming it on the anchor line", async () => {
    const { deps } = edges({ token: "t" });
    const form: LinearCommentForm = { ...DOCUMENT_FORM, fields: { documentId: DOCUMENT_ID, quotedText: "Lean: yes." } };

    const anchor = await dryRunAnchor({ deps, form, home: "/h", id: "given", intentForm: form });

    expect(anchor.refused).toBe(true);
    expect(anchor.id).toBe("given");
    expect(anchor.line).toContain('REFUSED — quotedText "Lean: yes." is not in document');
  });
});
