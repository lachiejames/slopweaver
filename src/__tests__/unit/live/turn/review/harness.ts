/*
 * The pure fixtures the `review` and `reviewPoll` test files share: one composed answer, the respond decision
 * it was routed under, the reviewer session that holds it, and the review record binding them. Pure data;
 * nothing here touches a disk or a provider.
 */
import { unwrap } from "../../../../../lib/result.js";
import type { ReviewRecord } from "../../../../../live/turn/review.js";
import type { RespondDecision } from "../../../../../live/turn/tier.js";
import { parseAnswerArm } from "../../../../../outbound/assistant/answerForm.js";

/** One parsed answer about the staging pool, citing a single Slack message. */
export const ANSWER = unwrap(
  parseAnswerArm({
    context: { repos: [] },
    raw: {
      body: [{ runs: [{ text: "the pool exhausted at 14:02", type: "text" }], type: "paragraph" }],
      citations: [{ id: "1", label: "[1]", url: "https://example.slack.com/archives/C1/p1785000000000100" }],
      grounding: {
        evidence: {
          consultedEmpty: [],
          couldNotSee: { blindSpots: [], reason: "nothing else was needed" },
          premiseChecks: [],
          read: [{ label: "the incident thread" }],
        },
        kind: "conversation",
        provenance: { model: "claude-opus-5", skillsLoaded: [], verbsLoaded: [] },
        reason: "the thread says it",
      },
      images: [],
      index: [
        [
          { text: "pool exhausted", type: "text" },
          { citationId: "1", type: "citation" },
        ],
      ],
      kind: "answer",
      measurements: [],
      lead: "The staging pool exhausted at 14:02",
    },
  }),
);

/** A fresh-visible-session respond decision that needs one live fleet-status read. */
export const DECISION: RespondDecision = {
  confidence: "high",
  needs: [{ capabilityId: "fleet-status", reason: "to read the live pool", requirement: "required" }],
  rationale: "needs a live read",
  response: "respond",
  schemaVersion: 1,
  tier: "fresh-visible-session",
  truthMode: "current",
};

/** The reviewer's cmux session, workspace 9 on a Claude Code host. */
export const REVIEWER = {
  host: "claude-code" as const,
  surfaceId: "id-surface:9",
  surfaceRef: "surface:9",
  workspaceId: "id-workspace:9",
  workspaceRef: "workspace:9",
};

/** A round-1 review record for the ask in `C1`, spawned at a fixed midnight. */
export const RECORD: ReviewRecord = {
  answerDigest: "sha256:" + "a".repeat(64),
  answerPath: "/tmp/answer.json",
  authorSession: "author workspace workspace:1 (id-workspace:1)",
  carriedUnresolved: [],
  channel: "C1",
  messageTs: "1785000000.000100",
  packetPath: "/tmp/reviews/C1-1785000000.000100/packet.md",
  reviewer: REVIEWER,
  reviewerSession: "reviewer workspace workspace:9 (id-workspace:9)",
  round: 1,
  schemaVersion: 2,
  spawnedAt: "2026-08-25T00:00:00.000Z",
  threadTs: "1785000000.000100",
  verdictPath: "/tmp/reviews/C1-1785000000.000100/verdict.json",
};
