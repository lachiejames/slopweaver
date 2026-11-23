/**
 * The `linear comment create` COMMAND — same orchestration-assertion rationale as
 * `src/__tests__/unit/cli/commands/linear/run/create.test.ts`.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { errAsync, err as errResult, ok, okAsync } from "neverthrow";
import { afterEach, describe, expect, it } from "vitest";

import {
  commentIntentId,
  type ResolvedCommentTarget,
  resolvedCommentIntentId,
} from "../../../../../cli/commands/linear/commentCore.js";
import type { LinearCommentWriteDeps } from "../../../../../cli/commands/linear/commentDeps.js";
import { runLinearComment } from "../../../../../cli/commands/linear/commentRun.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import type { LinearWriteApi, ReadComment, WrittenObject } from "../../../../../corpus/linear/write.js";
import type { IngestError } from "../../../../../lib/ingestError.js";
import { readAppendRecord } from "../../../../../outbound/linear/commentLedger.js";
import type { LinearCommentForm } from "../../../../../outbound/linear/commentTypes.js";
import { IdentityRosterErrors } from "../../../../../silver/identityRosterErrors.js";
import { memoryDoorLedger } from "../../../../doorLedgerFixture.js";
import { emptyMentionResolution } from "../../../../linearMentionFixtures.js";

const STORE_DOWN = IdentityRosterErrors.storeUnavailable({ doing: "read the roster", reason: "disk full" });

const ISSUE_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

const TYPED_FORM: LinearCommentForm = {
  artifact: {
    evidence: [{ label: "the failing run", url: "https://example.test/run/1" }],
    summary: "Staging exhausted its pool.",
  },
  fields: { issueId: ISSUE_ID },
};

const FORM = JSON.stringify(TYPED_FORM);

const DOCUMENT_ID = "f0a8e983-ffe3-4334-8a0c-cae7404502e3";
const CONTENT_ID = "50dd356c-f486-40c3-9759-0736ad45ab4e";
const DOCUMENT_NODE = {
  content: "## Key Debates\n\n3. **Lean: no, as a follow-up.** The bootstrap reduces it to one line.",
  documentContentId: CONTENT_ID,
  id: DOCUMENT_ID,
};

const DOCUMENT_FORM: LinearCommentForm = {
  artifact: { evidence: [], summary: "i'd push to do this first, or at least alongside." },
  fields: { documentId: DOCUMENT_ID, quotedText: "Lean: no, as a follow-up." },
};

const RESOLVED: ResolvedCommentTarget = {
  documentContentId: CONTENT_ID,
  id: DOCUMENT_ID,
  kind: "document",
  parentExcerpt: undefined,
  parentId: undefined,
  quotedText: "Lean: no, as a follow-up.",
};

const ROOT_ID = "3b07ede1-fb31-4e7c-8f5d-9337596d2c5b";

const REPLY_FORM: LinearCommentForm = {
  artifact: { evidence: [], summary: "google sets no fixed lifetime." },
  fields: { documentId: DOCUMENT_ID, parentId: ROOT_ID },
};

const REPLY_RESOLVED: ResolvedCommentTarget = {
  documentContentId: CONTENT_ID,
  id: DOCUMENT_ID,
  kind: "document",
  parentExcerpt: "How long do refresh tokens last?",
  parentId: ROOT_ID,
  quotedText: undefined,
};

// A write echoes an id and nothing else; the URL is the read-back's to give.
const WRITTEN: WrittenObject = { id: "c-1" };
const READ: ReadComment = {
  body: "whatever Linear stored",
  id: "c-1",
  updatedAt: "2026-08-26T10:00:00.000Z",
  url: "https://linear.test/issue/AAA-1#comment-c-1",
};

function ingestError({ message }: { message: string }): IngestError {
  return { kind: "http", message, operation: "linear.commentCreate", provider: "linear" };
}

function notUsedByLinearComment(): never {
  throw new Error("linear comment never calls the issue/project lane");
}

function harness({
  home,
  create,
  read,
  form = FORM,
}: {
  home: string;
  create?: "ok" | "fail";
  read?: "ok" | "missing" | "error";
  form?: string;
}): {
  deps: LinearCommentWriteDeps;
  calls: string[];
  out: string[];
  err: string[];
  sentBody: () => string | undefined;
  sentInput: () => Readonly<Record<string, unknown>> | undefined;
} {
  const calls: string[] = [];
  const out: string[] = [];
  const err: string[] = [];
  let sent: string | undefined;
  let sentInput: Readonly<Record<string, unknown>> | undefined;
  const api: LinearWriteApi = {
    createComment: ({ id, input }) => {
      calls.push(`create:${id}`);
      if (create === "fail") {
        return errAsync(ingestError({ message: "boom" }));
      }
      const body = input["body"];
      sent = typeof body === "string" ? body : undefined;
      sentInput = input;
      return okAsync(WRITTEN);
    },
    createIssue: notUsedByLinearComment,
    createMilestone: notUsedByLinearComment,
    createProject: notUsedByLinearComment,
    createRelation: notUsedByLinearComment,
    createProjectUpdate: notUsedByLinearComment,
    deleteProjectUpdate: notUsedByLinearComment,
    readProjectUpdate: notUsedByLinearComment,
    deleteComment: notUsedByLinearComment,
    deleteIssue: notUsedByLinearComment,
    deleteMilestone: notUsedByLinearComment,
    deleteProject: notUsedByLinearComment,
    deleteRelation: notUsedByLinearComment,
    readComment: () => {
      calls.push("read");
      if (read === "error") {
        return errAsync(ingestError({ message: "read blew up" }));
      }
      if (read === "missing" || (create === "fail" && read === undefined)) {
        return okAsync(undefined);
      }
      return okAsync(READ);
    },
    readIssue: notUsedByLinearComment,
    readMilestone: notUsedByLinearComment,
    readProject: notUsedByLinearComment,
    readRelation: notUsedByLinearComment,
    updateIssue: notUsedByLinearComment,
    updateProject: notUsedByLinearComment,
  };
  return {
    calls,
    deps: {
      bareRefContext: () => ({ repos: [] }),
      env: () => undefined,
      doorLedger: memoryDoorLedger().port,
      err: (line) => err.push(line),
      makeApi: () => {
        calls.push("makeApi");
        return api;
      },
      nowIso: () => "2026-08-26T10:00:00.000Z",
      out: (line) => out.push(line),
      previewMentions: async ({ keys }) => ok(emptyMentionResolution({ keys })),
      readDocument: ({ id }) => {
        calls.push(`readDocument:${id}`);
        return Promise.resolve(ok(DOCUMENT_NODE));
      },
      readDocumentComment: ({ documentId, commentId }) => {
        calls.push(`readDocumentComment:${documentId}/${commentId}`);
        const root = { body: "How long do refresh tokens last?", id: ROOT_ID, parentId: undefined };
        return Promise.resolve(ok(commentId === ROOT_ID ? root : undefined));
      },
      readForm: () => form,
      resolveMentions: async ({ keys }) => ok(emptyMentionResolution({ keys })),
      resolveToken: ({ home: given }) => {
        calls.push(`token:${given === home ? "same-home" : "WRONG-HOME"}`);
        return "lin_api_fake";
      },
    },
    err,
    out,
    sentBody: () => sent,
    sentInput: () => sentInput,
  };
}

function argv({ rest }: { rest: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "linear", "comment", ...rest];
}

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-linear-comment-"));
  fixtureDirs.push(home);
  return home;
}

describe("runLinearComment — on a document", () => {
  it("reads the document, then posts inline on its content with the quote, recording the document", async () => {
    const home = tempHome();
    const { deps, calls, sentInput } = harness({ form: JSON.stringify(DOCUMENT_FORM), home });
    const id = resolvedCommentIntentId({ form: DOCUMENT_FORM, target: RESOLVED });

    expect(await runLinearComment({ argv: argv({ rest: ["create", "--form", "-", "--home", home] }), deps })).toBe(
      EXIT_OK,
    );
    expect(calls).toEqual(["token:same-home", `readDocument:${DOCUMENT_ID}`, "makeApi", `create:${id}`, "read"]);
    expect(sentInput()).toEqual({
      body: "i'd push to do this first, or at least alongside.",
      documentContentId: CONTENT_ID,
      quotedText: "Lean: no, as a follow-up.",
    });
    expect(readAppendRecord({ home, id, kind: "linear-comments" })!.subject).toBe(DOCUMENT_ID);
  });

  it("keys a form naming the document by SLUG on its canonical id, so the uuid retry is a duplicate", async () => {
    const home = tempHome();
    const bySlug: LinearCommentForm = {
      ...DOCUMENT_FORM,
      fields: { ...DOCUMENT_FORM.fields, documentId: "cdd0e58a1f3b" },
    };
    const first = harness({ form: JSON.stringify(bySlug), home });
    const byUuid = harness({ form: JSON.stringify(DOCUMENT_FORM), home });
    const id = resolvedCommentIntentId({ form: DOCUMENT_FORM, target: RESOLVED });

    expect(
      await runLinearComment({ argv: argv({ rest: ["create", "--form", "-", "--home", home] }), deps: first.deps }),
    ).toBe(EXIT_OK);
    expect(
      await runLinearComment({ argv: argv({ rest: ["create", "--form", "-", "--home", home] }), deps: byUuid.deps }),
    ).toBe(EXIT_EXPECTED_EMPTY);
    expect(first.calls).toEqual(["token:same-home", "readDocument:cdd0e58a1f3b", "makeApi", `create:${id}`, "read"]);
    expect(byUuid.calls).toEqual(["token:same-home", `readDocument:${DOCUMENT_ID}`, "makeApi"]);
    expect(readAppendRecord({ home, id, kind: "linear-comments" })!.subject).toBe(DOCUMENT_ID);
  });

  it("REFUSES a quote the document does not hold before the door — nothing reserved, nothing sent", async () => {
    const home = tempHome();
    const form: LinearCommentForm = { ...DOCUMENT_FORM, fields: { documentId: DOCUMENT_ID, quotedText: "Lean: yes." } };
    const { deps, calls, err } = harness({ form: JSON.stringify(form), home });

    expect(await runLinearComment({ argv: argv({ rest: ["create", "--form", "-", "--home", home] }), deps })).toBe(
      EXIT_USAGE,
    );
    expect(calls).toEqual(["token:same-home", `readDocument:${DOCUMENT_ID}`]);
    expect(err[0]!).toContain('quotedText "Lean: yes." is not in document');
    expect(readAppendRecord({ home, id: commentIntentId({ form }), kind: "linear-comments" })).toBe(undefined);
  });

  it("checks the anchor on a dry run too, and sends nothing", async () => {
    const home = tempHome();
    const { deps, calls, out } = harness({ form: JSON.stringify(DOCUMENT_FORM), home });

    expect(
      await runLinearComment({ argv: argv({ rest: ["create", "--form", "-", "--dry-run", "--home", home] }), deps }),
    ).toBe(EXIT_OK);
    expect(calls).toEqual(["token:same-home", `readDocument:${DOCUMENT_ID}`]);
    expect(out).toContain(`anchor:     resolved — attaches to document content ${CONTENT_ID}`);
  });

  it("checks a reply's parent among the document's comments, then posts it in that thread", async () => {
    const home = tempHome();
    const { deps, calls, sentInput } = harness({ form: JSON.stringify(REPLY_FORM), home });
    const id = resolvedCommentIntentId({ form: REPLY_FORM, target: REPLY_RESOLVED });

    expect(await runLinearComment({ argv: argv({ rest: ["create", "--form", "-", "--home", home] }), deps })).toBe(
      EXIT_OK,
    );
    expect(calls).toEqual([
      "token:same-home",
      `readDocument:${DOCUMENT_ID}`,
      `readDocumentComment:${DOCUMENT_ID}/${ROOT_ID}`,
      "makeApi",
      `create:${id}`,
      "read",
    ]);
    expect(sentInput()).toEqual({
      body: "google sets no fixed lifetime.",
      documentContentId: CONTENT_ID,
      parentId: ROOT_ID,
    });
  });

  it("REFUSES a reply whose parent is not on the document before the door — nothing sent", async () => {
    const home = tempHome();
    const form: LinearCommentForm = { ...REPLY_FORM, fields: { documentId: DOCUMENT_ID, parentId: "gone" } };
    const { deps, calls, err } = harness({ form: JSON.stringify(form), home });

    expect(await runLinearComment({ argv: argv({ rest: ["create", "--form", "-", "--home", home] }), deps })).toBe(
      EXIT_USAGE,
    );
    expect(calls).toEqual([
      "token:same-home",
      `readDocument:${DOCUMENT_ID}`,
      `readDocumentComment:${DOCUMENT_ID}/gone`,
    ]);
    expect(err[0]!).toContain("parentId gone is not a comment on document");
  });

  it("previews a reply with the thread it joins, and sends nothing", async () => {
    const home = tempHome();
    const { deps, calls, out } = harness({ form: JSON.stringify(REPLY_FORM), home });

    expect(
      await runLinearComment({ argv: argv({ rest: ["create", "--form", "-", "--dry-run", "--home", home] }), deps }),
    ).toBe(EXIT_OK);
    expect(calls).toEqual([
      "token:same-home",
      `readDocument:${DOCUMENT_ID}`,
      `readDocumentComment:${DOCUMENT_ID}/${ROOT_ID}`,
    ]);
    expect(out).toContain(`reply to:   ${ROOT_ID}`);
    expect(out).toContain(
      `anchor:     resolved — attaches to document content ${CONTENT_ID}, replying in thread ${ROOT_ID}, which ` +
        'opens "How long do refresh tokens last?"',
    );
  });
});

describe("runLinearComment", () => {
  it("posts the comment, reads it back, and records the reservation against its issue", async () => {
    const home = tempHome();
    const { deps, calls, out } = harness({ home });
    const id = commentIntentId({ form: TYPED_FORM });

    expect(await runLinearComment({ argv: argv({ rest: ["create", "--form", "-", "--home", home] }), deps })).toBe(
      EXIT_OK,
    );
    expect(calls).toEqual(["token:same-home", "makeApi", `create:${id}`, "read"]);
    expect(out[0]!).toBe("posted the comment");
    expect(readAppendRecord({ home, id, kind: "linear-comments" })).toEqual({
      confirmedIso: "2026-08-26T10:00:00.000Z",
      id,
      reservedIso: "2026-08-26T10:00:00.000Z",
      subject: ISSUE_ID,
    });
  });

  it("sends the bytes the renderer produced, with the evidence inside the collapsible", async () => {
    const home = tempHome();
    const { deps, sentBody } = harness({ home });

    await runLinearComment({ argv: argv({ rest: ["create", "--form", "-", "--home", home] }), deps });

    expect(sentBody()!).toContain("+++ Detail and evidence");
    expect(sentBody()!).toContain("- [the failing run](<https://example.test/run/1>)");
  });

  it("REFUSES the same comment on the same ticket a second time — one comment per intent", async () => {
    const home = tempHome();
    const first = harness({ home });
    await runLinearComment({ argv: argv({ rest: ["create", "--form", "-", "--home", home] }), deps: first.deps });

    const second = harness({ home });
    const code = await runLinearComment({
      argv: argv({ rest: ["create", "--form", "-", "--home", home] }),
      deps: second.deps,
    });

    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(second.out[0]!).toContain("already reserved at 2026-08-26T10:00:00.000Z");
    expect(second.calls).toEqual(["token:same-home", "makeApi"]);
  });

  it("reports UNCONFIRMED — never failure — when the mutation landed but the read-back found nothing", async () => {
    const home = tempHome();
    const { deps, out } = harness({ home, read: "missing" });

    expect(await runLinearComment({ argv: argv({ rest: ["create", "--form", "-", "--home", home] }), deps })).toBe(
      EXIT_EXPECTED_EMPTY,
    );
    expect(out[0]!).toContain("could NOT be read back");
  });

  it("reports LANDED when the mutation errored but the comment exists at the id we chose", async () => {
    const home = tempHome();
    const { deps, out } = harness({ create: "fail", home, read: "ok" });

    expect(await runLinearComment({ argv: argv({ rest: ["create", "--form", "-", "--home", home] }), deps })).toBe(
      EXIT_OK,
    );
    expect(out[0]!).toContain("despite a transport error");
  });

  it("reports INDETERMINATE when the mutation errored AND the read-back could not run", async () => {
    const home = tempHome();
    const { deps, out } = harness({ create: "fail", home, read: "error" });

    expect(await runLinearComment({ argv: argv({ rest: ["create", "--form", "-", "--home", home] }), deps })).toBe(
      EXIT_EXPECTED_EMPTY,
    );
    expect(out[0]!).toContain("unknown whether it landed");
  });

  it("reports FAILED only once a read-back established the comment is absent", async () => {
    const home = tempHome();
    const { deps, out } = harness({ create: "fail", home, read: "missing" });

    expect(await runLinearComment({ argv: argv({ rest: ["create", "--form", "-", "--home", home] }), deps })).toBe(
      EXIT_ERROR,
    );
    expect(out[0]!).toContain("the write failed");
  });

  it("a dry run resolves no token, reserves nothing and sends nothing", async () => {
    const home = tempHome();
    const { deps, calls, out } = harness({ home });
    const id = commentIntentId({ form: TYPED_FORM });

    expect(
      await runLinearComment({ argv: argv({ rest: ["create", "--form", "-", "--dry-run", "--home", home] }), deps }),
    ).toBe(EXIT_OK);
    expect(calls).toEqual([]);
    expect(out[0]!).toContain(id);
    expect(readAppendRecord({ home, id, kind: "linear-comments" })).toBe(undefined);
  });

  it("exits ERROR before the door, naming the store, when the roster cannot resolve the mentions", async () => {
    const home = tempHome();
    const h = harness({ home });
    const deps: LinearCommentWriteDeps = { ...h.deps, resolveMentions: async () => errResult(STORE_DOWN) };

    expect(await runLinearComment({ argv: argv({ rest: ["create", "--form", "-", "--home", home] }), deps })).toBe(
      EXIT_ERROR,
    );
    expect(h.err).toEqual([STORE_DOWN.message]);
    expect(h.calls).toEqual(["token:same-home"]);
  });

  it("exits ERROR on a dry run, naming the store, when the roster cannot preview the mentions", async () => {
    const home = tempHome();
    const h = harness({ home });
    const deps: LinearCommentWriteDeps = { ...h.deps, previewMentions: async () => errResult(STORE_DOWN) };

    expect(
      await runLinearComment({ argv: argv({ rest: ["create", "--form", "-", "--dry-run", "--home", home] }), deps }),
    ).toBe(EXIT_ERROR);
    expect(h.err).toEqual([STORE_DOWN.message]);
    expect(h.calls).toEqual([]);
  });

  it("refuses a form with no evidence at the door, before any effect", async () => {
    const home = tempHome();
    const bare = JSON.stringify({ artifact: { evidence: [], summary: "x" }, fields: { issueId: ISSUE_ID } });
    const { deps, calls, err } = harness({ form: bare, home });

    expect(await runLinearComment({ argv: argv({ rest: ["create", "--form", "-", "--home", home] }), deps })).toBe(
      EXIT_USAGE,
    );
    expect(calls).toEqual([]);
    expect(err.join("\n")).toContain("artifact.evidence");
  });

  it("refuses any sub-verb but create", async () => {
    const { deps, err } = harness({ home: tempHome() });

    expect(await runLinearComment({ argv: argv({ rest: ["update", "--form", "-"] }), deps })).toBe(EXIT_USAGE);
    expect(err[0]!).toContain("usage: slopweaver linear comment create");
  });
});
