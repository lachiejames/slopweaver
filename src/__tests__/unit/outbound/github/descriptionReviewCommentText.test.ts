/*
 * The comments a description review binds: the ones the write posts, and the ones already on the pull request, whose
 * thread history reaches the reviewer's evidence and never the digest a CLEAN receipt is stored under.
 */
import { describe, expect, it } from "vitest";

import {
  buildDescriptionManifest,
  manifestDifferences,
  manifestSha256Of,
  textSha256,
} from "../../../../outbound/github/descriptionReview.js";
import {
  canonicalDescriptionComments,
  descriptionCommentsText,
  existingCommentsDigestText,
  existingCommentsEvidenceText,
} from "../../../../outbound/github/descriptionReviewCommentText.js";
import type {
  DescriptionReviewComment,
  DescriptionReviewManifest,
  ExistingPullRequestComment,
} from "../../../../outbound/github/descriptionReviewTypes.js";

/** Two walkthrough comments, as GitHub receives them. */
const COMMENT_A: DescriptionReviewComment = {
  body: "💡 The consent callback keeps the session.",
  line: 12,
  path: "src/a.ts",
};
const COMMENT_B: DescriptionReviewComment = {
  body: "🧪 The callback test covers a personal account.",
  line: 3,
  path: "src/b.ts",
};

/** A conversation comment already on the pull request. */
const EXISTING: ExistingPullRequestComment = {
  authorLogin: "quillfeather",
  body: "Does this hold for a work account too?",
  createdAtIso: "2026-11-17T00:00:00Z",
  id: "IC_1",
  kind: "issue-comment",
  updatedAtIso: "2026-11-17T00:00:00Z",
  url: "https://github.com/acme/widgets/pull/7#issuecomment-1",
};

/** An inline self-review comment in an open, unresolved thread. */
const INLINE: ExistingPullRequestComment = {
  authorLogin: "quillfeather",
  body: "It used to join the two sections as two text runs.",
  createdAtIso: "2026-11-17T00:00:00Z",
  id: "PRRC_1",
  kind: "review-comment",
  originalLine: 114,
  path: "src/a.ts",
  supersededByThisWrite: false,
  threadId: "PRRT_1",
  threadResolved: false,
  updatedAtIso: "2026-11-17T00:00:00Z",
  url: "https://github.com/acme/widgets/pull/7#discussion_r1",
};

/** A manifest over fixed values, with either comment set overridden. */
function manifest(
  over: Partial<{ comments: DescriptionReviewComment[]; existingComments: ExistingPullRequestComment[] }> = {},
): DescriptionReviewManifest {
  return buildDescriptionManifest({
    baseBranch: "main",
    body: "Outlook connect failed after consent for a personal account.",
    changeDigest: "c".repeat(64),
    comments: [],
    existingComments: [],
    images: [],
    repository: "acme/widgets",
    rulesSha256: "r".repeat(64),
    title: "fix(outlook): keep the session after consent",
    ...over,
  });
}

describe("the comments a manifest binds", () => {
  it("is a different packet when the write posts one comment rather than none", () => {
    const none = manifest();
    const one = manifest({ comments: [COMMENT_A] });
    expect(none.commentsSha256).toBe(textSha256({ text: "[]\n" }));
    expect(one.commentsSha256).not.toBe(none.commentsSha256);
    expect(manifestSha256Of({ manifest: one })).not.toBe(manifestSha256Of({ manifest: none }));
  });

  it("is the same packet whatever order the outgoing comments are given in", () => {
    const forwards = manifest({ comments: [COMMENT_A, COMMENT_B] });
    const backwards = manifest({ comments: [COMMENT_B, COMMENT_A] });
    expect(backwards.commentsSha256).toBe(forwards.commentsSha256);
    expect(canonicalDescriptionComments({ comments: [COMMENT_B, COMMENT_A] }).map((one) => one.path)).toStrictEqual([
      "src/a.ts",
      "src/b.ts",
    ]);
  });

  it("hashes the exact text the packet carries", () => {
    expect(manifest({ comments: [COMMENT_A] }).commentsSha256).toBe(
      textSha256({ text: descriptionCommentsText({ comments: [COMMENT_A] }) }),
    );
  });

  it("is a different packet when a comment arrives on the pull request, or one already there is edited", () => {
    const none = manifest();
    const arrived = manifest({ existingComments: [EXISTING] });
    const edited = manifest({ existingComments: [{ ...EXISTING, body: "Does this hold for a work account?" }] });
    expect(arrived.existingCommentsSha256).not.toBe(none.existingCommentsSha256);
    expect(edited.existingCommentsSha256).not.toBe(arrived.existingCommentsSha256);
  });

  it("binds the same digest whether a thread is open, resolved or superseded by this write", () => {
    const open = manifest({ existingComments: [INLINE] });
    const resolved = manifest({ existingComments: [{ ...INLINE, threadResolved: true }] });
    const superseded = manifest({ existingComments: [{ ...INLINE, supersededByThisWrite: true }] });
    expect(resolved.existingCommentsSha256).toBe(open.existingCommentsSha256);
    expect(superseded.existingCommentsSha256).toBe(open.existingCommentsSha256);
    expect(manifestSha256Of({ manifest: resolved })).toBe(manifestSha256Of({ manifest: open }));
    expect(manifestSha256Of({ manifest: superseded })).toBe(manifestSha256Of({ manifest: open }));
  });

  it("binds only the fields a review bound before thread history reached the packet", () => {
    expect(existingCommentsDigestText({ comments: [{ ...INLINE, threadResolved: true }] })).toBe(
      '[{"authorLogin":"quillfeather","body":"It used to join the two sections as two text runs.",' +
        '"createdAtIso":"2026-11-17T00:00:00Z","id":"PRRC_1","kind":"review-comment","originalLine":114,' +
        '"path":"src/a.ts","updatedAtIso":"2026-11-17T00:00:00Z","url":"https://github.com/acme/widgets/pull/7#discussion_r1"}]\n',
    );
  });

  it("shows the reviewer each thread's history in the evidence the digest leaves out", () => {
    const open = existingCommentsEvidenceText({ comments: [INLINE] });
    const resolved = existingCommentsEvidenceText({ comments: [{ ...INLINE, threadResolved: true }] });
    expect(open).toContain('"threadResolved":false');
    expect(resolved).toContain('"threadResolved":true');
    expect(resolved).toContain('"supersededByThisWrite":false');
    expect(resolved).toContain('"threadId":"PRRT_1"');
  });

  it("names both comment sets when they differ", () => {
    const want = manifest({ comments: [COMMENT_A], existingComments: [EXISTING] });
    expect(manifestDifferences({ have: manifest(), want })).toStrictEqual([
      "the comments this write would post changed",
      "the pull request's existing comments changed",
    ]);
  });
});
