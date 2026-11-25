/*
 * The git evidence a stale ratchet-bump witness is judged against (`readBaselineBumpCarryEvidence`,
 * `src/codex/baselineBumpFloor.ts`): which review bases are pinned, the landing patch, and which pinned bases hold
 * each manifest's floor. A review's freshness is recomputed from its base REF, so one taken against `HEAD` reviews
 * an empty diff and recomputes an empty diff at every later commit: only a full SHA the landing base already holds
 * counts. Real git, one repository for every case.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { unwrap } from "#lib/result.js";
import { readBaselineBumpCarryEvidence } from "../../../codex/baselineBumpFloor.js";
import { commitDiffSha256 } from "../../../codex/diffsNow.js";
import type { CodexArtifactRecord, CodexPassScope } from "../../../codex/types.js";
import { type BumpManifest, type BumpRow, digestOf, witnessPropertyId } from "../../../devLint/baselineBump.js";
import { gitInTemp, REAL_GIT_TIMEOUT_MS } from "../../tempGitRepo.js";

/** A manifest declaring rows on the given baseline files. */
function manifestOn({ files }: { files: readonly string[] }): BumpManifest {
  const rows: readonly BumpRow[] = files.map((file, index) => ({
    cause: "growth",
    entry: `offenders:src/${String(index)}.ts`,
    file,
    from: 300,
    to: 310,
  }));
  return { base: "a".repeat(40), digest: digestOf({ base: "a".repeat(40), rows }), loosenings: rows, reason: "grew" };
}

/** Two rows on the same file, so the floor read names it once. */
const FLOOR = manifestOn({ files: ["floor.json", "floor.json"] });
const OTHER = manifestOn({ files: ["other.json"] });
const FLOOR_ID = witnessPropertyId({ digest: FLOOR.digest });
/** A real file whose name, read as a pathspec, excludes every path; it changes between `older` and `base`. */
const MAGIC_NAME = ":(exclude,glob)**";
const OTHER_ID = witnessPropertyId({ digest: OTHER.digest });

/** A review record against one base ref, under one property id. */
function review({ baseRef, propertyId = FLOOR_ID }: { baseRef: string; propertyId?: string }): CodexArtifactRecord {
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
      answer: { counterexample: "", evidence: "read", propertyId: FLOOR_ID, summary: "", verdict: "CLEAN" },
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
let movedFloor = "";
let feature = "";

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "bump-floor-"));
  const git = (...args: readonly string[]): string => gitInTemp({ args, cwd: root });
  git("init", "--initial-branch=main", ".");
  git("config", "user.email", "fixture@example.invalid");
  git("config", "user.name", "Fixture");
  writeFileSync(join(root, "a.txt"), "one\n");
  writeFileSync(join(root, "floor.json"), "{}\n");
  writeFileSync(join(root, "other.json"), "{}\n");
  writeFileSync(join(root, MAGIC_NAME), "{}\n");
  git("add", ".");
  git("commit", "-q", "-m", "older main");
  older = git("rev-parse", "HEAD");
  writeFileSync(join(root, "a.txt"), "two\n");
  writeFileSync(join(root, MAGIC_NAME), '{"moved":1}\n');
  git("commit", "-q", "-am", "main at the landing, an unrelated file and the magic-named file moved");
  base = git("rev-parse", "HEAD");
  writeFileSync(join(root, "floor.json"), '{"moved":1}\n');
  git("commit", "-q", "-am", "a later main that moved one baseline");
  movedFloor = git("rev-parse", "HEAD");
  git("checkout", "-q", "-b", "feature", base);
  writeFileSync(join(root, "a.txt"), "three\n");
  git("commit", "-q", "-am", "the author's own commit");
  feature = git("rev-parse", "HEAD");
}, REAL_GIT_TIMEOUT_MS);

afterAll(() => {
  rmSync(root, { force: true, recursive: true });
});

describe("readBaselineBumpCarryEvidence", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  const manifests = [{ manifest: FLOOR, path: "p" }];

  it("pins a full SHA the base commit holds, itself or an ancestor, and nothing that can move or main lacks", () => {
    const records = [
      review({ baseRef: older }),
      review({ baseRef: base }),
      review({ baseRef: "HEAD" }),
      review({ baseRef: "feature" }),
      review({ baseRef: feature }),
      review({ baseRef: older.slice(0, 12) }),
      review({ baseRef: "f".repeat(40) }),
    ];
    const evidence = readBaselineBumpCarryEvidence({ baseSha: base, headSha: feature, manifests, records, root });
    expect([...evidence.pinnedBases]).toEqual([older, base]);
    expect([...evidence.floorHeldBasesByDigest.entries()]).toEqual([[FLOOR.digest, new Set([older, base])]]);
  });

  it("reads a floor git fails to compare as not held, while the base stays pinned", () => {
    const unreadable = manifestOn({ files: ["../outside-the-repository.json"] });
    const evidence = readBaselineBumpCarryEvidence({
      baseSha: base,
      headSha: feature,
      manifests: [{ manifest: unreadable, path: "u" }],
      records: [review({ baseRef: older, propertyId: witnessPropertyId({ digest: unreadable.digest }) })],
      root,
    });
    expect([...evidence.pinnedBases]).toEqual([older]);
    expect([...evidence.floorHeldBasesByDigest.entries()]).toEqual([[unreadable.digest, new Set()]]);
  });

  it("compares a row file named like pathspec magic as that literal name, so its change is seen", () => {
    const magic = manifestOn({ files: [MAGIC_NAME] });
    const evidence = readBaselineBumpCarryEvidence({
      baseSha: base,
      headSha: feature,
      manifests: [{ manifest: magic, path: "m" }],
      records: [review({ baseRef: older, propertyId: witnessPropertyId({ digest: magic.digest }) })],
      root,
    });
    expect([...evidence.pinnedBases]).toEqual([older]);
    expect([...evidence.floorHeldBasesByDigest.entries()]).toEqual([[magic.digest, new Set()]]);
  });

  it("reads a changed floor as not held even when a trusted external diff helper says no difference", () => {
    const git = (...args: readonly string[]): string => gitInTemp({ args, cwd: root });
    git("config", "diff.external", "true");
    git("config", "diff.trustExitCode", "true");
    try {
      const records = [review({ baseRef: older })];
      const evidence = readBaselineBumpCarryEvidence({
        baseSha: movedFloor,
        headSha: feature,
        manifests,
        records,
        root,
      });
      expect([...evidence.floorHeldBasesByDigest.entries()]).toEqual([[FLOOR.digest, new Set()]]);
    } finally {
      git("config", "--unset", "diff.external");
      git("config", "--unset", "diff.trustExitCode");
    }
  });

  it("asks nothing of a plan, or of a review under another property id, and takes no landing patch", () => {
    const records = [
      recordWith({ scope: { mode: "plan", pass: "p1", promptBytes: 1, promptSha256: "b".repeat(64) } }),
      review({ baseRef: older, propertyId: "r1-something-else" }),
    ];
    const evidence = readBaselineBumpCarryEvidence({ baseSha: base, headSha: feature, manifests, records, root });
    expect([...evidence.pinnedBases]).toEqual([]);
    expect(evidence.landingDiffSha256).toBe(undefined);
    expect([...evidence.floorHeldBasesByDigest.entries()]).toEqual([[FLOOR.digest, new Set()]]);
  });

  it("holds the landing base itself, and an ancestor whose named files are unchanged though another file moved", () => {
    const records = [review({ baseRef: older }), review({ baseRef: base })];
    const evidence = readBaselineBumpCarryEvidence({ baseSha: base, headSha: feature, manifests, records, root });
    expect([...evidence.floorHeldBasesByDigest.entries()]).toEqual([[FLOOR.digest, new Set([older, base])]]);
  });

  it("drops a base whose named file differs at the landing base, judging each manifest by its own files", () => {
    const records = [review({ baseRef: older }), review({ baseRef: older, propertyId: OTHER_ID })];
    const evidence = readBaselineBumpCarryEvidence({
      baseSha: movedFloor,
      headSha: feature,
      manifests: [...manifests, { manifest: OTHER, path: "q" }],
      records,
      root,
    });
    expect([...evidence.floorHeldBasesByDigest.entries()]).toEqual([
      [FLOOR.digest, new Set()],
      [OTHER.digest, new Set([older])],
    ]);
  });

  it("hashes the landing patch exactly as a commit diff against the landing base", () => {
    const evidence = readBaselineBumpCarryEvidence({
      baseSha: base,
      headSha: feature,
      manifests,
      records: [review({ baseRef: older })],
      root,
    });
    const expected = commitDiffSha256({ base, commit: feature, cwd: root });
    expect(expected.isOk()).toBe(true);
    expect(evidence.landingDiffSha256).toBe(unwrap(expected));
  });

  it("takes no landing patch when git cannot read the head", () => {
    const evidence = readBaselineBumpCarryEvidence({
      baseSha: base,
      headSha: "f".repeat(40),
      manifests,
      records: [review({ baseRef: older })],
      root,
    });
    expect([...evidence.pinnedBases]).toEqual([older]);
    expect(evidence.landingDiffSha256).toBe(undefined);
  });
});
