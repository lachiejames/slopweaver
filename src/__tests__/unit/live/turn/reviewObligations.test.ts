/**
 * `firstDraftReviewLines` — the checklist a worker runs on its own draft before review round 1 — and the
 * property the module exists for: the worker and the reviewer's packet render the SAME standing claims, from
 * the same constants, so the two can never be told different things.
 */
import { describe, expect, it } from "vitest";

import { DELIVERABLE_STANDING_CLAIM, REQUESTED_DELIVERABLES } from "../../../../admit/requestedDeliverables.js";
import { firstDraftReviewLines, THREAD_STANDING_CLAIM } from "../../../../live/turn/reviewObligations.js";
import { STANDING_CLAIM_PHRASES } from "../../../../live/turn/reviewRounds.js";
import { packetVerdictSection } from "../../../../live/turn/reviewVerdictSection.js";

const NOT_DECIDABLE =
  "     No artifact class here is decidable from the question alone: re-read it and name what it asked for.";

describe("firstDraftReviewLines", () => {
  it("names the deliverable claim and the thread claim, word for word, as items 1 and 2", () => {
    const lines = firstDraftReviewLines({ question: "why did the staging pool exhaust" });
    expect(lines.filter((line) => line.startsWith("  1. "))).toEqual([`  1. \`${DELIVERABLE_STANDING_CLAIM}\``]);
    expect(lines.filter((line) => line.startsWith("  2. "))).toEqual([`  2. \`${THREAD_STANDING_CLAIM}\``]);
    expect(lines[0]).toBe(
      "BEFORE REVIEW ROUND 1 — your reviewer classifies these first, and every first round on record broke on one",
    );
  });

  it("lists the concrete artifact a deploy-and-screenshot ask requests, from the send door's own table", () => {
    const lines = firstDraftReviewLines({ question: "deploy the preview and send a screenshot" });
    expect(lines.filter((line) => line.startsWith("     This ask requests: "))).toEqual(
      REQUESTED_DELIVERABLES.map((deliverable) => `     This ask requests: ${deliverable.what}`),
    );
    expect(lines).not.toContain(NOT_DECIDABLE);
  });

  it("says no artifact class is decidable when the question names none, rather than listing nothing", () => {
    const lines = firstDraftReviewLines({ question: "what did we decide about the retention window" });
    expect(lines).toContain(NOT_DECIDABLE);
    expect(lines.some((line) => line.startsWith("     This ask requests: "))).toBe(false);
  });

  it("tells the worker the --read-through and --delta-cleared routes turn review takes", () => {
    const text = firstDraftReviewLines({ question: "" }).join("\n");
    expect(text).toContain("--read-through <the newest human ts you read>");
    expect(text).toContain("re-run with --delta-cleared");
  });
});

describe("the reviewer's packet renders the same standing claims", () => {
  it("carries both constants in its verdict section, so the worker's checklist cannot drift from it", () => {
    const packet = packetVerdictSection({
      answerDigest: "sha256:aaaa",
      authorSession: "author-1",
      images: [],
      reviewerSession: "reviewer-1",
      round: 1,
      supersedes: undefined,
      verdictPath: "/tmp/verdict.json",
      voiceRuleCount: 0,
    }).join("\n");
    expect(packet).toContain(`\`${DELIVERABLE_STANDING_CLAIM}\``);
    expect(packet).toContain(`\`${THREAD_STANDING_CLAIM}\``);
  });

  it("keeps each phrase the round carry matches on a substring of its canonical claim, so a reword drifts loudly", () => {
    expect(STANDING_CLAIM_PHRASES.length).toBe(2);
    expect(DELIVERABLE_STANDING_CLAIM).toContain(STANDING_CLAIM_PHRASES[0]!);
    expect(THREAD_STANDING_CLAIM).toContain(STANDING_CLAIM_PHRASES[1]!);
  });
});
