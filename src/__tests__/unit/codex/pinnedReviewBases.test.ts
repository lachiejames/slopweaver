/*
 * Which witness reviews were taken against a base that cannot move (`pinnedReviewBases`,
 * `src/codex/baselineBumpWitnessRun.ts`). A review's freshness is recomputed from its base REF, so one taken
 * against `HEAD` reviews an empty diff and recomputes an empty diff at every later commit:
 * only a full SHA the pull request's base commit already holds counts. Real git, one repository for every case.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { pinnedReviewBases } from "../../../codex/baselineBumpWitnessRun.js";
import type { CodexArtifactRecord, CodexPassScope } from "../../../codex/types.js";
import { type BumpManifest, type BumpRow, digestOf, witnessPropertyId } from "../../../devLint/baselineBump.js";
import { gitInTemp, REAL_GIT_TIMEOUT_MS } from "../../tempGitRepo.js";

const ROWS: readonly BumpRow[] = [
  { cause: "growth", entry: "offenders:src/a.ts", file: ".baselines/file-size-baseline.json", from: 300, to: 310 },
];
const MANIFEST: BumpManifest = {
  base: "a".repeat(40),
  digest: digestOf({ base: "a".repeat(40), rows: ROWS }),
  loosenings: ROWS,
  reason: "a register grew",
};
const WITNESS_ID = witnessPropertyId({ digest: MANIFEST.digest });

/** A review record against one base ref, under one property id. */
function review({ baseRef, propertyId = WITNESS_ID }: { baseRef: string; propertyId?: string }): CodexArtifactRecord {
  return recordWith({
    scope: {
      baseRef,
      baseSha: baseRef,
      diffBytes: 0,
      diffSha256: "a".repeat(64),
      headSha: "c".repeat(40),
      mode: "review",
      pass: "r3",
      property: { id: propertyId, statement: "s" },
    },
  });
}

/** A pass record carrying one scope; every other field is inert to the read under test. */
function recordWith({ scope }: { scope: CodexPassScope }): CodexArtifactRecord {
  return {
    artifactId: "a-1",
    attempts: [],
    bound: { conclusionWindowMs: 150, totalMs: 1000, warnAfterMs: 850 },
    createdAtIso: "2026-11-02T01:00:00.000Z",
    observedElapsedMs: 10,
    outcome: {
      answer: { counterexample: "", evidence: "read", propertyId: WITNESS_ID, summary: "", verdict: "CLEAN" },
      kind: "answered",
      rawFinalResponse: "{}",
    },
    repoRoot: "/w/repo",
    requestedApprovalPolicy: "never",
    requestedModel: "m",
    requestedNetworkAccess: true,
    requestedReasoningEffort: "xhigh",
    requestedSandboxMode: "workspace-write",
    requestedWebSearch: true,
    requestedWritableRoots: [],
    schemaVersion: 1,
    scope,
    tree: {
      branch: "feature",
      dirtyBytes: 0,
      fingerprint: "d".repeat(64),
      headSha: "c".repeat(40),
      treeSha: "e".repeat(40),
    },
  };
}

let root = "";
let older = "";
let base = "";
let feature = "";

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "pinned-bases-"));
  const git = (...args: readonly string[]): string => gitInTemp({ args, cwd: root });
  git("init", "--initial-branch=main", ".");
  git("config", "user.email", "fixture@example.invalid");
  git("config", "user.name", "Fixture");
  writeFileSync(join(root, "a.txt"), "one\n");
  git("add", ".");
  git("commit", "-q", "-m", "older main");
  older = git("rev-parse", "HEAD");
  writeFileSync(join(root, "a.txt"), "two\n");
  git("commit", "-q", "-am", "main at the landing");
  base = git("rev-parse", "HEAD");
  git("checkout", "-q", "-b", "feature");
  writeFileSync(join(root, "a.txt"), "three\n");
  git("commit", "-q", "-am", "the author's own commit");
  feature = git("rev-parse", "HEAD");
}, REAL_GIT_TIMEOUT_MS);

afterAll(() => {
  rmSync(root, { force: true, recursive: true });
});

describe("pinnedReviewBases", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it("pins a full SHA the base commit holds, itself or an ancestor, and nothing that can move or main lacks", () => {
    const records = [
      review({ baseRef: older }),
      review({ baseRef: base }),
      review({ baseRef: "HEAD" }),
      review({ baseRef: "feature" }),
      review({ baseRef: feature }),
      review({ baseRef: older.slice(0, 12) }),
    ];
    expect([
      ...pinnedReviewBases({ baseSha: base, manifests: [{ manifest: MANIFEST, path: "p" }], records, root }),
    ]).toEqual([older, base]);
  });

  it("asks nothing of a plan, or of a review under another property id", () => {
    const records = [
      recordWith({ scope: { mode: "plan", pass: "p1", promptBytes: 1, promptSha256: "b".repeat(64) } }),
      review({ baseRef: older, propertyId: "r1-something-else" }),
    ];
    expect([
      ...pinnedReviewBases({ baseSha: base, manifests: [{ manifest: MANIFEST, path: "p" }], records, root }),
    ]).toEqual([]);
  });
});
