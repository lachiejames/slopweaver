import { describe, expect, it } from "vitest";

import { githubVerbErrorLines } from "../../../../../cli/commands/github/errors.js";
import {
  parseReviewDraftArgs,
  postRefusals,
  submittedStateOf,
  targetRefusals,
} from "../../../../../cli/commands/github/reviewDraftCore.js";
import { MAX_REVIEW_COMMENTS, parseReviewDraftForm } from "../../../../../cli/commands/github/reviewDraftForm.js";
import type { ReviewTarget } from "../../../../../corpus/github/writeReviewDraft.js";
import { type ParkedReviewDraft, reviewDraftDigest } from "../../../../../outbound/github/reviewDraft.js";

const HEAD = "d5e7b95cb463f00d54be6f14430afc6648deb99b";
const PATCH = ["@@ -1,3 +1,4 @@", " one", " two", "+three", " four"].join("\n");
const TARGET: ReviewTarget = {
  authorId: 2,
  authorLogin: "colleague",
  headSha: HEAD,
  merged: false,
  state: "open",
  title: "t",
  url: "u",
};

/** The refusal lines a form produces, or empty when it decodes. */
function formRefusals({ form }: { form: unknown }): readonly string[] {
  const parsed = parseReviewDraftForm({
    exactVoiceRules: [{ kind: "word", value: "delve" }],
    raw: JSON.stringify(form),
  });
  return parsed.isErr() ? githubVerbErrorLines({ error: parsed.error }) : [];
}

describe("parseReviewDraftForm", () => {
  const comment = { body: "maybe guard this", line: 3, path: "src/a.ts" };

  it("decodes a review and leaves the deeper-review offer, which is never posted, unjudged", () => {
    expect(
      formRefusals({ form: { body: "fine", comments: [comment], deeperReview: "let us delve", verdict: "COMMENT" } }),
    ).toEqual([]);
  });

  it("allows an APPROVE with no body and refuses a COMMENT or REQUEST_CHANGES without one", () => {
    expect(formRefusals({ form: { body: "", comments: [], verdict: "APPROVE" } })).toEqual([]);
    expect(formRefusals({ form: { body: " ", comments: [], verdict: "REQUEST_CHANGES" } }).join("\n")).toContain(
      "a REQUEST_CHANGES review needs a body",
    );
  });

  it("refuses a path outside the repository, an unknown field, and more comments than the bound", () => {
    const refusals = ({ form }: { form: unknown }): string => formRefusals({ form }).join("\n");

    expect(
      refusals({ form: { body: "x", comments: [{ ...comment, path: "../etc/passwd" }], verdict: "COMMENT" } }),
    ).toContain("repository-relative");
    expect(refusals({ form: { body: "x", comments: [], event: "COMMENT", verdict: "COMMENT" } })).not.toBe("");
    const many = Array.from({ length: MAX_REVIEW_COMMENTS + 1 }, () => comment);
    expect(refusals({ form: { body: "x", comments: many, verdict: "COMMENT" } })).not.toBe("");
  });

  it("applies the owner's voice rules to the body and each comment, naming where", () => {
    expect(
      formRefusals({ form: { body: "we delve", comments: [{ ...comment, body: "delve" }], verdict: "COMMENT" } }).join(
        "\n",
      ),
    ).toMatch(/body[\s\S]*comments\[0\]\.body/);
  });
});

describe("parseReviewDraftArgs", () => {
  it("takes the id as the bare word after the sub-command, the form the card hands out", () => {
    const parsed = parseReviewDraftArgs({ defaultHome: "/h", rest: ["post", "rd-1", "--approve", "abc"] });

    expect(parsed._unsafeUnwrap()).toEqual({
      approve: "abc",
      dryRun: false,
      home: "/h",
      id: "rd-1",
      json: false,
      mode: "post",
    });
  });

  it("refuses a record missing what the card needs, naming every gap at once", () => {
    const parsed = parseReviewDraftArgs({ defaultHome: "/h", rest: ["record", "--repo", "not-a-slug"] });
    const lines = githubVerbErrorLines({ error: parsed._unsafeUnwrapErr() }).join("\n");

    expect(lines).toContain("--repo <owner/name>");
    expect(lines).toContain("--number");
    expect(lines).toContain("--form");
    expect(lines).toContain("--why");
  });

  it("refuses a drop with no note", () => {
    const parsed = parseReviewDraftArgs({ defaultHome: "/h", rest: ["drop", "rd-1"] });

    expect(githubVerbErrorLines({ error: parsed._unsafeUnwrapErr() }).join("\n")).toContain(
      "review-draft drop needs --note",
    );
  });
});

describe("targetRefusals", () => {
  it("refuses the owner's own, a merged, a closed, and an authorless pull request", () => {
    expect(targetRefusals({ target: TARGET, viewerId: 1 })).toEqual([]);
    expect(targetRefusals({ target: TARGET, viewerId: 2 })[0]).toContain("own pull request");
    expect(targetRefusals({ target: { ...TARGET, merged: true }, viewerId: 1 })).toEqual([
      "the pull request is already merged",
    ]);
    expect(targetRefusals({ target: { ...TARGET, state: "closed" }, viewerId: 1 })).toEqual([
      "the pull request is closed",
    ]);
    expect(targetRefusals({ target: { ...TARGET, authorId: undefined }, viewerId: 1 })[0]).toContain("no author");
  });
});

describe("postRefusals", () => {
  const hunk = [
    { kind: "header" as const, text: "@@ -1,3 +1,4 @@" },
    { kind: "context" as const, newLine: 1, oldLine: 1, text: "one" },
    { kind: "context" as const, newLine: 2, oldLine: 2, text: "two" },
    { kind: "add" as const, newLine: 3, text: "three" },
  ];
  const bound = {
    body: "b",
    comments: [{ body: "c", hunk, line: 3, path: "src/a.ts" }],
    headSha: HEAD,
    number: 7,
    repo: "o/r",
    verdict: "COMMENT" as const,
  };
  const draft: ParkedReviewDraft = {
    ...bound,
    author: "colleague",
    digest: reviewDraftDigest({ draft: bound }),
    id: "rd-1",
    title: "t",
    tsIso: "2026-09-28T00:00:00.000Z",
    url: "u",
    why: "w",
  };

  it("clears a review whose pull request still matches the card", () => {
    expect(postRefusals({ draft, files: [{ patch: PATCH, path: "src/a.ts" }], target: TARGET, viewerId: 1 })).toEqual(
      [],
    );
  });

  it("refuses when the diff under a comment changed with no new commit — the base moved", () => {
    const moved = PATCH.replace(" two", " TWO");

    expect(
      postRefusals({ draft, files: [{ patch: moved, path: "src/a.ts" }], target: TARGET, viewerId: 1 })[0],
    ).toContain("the diff around this comment is not what the card showed");
  });
});

describe("submittedStateOf", () => {
  it("names the state GitHub reads each verdict back as", () => {
    expect(
      (["APPROVE", "COMMENT", "REQUEST_CHANGES"] as const).map((verdict) => submittedStateOf({ verdict })),
    ).toEqual(["APPROVED", "COMMENTED", "CHANGES_REQUESTED"]);
  });
});
