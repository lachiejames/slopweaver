/*
 * The review floor with a Claude fallback receipt in the ledger: a cap alone satisfies nothing, a CURRENT CLEAN
 * receipt beside a STALE READY plan clears it, a BROKEN on either side vetoes, a receipt never stands in for the plan
 * half, and the ledger row names which brain read the diff.
 */
import { describe, expect, it } from "vitest";

import { fallbackReviewEntries } from "../../../../codex/fallbackReview.js";
import { type LedgerEntry, ledgerForBranch } from "../../../../codex/ledger.js";
import { renderLedger } from "../../../../codex/ledgerRender.js";
import type { CodexArtifactRecord, CodexPassTree, ReviewPassId } from "../../../../codex/types.js";
import {
  BRANCH,
  CLEAN_NOW,
  CLEAN_TREE,
  fingerprintOn,
  floor,
  HEAD,
  OTHER_HEAD,
  planRecord,
  REPO,
  receiptFor,
  request,
  STALE_PLAN,
  treeOn,
} from "./harness.js";

function codexReview({
  pass,
  tree,
  verdict,
  propertyId,
  createdAtIso = "2026-09-14T00:30:00.000Z",
}: {
  pass: ReviewPassId;
  tree: CodexPassTree;
  verdict: "CLEAN" | "BROKEN";
  propertyId: string;
  createdAtIso?: string;
}): CodexArtifactRecord {
  return {
    ...planRecord({ pass: "p1", tree }),
    artifactId: `codex-${pass}-${propertyId}`,
    createdAtIso,
    outcome: {
      answer: { counterexample: verdict === "BROKEN" ? "x" : "", evidence: "e", propertyId, summary: "s", verdict },
      kind: "answered",
      rawFinalResponse: "{}",
    },
    scope: {
      baseRef: "origin/main",
      baseSha: OTHER_HEAD,
      diffBytes: 1,
      // The receipt's own digest (`./harness.ts`): both brains read ONE diff, so this is one review pass.
      diffSha256: "d".repeat(64),
      headSha: HEAD,
      mode: "review",
      pass,
      property: { id: propertyId, statement: "s" },
    },
  };
}

/** A Codex review that FAILED on the spend cap — the shape the capped account writes. */
function cappedCodexReview({ tree }: { tree: CodexPassTree }): CodexArtifactRecord {
  return {
    ...codexReview({ pass: "r3", propertyId: "r3-01", tree, verdict: "CLEAN" }),
    artifactId: "codex-r3-capped",
    createdAtIso: "2026-09-14T00:45:00.000Z",
    outcome: {
      cause: { quota: "credits-out", reported: "You hit your spend cap", thrown: "exited 1" },
      error: { kind: "transport", message: "spend cap", operation: "codex.run" },
      kind: "fatal",
      salvage: null,
    },
  };
}

/** The clause the plan-half refusal appends while Codex is capped — an owner ruling, `cappedPlanNextStep`. */
const PLAN_HALF_CAPPED_ROUTE =
  ". Codex is CAPPED, and nothing waits on it (the owner's ruling): BEFORE the work, a " +
  "visible Claude session takes the plan — `slopweaver codex plan-fallback prepare`, answer the packet, then " +
  "`codex plan-fallback record` before any edit; work that already began without one rides " +
  '`--acknowledge codex-loop-incomplete --reason "…"` on the landing verb, the reason citing ' +
  "$SLOPWEAVER_HOME/supervisor-scratch/handoff-9257/owner-turn-253-2.txt and written to the door ledger";

describe("the review floor with a Claude fallback receipt", () => {
  it("a cap alone satisfies nothing, and the refusal names the fallback verbs as the way through", () => {
    const failures = floor({ records: [STALE_PLAN, cappedCodexReview({ tree: CLEAN_TREE })], receipts: [] });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("1 review pass(es) ran but none is both current and conclusive");
    expect(failures[0]).toContain(
      "Codex is CAPPED, so a visible Claude session takes this review (rule 9): `slopweaver codex review-fallback prepare`",
    );
  });

  it("a CURRENT Claude CLEAN receipt plus a STALE READY plan clears the floor", () => {
    const failures = floor({
      records: [STALE_PLAN, cappedCodexReview({ tree: CLEAN_TREE })],
      receipts: [receiptFor()],
    });
    expect(failures).toEqual([]);
  });

  it("a receipt over a tree that has since moved satisfies nothing", () => {
    const moved = fingerprintOn({ headSha: OTHER_HEAD, patch: "" });
    const failures = floor({
      now: moved,
      records: [planRecord({ pass: "p2", tree: CLEAN_TREE })],
      receipts: [receiptFor()],
    });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("none is both current and conclusive");
  });

  it("a Claude BROKEN receipt over a tree that has since moved is named, like a Codex row, when none is current", () => {
    const broken = JSON.stringify({
      counterexample: "x",
      evidence: "e",
      propertyId: "r2-01",
      summary: "s",
      verdict: "BROKEN",
    });
    const failures = floor({
      now: fingerprintOn({ headSha: OTHER_HEAD, patch: "" }),
      records: [planRecord({ pass: "p2", tree: CLEAN_TREE })],
      receipts: [receiptFor({ answer: broken })],
    });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(
      / — BROKEN with no later CLEAN under the same property: r2\/r2-01 \(rcpt-1\) is STALE$/,
    );
  });

  it("a receipt for ANOTHER checkout is not a row here", () => {
    const failures = floor({
      records: [STALE_PLAN],
      receipts: [receiptFor({ req: request({ repoRoot: "/w/other" }) })],
    });
    expect(failures).toEqual([
      "no general review pass has run on this branch — the diff has never been read by the second brain",
    ]);
  });

  it("a receipt for ANOTHER branch is not a row here", () => {
    const req = request({ tree: treeOn({ branch: "elsewhere", headSha: HEAD, patch: "" }) });
    const failures = floor({ records: [STALE_PLAN], receipts: [receiptFor({ req })] });
    expect(failures).toEqual([
      "no general review pass has run on this branch — the diff has never been read by the second brain",
    ]);
  });

  it("a CURRENT Codex BROKEN still vetoes beside a CURRENT Claude CLEAN", () => {
    const failures = floor({
      records: [STALE_PLAN, codexReview({ pass: "r1", propertyId: "r1-01", tree: CLEAN_TREE, verdict: "BROKEN" })],
      receipts: [receiptFor()],
    });
    expect(failures).toEqual([
      "r1 is CURRENT and BROKEN (r1-01) — fix it, then take the second and last review pass over the fixed diff",
    ]);
  });

  it("a CURRENT Claude BROKEN vetoes beside a CURRENT Codex CLEAN — the veto runs both ways", () => {
    const broken = JSON.stringify({
      counterexample: "this input",
      evidence: "e",
      propertyId: "r2-01",
      summary: "s",
      verdict: "BROKEN",
    });
    const failures = floor({
      records: [STALE_PLAN, codexReview({ pass: "r1", propertyId: "r1-01", tree: CLEAN_TREE, verdict: "CLEAN" })],
      receipts: [receiptFor({ answer: broken })],
    });
    expect(failures).toEqual([
      "r2 is CURRENT and BROKEN (r2-01) — fix it, then take the second and last review pass over the fixed diff",
    ]);
  });

  it("a receipt never satisfies the PLAN half, and the refusal names the acknowledgement the plan half rides while capped", () => {
    const failures = floor({ records: [], receipts: [receiptFor()] });
    expect(failures).toEqual([
      "no planning pass has run on this branch — nothing planned the work before it was written" +
        PLAN_HALF_CAPPED_ROUTE,
    ]);
  });

  it("a capped review attempt as the newest row also witnesses the cap for the plan half", () => {
    const failures = floor({ records: [cappedCodexReview({ tree: CLEAN_TREE })], receipts: [] });
    expect(failures).toHaveLength(2);
    expect(failures[0]).toBe(
      "no planning pass has run on this branch — nothing planned the work before it was written" +
        PLAN_HALF_CAPPED_ROUTE,
    );
  });

  it("a plan that concluded nothing still names the route when the newest row is capped", () => {
    const noVerdict: CodexArtifactRecord = {
      ...planRecord({ pass: "p2", tree: CLEAN_TREE, createdAtIso: "2026-09-13T00:00:00.000Z" }),
      outcome: { kind: "no-verdict", rawFinalResponse: null, reason: "invalid-output", salvage: null },
    };
    const failures = floor({ records: [noVerdict, cappedCodexReview({ tree: CLEAN_TREE })], receipts: [] });
    expect(failures[0]).toContain(
      "1 planning pass(es) ran but none reached a verdict — each produced NO_VERDICT or failed outright, so " +
        "nothing was established — the newest, p2, concluded nothing:",
    );
    expect(failures[0]!.endsWith(PLAN_HALF_CAPPED_ROUTE)).toBe(true);
  });

  it("a plan that is CURRENT rather than STALE names the route when the newest row is capped", () => {
    const failures = floor({
      records: [planRecord({ pass: "p2", tree: CLEAN_TREE }), cappedCodexReview({ tree: CLEAN_TREE })],
      receipts: [],
    });
    expect(failures[0]).toBe(
      "1 planning pass(es) reached a verdict but none is both STALE and READY — a CURRENT plan read the tree " +
        "being landed, so it cannot show the work came after it, and UNKNOWN provenance cannot show anything" +
        PLAN_HALF_CAPPED_ROUTE,
    );
  });

  it("a BLOCKED plan is never ridden past on a cap — the refusal carries no route", () => {
    const blocked: CodexArtifactRecord = {
      ...planRecord({ pass: "p2", tree: CLEAN_TREE }),
      outcome: {
        answer: { blockers: ["b"], bodyMarkdown: "", summary: "", verdict: "BLOCKED" },
        kind: "answered",
        rawFinalResponse: "{}",
      },
    };
    const failures = floor({ records: [blocked, cappedCodexReview({ tree: CLEAN_TREE })], receipts: [] });
    expect(failures[0]).toBe(
      "p2 is the latest planning pass and is BLOCKED — resolve its blockers, then run a later plan",
    );
  });

  it("with no cap witnessed, the plan-half refusal carries no route", () => {
    const failures = floor({
      records: [codexReview({ pass: "r1", propertyId: "r1-01", tree: CLEAN_TREE, verdict: "CLEAN" })],
      receipts: [],
    });
    expect(failures).toEqual([
      "no planning pass has run on this branch — nothing planned the work before it was written",
    ]);
  });

  it("renders the provider on the row so a reader sees which brain read the diff", () => {
    const ledger = ledgerForBranch({
      branch: BRANCH,
      fallbackEntries: fallbackReviewEntries({
        branch: BRANCH,
        now: CLEAN_NOW,
        receipts: [receiptFor()],
        repoRoot: REPO,
      }),
      now: CLEAN_NOW,
      records: [],
      repoRoot: REPO,
    });
    const lines = renderLedger({
      branch: BRANCH,
      entries: ledger.entries,
      headSha: HEAD,
      withoutSidecar: 0,
      unattributed: 0,
      unplaceable: [],
      unreadable: 0,
    });
    const row = lines.find((line) => line.includes("r2-01"))!;
    expect(row).toBe(
      "  r2  CURRENT   CLEAN  r2-01  [claude-code] — Claude fallback review in workspace:7 — Codex could not take the pass: " +
        "Codex reported workspace_member_usage_limit_reached at 2026-09-13T14:49:01.803Z",
    );
  });

  it("orders a receipt among Codex rows by its completion instant, newest first", () => {
    const entries: readonly LedgerEntry[] = ledgerForBranch({
      branch: BRANCH,
      fallbackEntries: fallbackReviewEntries({
        branch: BRANCH,
        now: CLEAN_NOW,
        receipts: [receiptFor()],
        repoRoot: REPO,
      }),
      now: CLEAN_NOW,
      records: [
        codexReview({
          createdAtIso: "2026-09-14T02:00:00.000Z",
          pass: "r1",
          propertyId: "r1-01",
          tree: CLEAN_TREE,
          verdict: "CLEAN",
        }),
      ],
      repoRoot: REPO,
    }).entries;
    expect(entries.map((entry) => entry.artifactId)).toEqual(["codex-r1-r1-01", "rcpt-1"]);
    expect(entries[1]!.provider).toBe("claude-code");
    expect(entries[1]!.capped).toBe(false);
  });
});
