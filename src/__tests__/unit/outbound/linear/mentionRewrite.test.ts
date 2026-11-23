/**
 * Where a mention may be written, and what happens to one that did not resolve.
 *
 * The coverage question this file exists to answer is REACH: `../../../../outbound/linear/mapText.ts` decides
 * which fields a rewrite touches, and a body region it forgets is a mention that silently stays a token in
 * the one place a reader was going to look. So every region is exercised, including a block nested under a
 * list item and the collapsed `aiPrompt`.
 */
import { describe, expect, it } from "vitest";

import type { LinearCommentArtifact } from "../../../../outbound/linear/commentTypes.js";
import type { LinearMentionResolution } from "../../../../outbound/linear/mentionIndex.js";
import {
  mentionKeysOfComment,
  mentionKeysOfIssue,
  rewriteCommentMentions,
  rewriteIssueMentions,
} from "../../../../outbound/linear/mentionRewrite.js";
import { renderCommentBody, renderIssueBody } from "../../../../outbound/linear/render.js";
import type { LinearIssueArtifact } from "../../../../outbound/linear/types.js";

const ID_ADA = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const ID_GRACE = "9c858901-8a57-4791-81fe-4c455b099bc9";

/** A resolution in which `ada` and `grace` resolve and nothing else does. */
function resolution(): LinearMentionResolution {
  return {
    candidates: new Map(),
    heldRequested: [],
    memberLookups: new Map(),
    resolved: new Map([
      ["ada", { label: "ada", linearId: ID_ADA, origin: "derived" as const }],
      ["grace", { label: "grace", linearId: ID_GRACE, origin: "verified" as const }],
    ]),
    roster: { addressableKeys: 2, collisions: [], derivedPeople: 2, freshness: { kind: "fresh" }, heldPeople: 0 },
  };
}

const EVERY_REGION: LinearIssueArtifact = {
  aiPrompt: [{ kind: "para", text: "brief @{ada}" }],
  kind: "structured",
  acceptance: ["signed off by @{ada}"],
  details: [{ blocks: [{ kind: "para", text: "folded for @{grace}" }], title: "Detail" }],
  problem: [
    { kind: "para", text: "opened by @{ada}" },
    {
      items: [{ nested: [{ kind: "para", text: "nested under it, @{grace}" }], text: "an item for @{grace}" }],
      kind: "bullets",
    },
    { items: [{ done: false, text: "chase @{ada}" }], kind: "checklist" },
    { kind: "code", lang: "", text: "literal @{ada}" },
  ],
  proofOfProblem: [{ kind: "para", text: "proved by @{grace}" }],
  solution: [{ kind: "para", text: "fixed with @{grace}" }],
};

describe("mentionKeysOfIssue", () => {
  it("collects from every prose region, in first-appearance order, once each", () => {
    expect(mentionKeysOfIssue({ artifact: EVERY_REGION })).toEqual(["ada", "grace"]);
  });

  it("collects from a freeform heading, which is prose the caller controls", () => {
    const artifact: LinearIssueArtifact = {
      aiPrompt: [{ kind: "para", text: "brief" }],
      body: [{ kind: "heading", text: "For @{ada}" }],
      kind: "freeform",
    };

    expect(mentionKeysOfIssue({ artifact })).toEqual(["ada"]);
  });

  it("collects from a details fold's title and its blocks", () => {
    const artifact: LinearIssueArtifact = {
      aiPrompt: [{ kind: "para", text: "brief" }],
      body: [{ kind: "para", text: "lead" }],
      details: [{ blocks: [{ kind: "para", text: "asked by @{grace}" }], title: "For @{ada}" }],
      kind: "freeform",
    };

    expect(mentionKeysOfIssue({ artifact })).toEqual(["ada", "grace"]);
  });
});

describe("rewriteIssueMentions", () => {
  it("rewrites every prose region into Linear's own markup", () => {
    const body = renderIssueBody({
      artifact: rewriteIssueMentions({ artifact: EVERY_REGION, resolution: resolution() }),
    });

    expect(body).toContain(`opened by @[ada](${ID_ADA})`);
    expect(body).toContain(`an item for @[grace](${ID_GRACE})`);
    expect(body).toContain(`nested under it, @[grace](${ID_GRACE})`);
    expect(body).toContain(`chase @[ada](${ID_ADA})`);
    expect(body).toContain(`fixed with @[grace](${ID_GRACE})`);
    expect(body).toContain(`proved by @[grace](${ID_GRACE})`);
    expect(body).toContain(`signed off by @[ada](${ID_ADA})`);
    expect(body).toContain(`brief @[ada](${ID_ADA})`);
    expect(body).toContain(`folded for @[grace](${ID_GRACE})`);
  });

  it("leaves a CODE block alone — its content is literal, and Linear renders no mention inside a fence", () => {
    const body = renderIssueBody({
      artifact: rewriteIssueMentions({ artifact: EVERY_REGION, resolution: resolution() }),
    });

    expect(body).toContain("literal @{ada}");
  });

  it("leaves an UNRESOLVED token exactly as written, rather than half-rewriting a body about to be refused", () => {
    const artifact: LinearIssueArtifact = {
      aiPrompt: [{ kind: "para", text: "brief" }],
      kind: "structured",
      problem: [{ kind: "para", text: "@{ada} and @{nobody}" }],
      solution: [{ kind: "para", text: "s" }],
    };
    const body = renderIssueBody({ artifact: rewriteIssueMentions({ artifact, resolution: resolution() }) });

    expect(body).toContain(`@[ada](${ID_ADA}) and @{nobody}`);
  });
});

describe("a comment", () => {
  const COMMENT: LinearCommentArtifact = {
    detail: [{ kind: "para", text: "detail for @{grace}" }],
    evidence: [{ label: "the run", url: "https://example.test/run/1" }],
    summary: "@{ada} this is idle.",
  };

  it("collects mention keys from the summary AND the detail", () => {
    expect(mentionKeysOfComment({ artifact: COMMENT })).toEqual(["ada", "grace"]);
  });

  it("rewrites both regions into Linear's markup", () => {
    const body = renderCommentBody({
      artifact: rewriteCommentMentions({ artifact: COMMENT, resolution: resolution() }),
    });

    expect(body).toContain(`@[ada](${ID_ADA}) this is idle.`);
    expect(body).toContain(`detail for @[grace](${ID_GRACE})`);
  });
});
