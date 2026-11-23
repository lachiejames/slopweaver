/**
 * The compose-time checks a worker's answer file passes before `turn resume` writes the READY marker. Every
 * refusal here is "not yet", never "not at all": it is decidable from the answer's own bytes, the decision and
 * the review on disk, so each case asserts the refusal AND that nothing durable was written.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  answerFreezeRefusal,
  refuseComposeTime,
  validatedAnswer,
} from "../../../../../cli/commands/turn/resumeAnswerChecks.js";
import { EXIT_ERROR } from "../../../../../cli/exitCodes.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { buildTurnRoutingBrief } from "../../../../../live/turn/brief.js";
import type { RoutingJudgementInput } from "../../../../../live/turn/judgement.js";
import type { ReviewRecord } from "../../../../../live/turn/review.js";
import { reviewPaths, writeReview } from "../../../../../live/turn/reviewStore.js";
import type { RespondDecision } from "../../../../../live/turn/tier.js";
import { readTurnJournal } from "../../../../../live/turn/turnJournalStore.js";

const ASK = { channel: "C1", messageTs: "1785000000.000100", threadTs: "1785000000.000100" };
const REVIEWED_DIGEST = `sha256:${"a".repeat(64)}`;
const REWRITTEN_DIGEST = `sha256:${"b".repeat(64)}`;
const LEASE = "2026-10-02T05:00:00.000Z";

const ROUTING_INPUT: RoutingJudgementInput = {
  availableCapabilities: [],
  context: {
    controlPlane: { ownerAddressingText: "what are my open PRs?", structuralMetadata: [] },
    quotedEvidence: [],
  },
  execution: { mode: "single-turn", supervisorHost: "claude-code" },
};

const DECISION: RespondDecision = {
  confidence: "high",
  needs: [],
  rationale: "context and judgement alone answer this",
  response: "respond",
  schemaVersion: 1,
  tier: "fresh-visible-session",
  truthMode: "none",
};

/** A schema-valid answer, grounded consistently with `DECISION` (no live needs, so conversation grounding fits). */
const VALID_ANSWER = {
  body: [{ runs: [{ text: "3 open PRs", type: "text" }], type: "paragraph" }],
  citations: [],
  grounding: {
    evidence: {
      consultedEmpty: [],
      couldNotSee: { blindSpots: [], reason: "nothing else was needed" },
      premiseChecks: [],
      read: [],
    },
    kind: "conversation",
    provenance: { model: "claude-sonnet-5", skillsLoaded: [], verbsLoaded: [] },
    reason: "context alone answers this",
  },
  images: [],
  kind: "answer",
  lead: "3 open PRs",
};

const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A fresh home, tracked for removal. */
function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-resume-checks-"));
  fixtureDirs.push(home);
  return home;
}

/** A home holding a brief for the ask, and the path it sits at. */
function homeWithBrief(): { readonly briefPath: string; readonly home: string } {
  const home = freshHome();
  const briefPath = join(home, "brief.json");
  writeFileSync(
    briefPath,
    JSON.stringify(
      buildTurnRoutingBrief({
        ...ASK,
        question: "what are my open PRs?",
        routingInput: ROUTING_INPUT,
        surface: "channel",
        unavailableCapabilities: [],
        userId: "U0OWNER",
      }),
    ),
    "utf8",
  );
  return { briefPath, home };
}

/** Write `body` as the worker's answer file under `home`, returning its path. */
function writeAnswer({ body, home }: { body: string; home: string }): string {
  const answerPath = join(home, "answer.json");
  writeFileSync(answerPath, body, "utf8");
  return answerPath;
}

/** Open a review round over {@link REVIEWED_DIGEST} with no verdict written yet. */
function openReview({ home }: { home: string }): ReviewRecord {
  const paths = reviewPaths({ askIdentity: ASK, home });
  const record: ReviewRecord = {
    ...ASK,
    answerDigest: REVIEWED_DIGEST,
    answerPath: join(home, "answer.json"),
    authorSession: "author workspace workspace:1 (id-workspace:1)",
    carriedUnresolved: [],
    packetPath: paths.packet,
    reviewer: {
      host: "claude-code",
      surfaceId: "id-surface:9",
      surfaceRef: "surface:9",
      workspaceId: "id-workspace:9",
      workspaceRef: "workspace:9",
    },
    reviewerSession: "reviewer workspace workspace:9 (id-workspace:9)",
    round: 2,
    schemaVersion: 2,
    spawnedAt: "2026-10-02T00:40:00.000Z",
    verdictPath: paths.verdict,
  };
  writeReview({ home, packet: "packet", record });
  return record;
}

describe("refuseComposeTime", () => {
  it("exits with the failure code and says the SAME command can be re-run — this is not terminal", () => {
    const code = refuseComposeTime({
      answerPath: "/h/answer.json",
      dispatchId: "C1-1785000000.000100",
      home: "/h",
      reason: "the lead is over its cap",
    });

    expect(code).toBe(EXIT_ERROR);
  });
});

describe("answerFreezeRefusal", () => {
  it("lets the author through when no review was ever opened, and journals nothing", () => {
    const home = freshHome();

    const refusal = answerFreezeRefusal({
      answerDigest: REWRITTEN_DIGEST,
      askIdentity: ASK,
      editReason: undefined,
      home,
      leaseExpiresAt: LEASE,
      postedDigest: undefined,
    });

    expect(refusal).toBeUndefined();
    expect(readTurnJournal({ askIdentity: ASK, home })).toEqual([]);
  });

  it("refuses an edit while a round is still reading the bytes, naming the round, the cost and the flag", () => {
    const home = freshHome();
    openReview({ home });

    const refusal = answerFreezeRefusal({
      answerDigest: REWRITTEN_DIGEST,
      askIdentity: ASK,
      editReason: undefined,
      home,
      leaseExpiresAt: LEASE,
      postedDigest: undefined,
    })!;

    expect(refusal[0]).toContain("round 2 is still reading the bytes you are about to replace");
    expect(refusal.at(-1)).toBe('if the edit is worth that, say why: --edit-reason "<why these bytes had to change>"');
    expect(readTurnJournal({ askIdentity: ASK, home })).toEqual([]);
  });

  it("treats a whitespace-only reason as no reason", () => {
    const home = freshHome();
    openReview({ home });

    const refusal = answerFreezeRefusal({
      answerDigest: REWRITTEN_DIGEST,
      askIdentity: ASK,
      editReason: "   ",
      home,
      leaseExpiresAt: LEASE,
      postedDigest: undefined,
    });

    expect(refusal![0]).toContain("round 2 is still reading");
  });

  it("lets a stated reason through and JOURNALS it, trimmed, with both digests", () => {
    const home = freshHome();
    openReview({ home });

    const refusal = answerFreezeRefusal({
      answerDigest: REWRITTEN_DIGEST,
      askIdentity: ASK,
      editReason: "  the table named the wrong repo  ",
      home,
      leaseExpiresAt: LEASE,
      postedDigest: undefined,
    });

    const rows = readTurnJournal({ askIdentity: ASK, home });
    expect(refusal).toBeUndefined();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      discardedSendableVerdict: false,
      fromDigest: REVIEWED_DIGEST,
      kind: "answer-edited",
      reason: "the table named the wrong repo",
      toDigest: REWRITTEN_DIGEST,
    });
  });

  it("lets the final answer through, with no reason, once the reviewed bytes were already POSTED as the first answer", () => {
    const home = freshHome();
    openReview({ home });

    const refusal = answerFreezeRefusal({
      answerDigest: REWRITTEN_DIGEST,
      askIdentity: ASK,
      editReason: undefined,
      home,
      leaseExpiresAt: LEASE,
      postedDigest: REVIEWED_DIGEST,
    });

    expect(refusal).toBeUndefined();
    expect(readTurnJournal({ askIdentity: ASK, home })).toEqual([]);
  });

  it("lets the very bytes under review through unchanged", () => {
    const home = freshHome();
    openReview({ home });

    const refusal = answerFreezeRefusal({
      answerDigest: REVIEWED_DIGEST,
      askIdentity: ASK,
      editReason: undefined,
      home,
      leaseExpiresAt: LEASE,
      postedDigest: undefined,
    });

    expect(refusal).toBeUndefined();
  });
});

describe("validatedAnswer", () => {
  it("returns the parsed answer and its exact bytes for a sound answer", () => {
    const { briefPath, home } = homeWithBrief();
    const body = JSON.stringify(VALID_ANSWER);
    const answerPath = writeAnswer({ body, home });

    const result = unwrap(validatedAnswer({ answerPath, decision: DECISION, home, path: briefPath }));

    expect(result.answerText).toBe(body);
    expect(result.answer.lead).toBe("3 open PRs");
  });

  it("refuses a brief that is not there, as an upstream refusal", () => {
    const home = freshHome();
    const answerPath = writeAnswer({ body: JSON.stringify(VALID_ANSWER), home });

    const error = unwrapErr(validatedAnswer({ answerPath, decision: DECISION, home, path: join(home, "gone.json") }));

    expect(error.code).toBe("UPSTREAM_REFUSED");
  });

  it("refuses an answer file that is not there", () => {
    const { briefPath, home } = homeWithBrief();

    const error = unwrapErr(
      validatedAnswer({ answerPath: join(home, "missing-answer.json"), decision: DECISION, home, path: briefPath }),
    );

    expect(error.code).toBe("FILE_UNREADABLE");
  });

  it("refuses an answer file that is not JSON, naming the document", () => {
    const { briefPath, home } = homeWithBrief();
    const answerPath = writeAnswer({ body: "{ not valid json", home });

    const error = unwrapErr(validatedAnswer({ answerPath, decision: DECISION, home, path: briefPath }));

    expect(error.code).toBe("DOCUMENT_NOT_JSON");
    expect(error.message).toContain("the answer is not JSON");
  });

  it("refuses an answer that fails the answer-arm schema", () => {
    const { briefPath, home } = homeWithBrief();
    const answerPath = writeAnswer({
      body: JSON.stringify({ body: [], citations: [], images: [], kind: "answer" }),
      home,
    });

    const error = unwrapErr(validatedAnswer({ answerPath, decision: DECISION, home, path: briefPath }));

    expect(error.code).toBe("UPSTREAM_REFUSED");
  });

  it("refuses an answer whose grounding contradicts the decision's required live need", () => {
    const { briefPath, home } = homeWithBrief();
    const answerPath = writeAnswer({ body: JSON.stringify(VALID_ANSWER), home });
    const requiresLive: RespondDecision = {
      ...DECISION,
      needs: [{ capabilityId: "fleet-status", reason: "must inspect live state", requirement: "required" }],
    };

    const error = unwrapErr(validatedAnswer({ answerPath, decision: requiresLive, home, path: briefPath }));

    expect(error.code).toBe("UPSTREAM_REFUSED");
  });
});
