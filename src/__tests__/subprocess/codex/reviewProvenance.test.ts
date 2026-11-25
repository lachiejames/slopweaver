/**
 * The fan-out provenance hole, reproduced against a REAL git repository and the REAL review pass.
 *
 * `codex review` freezes ONE diff and hands it byte-identically to every property, but the recorder used to
 * call `capturePassTree` INSIDE each property's own pass — a different moment for every property waiting
 * behind the concurrency cap, and therefore possibly a different tree. A property that waited out a sibling
 * while the author committed recorded the NEWER tree over the OLDER diff, and since review currency is
 * now a positive requirement (`../../../codex/ledger.ts`'s `reviewFailures` wants one CURRENT
 * conclusive review) that is the exact provenance the landing gate asks for: the floor passed on a review
 * that had never seen the code being landed.
 *
 * Reproduced rather than asserted about. The tree really moves between the diff capture and the pass, via a
 * real `git commit`, and every assertion is on the record the shipped recorder persisted.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { makePassBound } from "../../../codex/bounds.js";
import type { LockedCodexClient, LockedCodexThread } from "../../../codex/client.js";
import { captureReviewDiffWithProvenance, captureTreeFingerprint, type ReviewDiff } from "../../../codex/gitDiff.js";
import { freshnessOf } from "../../../codex/ledger.js";
import { type CompletedPass, runReviewProperty } from "../../../codex/orchestrate.js";
import { admitPass, admittedPass } from "../../../codex/passAdmission.js";
import { passProfile } from "../../../codex/profiles.js";
import type { DeadlineRuntime, ScheduledTask } from "../../../codex/runPass.js";
import type { CodexArtifactRecord, CodexPassTree, ReviewProperty } from "../../../codex/types.js";
import { ok, unwrap } from "../../../lib/result.js";
import { gitInTemp, REAL_GIT_TIMEOUT_MS } from "../../tempGitRepo.js";

/** Everything this file mints, removed whatever a test did. */
const mintedDirs: string[] = [];

afterEach(() => {
  for (const dir of mintedDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A repository with a committed base on `main` and one uncommitted edit, so there is a real diff to review. */
function repoWithADiff(): string {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-rev-prov-"));
  mintedDirs.push(dir);
  const git = ({ args }: { args: readonly string[] }): string => gitInTemp({ args, cwd: dir });
  git({ args: ["init", "-q", "-b", "feature"] });
  git({ args: ["config", "user.email", "test@example.com"] });
  git({ args: ["config", "user.name", "Test"] });
  writeFileSync(join(dir, "tracked.txt"), "base\n");
  git({ args: ["add", "-A"] });
  git({ args: ["commit", "-qm", "base"] });
  git({ args: ["branch", "-f", "main", "HEAD"] });
  writeFileSync(join(dir, "tracked.txt"), "base\nthe change under review\n");
  return dir;
}

/** A fresh orchestration root for one case, and the ledger directory beside it. */
function orchestrationRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-rev-prov-orch-"));
  mintedDirs.push(dir, `${dir}-ledgers`);
  return dir;
}

/** Advance the checkout the way a writer does while a queued property waits for its slot. */
function commitSomethingElse({ repoRoot }: { repoRoot: string }): void {
  writeFileSync(join(repoRoot, "unrelated.txt"), "written while the property queued\n");
  gitInTemp({ args: ["add", "-A"], cwd: repoRoot });
  gitInTemp({ args: ["commit", "-qm", "the writer kept working"], cwd: repoRoot });
}

/** A clock returning fixed values — nothing under test here judges time. */
class FixedRuntime implements DeadlineRuntime {
  nowMs(): number {
    return 0;
  }
  nowIso(): string {
    return "2026-09-19T00:00:00.000Z";
  }
  schedule(): ScheduledTask {
    return { cancel: () => {} };
  }
}

/**
 * A plain answering seam, not a mock: it returns one valid CLEAN verdict and touches nothing.
 *
 * Injected because this test is about which TREE the record names, and a real model turn would add cost and
 * nondeterminism to a question that has nothing to do with what Codex says.
 */
function answeringClient({ property }: { property: ReviewProperty }): LockedCodexClient {
  const thread: LockedCodexThread = {
    currentId: () => "thread-under-test",
    run: async () =>
      ok({
        finalResponse: JSON.stringify({
          counterexample: "",
          evidence: "",
          propertyId: property.id,
          summary: "nothing to report",
          verdict: "CLEAN",
        }),
        items: { counts: { agent_message: 1 }, kind: "measured" as const },
        usage: { kind: "not-measured" as const, reason: "sdk-reported-none" as const },
      }),
  };
  return { model: "gpt-5.6-sol", resumeThread: () => thread, startThread: () => thread };
}

const PROPERTY: ReviewProperty = { id: "r1-01", statement: "the recorded tree is the tree the diff came from" };

/** Run ONE real review property against a real repository, returning the pass it completed. */
async function completeOnePass({
  artifactId,
  diff,
  diffTree,
  root,
}: {
  artifactId: string;
  diff: ReviewDiff;
  diffTree: CodexPassTree | undefined;
  root: string;
}): Promise<CompletedPass> {
  const profile = passProfile({ pass: "r1" });
  if (profile.mode !== "review") {
    throw new Error("r1 must be a review profile");
  }
  return runReviewProperty({
    // A real admission over an empty ledger: the only way to obtain the proof a pass requires.
    admitted: admittedPass({ admission: admitPass({ hatchOpen: false, key: undefined, records: [] }) })!,
    baseRef: "main",
    bound: unwrap(makePassBound({ boundSeconds: 240 })),
    client: answeringClient({ property: PROPERTY }),
    diff,
    diffTree,
    newId: () => artifactId,
    orchestrationRoot: root,
    profile,
    property: PROPERTY,
    reclaimLedgerPath: ledgerPathFor({ root }),
    runtime: new FixedRuntime(),
  });
}

/** The reclaim ledger a case's passes journal into — beside its orchestration root, never inside it. */
function ledgerPathFor({ root }: { root: string }): string {
  return `${root}-ledgers/home-reclaim.jsonl`;
}

/** The tree a record carries, where the caller has already established there is one. */
function treeOf({ record }: { record: CodexArtifactRecord }): CodexPassTree {
  return record.tree!;
}

/** A `scoped.tree` the caller has established is there, so an assertion never optional-chains it. */
function presentTree({ tree }: { tree: CodexPassTree | undefined }): CodexPassTree {
  return tree!;
}

describe("runReviewProperty — the record names the tree the DIFF came from", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it("captures the diff and its tree together, bracketing the read", () => {
    const repoRoot = repoWithADiff();
    const scoped = unwrap(captureReviewDiffWithProvenance({ base: "main", cwd: repoRoot, maxBytes: 1_000_000 }));
    const diff = unwrap(scoped.capture);
    expect(diff.text.includes("the change under review")).toBe(true);
    expect(presentTree({ tree: scoped.tree }).headSha).toBe(diff.headSha);
    expect(presentTree({ tree: scoped.tree }).branch).toBe("feature");
    // A dirty tree is the ordinary case for a review, and the bracket must still yield provenance for it.
    expect(presentTree({ tree: scoped.tree }).dirtyBytes).toBeGreaterThan(0);
  });

  /**
   * THE FINDING, end to end. The writer commits between the diff capture and the property's pass — exactly
   * what a property queued behind a sibling experiences — and the record names the DIFF's head, never the
   * one the writer just created.
   */
  it("records the diff's tree, not the newer one, when the checkout moved before the pass ran", async () => {
    const repoRoot = repoWithADiff();
    const root = orchestrationRoot();

    const scoped = unwrap(captureReviewDiffWithProvenance({ base: "main", cwd: repoRoot, maxBytes: 1_000_000 }));
    const diff = unwrap(scoped.capture);

    commitSomethingElse({ repoRoot });
    const movedHead = unwrap(captureTreeFingerprint({ cwd: repoRoot })).headSha;
    expect(movedHead === diff.headSha).toBe(false);

    const pass = await completeOnePass({
      artifactId: "moved-under-a-queued-property",
      diff,
      diffTree: scoped.tree,
      root,
    });

    expect(treeOf({ record: pass.record }).headSha).toBe(diff.headSha);
    expect(treeOf({ record: pass.record }).fingerprint).toBe(presentTree({ tree: scoped.tree }).fingerprint);
    // The record must not name the writer's commit anywhere — not as the tree, and not as the head.
    expect(treeOf({ record: pass.record }).headSha === movedHead).toBe(false);
    // And the floor must read it as STALE rather than CURRENT: the verdict is about code that has moved on.
    expect(freshnessOf({ now: unwrap(captureTreeFingerprint({ cwd: repoRoot })), record: pass.record }).kind).toBe(
      "stale",
    );
  });

  it("records the diff's own tree, and reads CURRENT, when nothing moved", async () => {
    const repoRoot = repoWithADiff();
    const root = orchestrationRoot();

    const scoped = unwrap(captureReviewDiffWithProvenance({ base: "main", cwd: repoRoot, maxBytes: 1_000_000 }));
    const diff = unwrap(scoped.capture);

    const pass = await completeOnePass({ artifactId: "nothing-moved", diff, diffTree: scoped.tree, root });

    expect(treeOf({ record: pass.record }).headSha).toBe(diff.headSha);
    expect(freshnessOf({ now: unwrap(captureTreeFingerprint({ cwd: repoRoot })), record: pass.record }).kind).toBe(
      "current",
    );
    // The frozen copy this property read is named separately, and is not the tree the verdict is about.
    expect(treeOf({ record: pass.record }).snapshotCommit!.length).toBe(40);
    // The artifact ON DISK carries the same tree the returned record does.
    expect(readFileSync(pass.location!.artifactPath, "utf8").includes(diff.headSha)).toBe(true);
  });

  /**
   * The pass reclaims its OWN scratch once its artifact is written. Nothing ran `home reclaim`, so every
   * finished pass's workspace — a whole checkout when the pass built or installed there — stayed forever.
   */
  it("removes its own scratch after publishing, keeps the record, and journals the removal", async () => {
    const repoRoot = repoWithADiff();
    const root = orchestrationRoot();
    const scoped = unwrap(captureReviewDiffWithProvenance({ base: "main", cwd: repoRoot, maxBytes: 1_000_000 }));

    const pass = await completeOnePass({
      artifactId: "reclaims-own",
      diff: unwrap(scoped.capture),
      diffTree: scoped.tree,
      root,
    });

    expect(pass.scratchReclaim.kind).toBe("reclaimed");
    expect(existsSync(join(root, "reclaims-own.scratch"))).toBe(false);
    expect(existsSync(join(root, "reclaims-own", "artifact.md"))).toBe(true);
    expect(existsSync(join(root, "reclaims-own", "record.json"))).toBe(true);
    const rows = readFileSync(ledgerPathFor({ root }), "utf8").trim().split("\n");
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0]!)).toMatchObject({
      removedEntries: 1,
      root: "codex-scratch",
      session: "pass:reclaims-own",
      takes: "finished-scratch",
      witnessHeld: true,
    });
  });

  /**
   * Two properties over ONE frozen diff, the second starting after the writer committed — the contradictory
   * pair the old recorder produced. It reported the first STALE and the second CURRENT over identical
   * verdicts on identical bytes, and it was the CURRENT one the review floor accepted.
   */
  it("never gives two properties on one diff contradictory freshness", async () => {
    const repoRoot = repoWithADiff();
    const root = orchestrationRoot();

    const scoped = unwrap(captureReviewDiffWithProvenance({ base: "main", cwd: repoRoot, maxBytes: 1_000_000 }));
    const diff = unwrap(scoped.capture);

    const first = await completeOnePass({ artifactId: "ran-first", diff, diffTree: scoped.tree, root });
    commitSomethingElse({ repoRoot });
    const second = await completeOnePass({ artifactId: "ran-second", diff, diffTree: scoped.tree, root });

    const now = unwrap(captureTreeFingerprint({ cwd: repoRoot }));
    const freshness = [first, second].map((pass) => freshnessOf({ now, record: pass.record }).kind);
    // Both STALE: the diff predates the commit, so neither verdict over it describes the tree standing now.
    expect(freshness).toEqual(["stale", "stale"]);
    // The two rows name one tree and differ only in the copy each reviewer read.
    expect(treeOf({ record: first.record }).fingerprint).toBe(treeOf({ record: second.record }).fingerprint);
    expect(treeOf({ record: first.record }).snapshotCommit === treeOf({ record: second.record }).snapshotCommit).toBe(
      false,
    );
  });
});
