import { describe, expect, it } from "vitest";
import { preparedPlanLines } from "../../../cli/commands/codex/fallbackPlanRun.js";
import { CodexErrors, codexErrorLines } from "../../../codex/errors.js";
import {
  type ClaudeFallbackPlanReceipt,
  type ClaudeFallbackPlanRequest,
  fallbackLedgerEntries,
  fallbackPlanEntries,
  parseFallbackPlanReceipt,
  parseFallbackPlanRequest,
  planReceiptBindingFailure,
  validateFallbackPlan,
} from "../../../codex/fallbackPlan.js";
import { isFallbackPlanDocument } from "../../../codex/fallbackPlanGround.js";
import { type ClaudeFallbackReviewReceipt, validateFallbackReview } from "../../../codex/fallbackReview.js";
import { type TreeFingerprint, treeFingerprint } from "../../../codex/fingerprint.js";
import { ledgerForBranch, loopFailures } from "../../../codex/ledger.js";
import type { CodexPassTree } from "../../../codex/types.js";
import { unwrap } from "../../../lib/result.js";

const REPO = "/w/repo";
const BRANCH = "feature";
const PLAN_HEAD = "06e12d9aa1b2c3d4e5f60718293a4b5c6d7e8f90";
const WORK_HEAD = "2148718aa1b2c3d4e5f60718293a4b5c6d7e8f90";

function fingerprintOn({ headSha }: { headSha: string }): TreeFingerprint {
  return treeFingerprint({ dirtyPatch: "", headSha, treeSha: `${headSha.slice(2)}ab` });
}

function treeOn({ headSha, branch = BRANCH }: { headSha: string; branch?: string | null }): CodexPassTree {
  const fp = fingerprintOn({ headSha });
  return { branch, dirtyBytes: fp.dirtyBytes, fingerprint: fp.digest, headSha, treeSha: fp.treeSha };
}

/** The tree the plan was prepared over, and the tree once the work has landed on top of it. */
const PLAN_NOW = fingerprintOn({ headSha: PLAN_HEAD });
const WORK_NOW = fingerprintOn({ headSha: WORK_HEAD });

const CAP = {
  blockedBy: "Codex reported workspace_member_usage_limit_reached at 2026-09-15T08:22:23.654Z",
  limitId: null,
  observedAtIso: "2026-09-15T08:22:23.654Z",
  reachedType: "workspace_member_usage_limit_reached",
};

function planRequest(
  over: Partial<Extract<ClaudeFallbackPlanRequest, { mode: "plan" }>> = {},
): ClaudeFallbackPlanRequest {
  return {
    capEvidence: CAP,
    createdAtIso: "2026-09-15T16:00:00.000Z",
    mode: "plan",
    pass: "p2",
    promptBytes: 900,
    promptSha256: "a".repeat(64),
    repoRoot: REPO,
    requestId: "plan-req-1",
    schemaVersion: 1,
    taskSha256: "b".repeat(64),
    tree: treeOn({ headSha: PLAN_HEAD }),
    ...over,
  };
}

const READY = JSON.stringify({
  blockers: [],
  bodyMarkdown: "## Plan\n1. build the verb",
  summary: "ready",
  verdict: "READY",
});

const PLANNER = { host: "claude-code", model: "opus", workspace: "workspace:159" } as const;

function planReceiptFor({
  req = planRequest(),
  answer = READY,
}: {
  req?: ClaudeFallbackPlanRequest;
  answer?: string;
} = {}): ClaudeFallbackPlanReceipt {
  return unwrap(
    validateFallbackPlan({
      answer,
      completedAtIso: "2026-09-15T16:05:00.000Z",
      now: PLAN_NOW,
      planner: PLANNER,
      receiptId: "plan-rcpt-1",
      request: req,
      requestBytes: JSON.stringify(req),
    }),
  );
}

/** A CLEAN Claude review receipt over the tree the WORK is at — so only the plan half is in question. */
function currentReviewReceipt(): ClaudeFallbackReviewReceipt {
  const request = {
    baseRef: "origin/main",
    baseSha: PLAN_HEAD,
    capEvidence: CAP,
    createdAtIso: "2026-09-15T17:00:00.000Z",
    diffBytes: 10,
    diffSha256: "d".repeat(64),
    headSha: WORK_HEAD,
    pass: "r1",
    property: { id: "r1-01", statement: "a plan recorded after the work satisfies nothing" },
    repoRoot: REPO,
    requestId: "rev-req-1",
    schemaVersion: 1,
    tree: treeOn({ headSha: WORK_HEAD }),
  } as const;
  return unwrap(
    validateFallbackReview({
      answer: JSON.stringify({
        counterexample: "",
        evidence: "e",
        propertyId: "r1-01",
        summary: "s",
        verdict: "CLEAN",
      }),
      completedAtIso: "2026-09-15T17:05:00.000Z",
      now: WORK_NOW,
      receiptId: "rev-rcpt-1",
      request,
      requestBytes: JSON.stringify(request),
      reviewer: PLANNER,
    }),
  );
}

function floorAt({
  now,
  planReceipts,
}: {
  now: TreeFingerprint;
  planReceipts: readonly ClaudeFallbackPlanReceipt[];
}): readonly string[] {
  const entries = ledgerForBranch({
    branch: BRANCH,
    fallbackEntries: fallbackLedgerEntries({
      branch: BRANCH,
      now,
      repoRoot: REPO,
      scan: { planReceipts, receipts: [currentReviewReceipt()] },
    }),
    now,
    records: [],
    repoRoot: REPO,
  }).entries;
  return loopFailures({ entries });
}

describe("validateFallbackPlan", () => {
  it("binds a READY answer to its request by id and by digest of the request bytes", () => {
    const receipt = planReceiptFor();
    expect(receipt.requestId).toBe("plan-req-1");
    expect(receipt.answer.verdict).toBe("READY");
    expect(receipt.planner.workspace).toBe("workspace:159");
  });

  it("REFUSES once HEAD has moved — a plan recorded after the work proves nothing about order", () => {
    const result = validateFallbackPlan({
      answer: READY,
      completedAtIso: "2026-09-15T16:05:00.000Z",
      now: WORK_NOW,
      planner: PLANNER,
      receiptId: "plan-rcpt-1",
      request: planRequest(),
      requestBytes: "{}",
    });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()[0]).toContain(
      `the request was prepared at HEAD ${PLAN_HEAD} and the checkout is now at ${WORK_HEAD}; a plan is recorded BEFORE the work`,
    );
  });

  it("REFUSES a BLOCKED answer that names no blocker, exactly as a Codex plan would be", () => {
    const result = validateFallbackPlan({
      answer: JSON.stringify({ blockers: [], bodyMarkdown: "b", summary: "s", verdict: "BLOCKED" }),
      completedAtIso: "2026-09-15T16:05:00.000Z",
      now: PLAN_NOW,
      planner: PLANNER,
      receiptId: "plan-rcpt-1",
      request: planRequest(),
      requestBytes: "{}",
    });
    expect(result._unsafeUnwrapErr()).toEqual(["verdict BLOCKED requires at least one entry in blockers"]);
  });
});

describe("the plan floor with a Claude fallback plan", () => {
  it("a READY fallback plan the work has since moved past (STALE) clears the plan half", () => {
    expect(floorAt({ now: WORK_NOW, planReceipts: [planReceiptFor()] })).toEqual([]);
  });

  it("a READY fallback plan still CURRENT at landing satisfies nothing — it read the tree being landed", () => {
    const failures = floorAt({ now: PLAN_NOW, planReceipts: [planReceiptFor()] });
    expect(failures[0]).toContain("1 planning pass(es) reached a verdict but none is both STALE and READY");
  });

  it("a BLOCKED fallback plan blocks the landing exactly as a Codex BLOCKED does", () => {
    const blocked = planReceiptFor({
      answer: JSON.stringify({
        blockers: ["the store has no plan kind"],
        bodyMarkdown: "b",
        summary: "s",
        verdict: "BLOCKED",
      }),
    });
    expect(floorAt({ now: WORK_NOW, planReceipts: [blocked] })).toEqual([
      "p2 is the latest planning pass and is BLOCKED — resolve its blockers, then run a later plan",
    ]);
  });

  it("a fallback plan for another branch is not a row here", () => {
    const other = planReceiptFor({ req: planRequest({ tree: treeOn({ branch: "elsewhere", headSha: PLAN_HEAD }) }) });
    expect(fallbackPlanEntries({ branch: BRANCH, now: WORK_NOW, receipts: [other], repoRoot: REPO })).toEqual([]);
  });

  it("folds as a plan row marked claude-code", () => {
    const [row] = fallbackPlanEntries({ branch: BRANCH, now: WORK_NOW, receipts: [planReceiptFor()], repoRoot: REPO });
    expect(row!.mode).toBe("plan");
    expect(row!.provider).toBe("claude-code");
    expect(row!.freshness.kind).toBe("stale");
    expect(row!.outcomeContext).toBe(
      `Claude fallback plan in workspace:159 — Codex could not take the pass: ${CAP.blockedBy}`,
    );
  });
});

describe("parsing and binding", () => {
  it("round-trips a plan request and a plan receipt through JSON", () => {
    const receipt = planReceiptFor();
    expect(unwrap(parseFallbackPlanRequest({ value: JSON.parse(JSON.stringify(receipt.request)) }))).toEqual(
      receipt.request,
    );
    expect(unwrap(parseFallbackPlanReceipt({ value: JSON.parse(JSON.stringify(receipt)) }))).toEqual(receipt);
  });

  it("refuses a request with a review pass and names the field", () => {
    const refused = parseFallbackPlanRequest({ value: { ...planRequest(), pass: "r1" } })._unsafeUnwrapErr();
    expect(refused).toEqual(CodexErrors.documentInvalid({ reasons: ["pass must be p1, p2 or p3"] }));
    expect(codexErrorLines({ error: refused })).toEqual(["pass must be p1, p2 or p3"]);
  });

  it("tells a plan document from a review document by mode alone", () => {
    expect(isFallbackPlanDocument({ value: planRequest() })).toBe(true);
    expect(isFallbackPlanDocument({ value: { ...planRequest(), mode: undefined } })).toBe(false);
  });

  it("fails a receipt whose request was edited after recording", () => {
    const receipt = planReceiptFor();
    expect(planReceiptBindingFailure({ receipt, requestBytes: JSON.stringify(planRequest({ pass: "p3" })) })).toBe(
      "plan receipt plan-rcpt-1 binds to request bytes that no longer match plan-req-1",
    );
  });

  it("round-trips a request's origin binding and drops a malformed one", () => {
    const bound = planRequest({ originRepository: "acme/widget" });
    expect([
      unwrap(parseFallbackPlanRequest({ value: JSON.parse(JSON.stringify(bound)) })).originRepository,
      unwrap(parseFallbackPlanRequest({ value: { ...bound, originRepository: "acme/.." } })).originRepository,
    ]).toEqual(["acme/widget", undefined]);
  });

  it("refuses a receipt whose answer would not have passed the plan validator", () => {
    const receipt = planReceiptFor();
    const result = parseFallbackPlanReceipt({
      value: { ...receipt, answer: { ...receipt.answer, bodyMarkdown: " " } },
    });
    expect(codexErrorLines({ error: result._unsafeUnwrapErr() })).toEqual([
      "answer: bodyMarkdown must not be empty — it is the artifact a human reads",
    ]);
  });
});

describe("preparedPlanLines", () => {
  it("tells the session to record BEFORE editing, and where to write the answer", () => {
    expect(
      preparedPlanLines({ packetPath: "/h/codex-fallback/plan-req-1/plan-packet.md", request: planRequest() }),
    ).toEqual([
      "prepared fallback plan plan-req-1 (p2)",
      "  packet: /h/codex-fallback/plan-req-1/plan-packet.md",
      "  tree: HEAD 06e12d9aa1b2 on feature",
      `  Codex could not take the pass: ${CAP.blockedBy}`,
      "  Read the packet in THIS visible session and answer it as plan-output JSON (verdict READY|BLOCKED, summary,",
      "  bodyMarkdown, blockers), written OUTSIDE the checkout. Record it BEFORE you edit anything — record refuses",
      "  once the tree has moved, because a plan recorded after the work proves nothing about order:",
      "  slopweaver codex plan-fallback record --request plan-req-1 --answer-file <path>",
    ]);
  });
});
