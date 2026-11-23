/**
 * `codex status --check` and `github enqueue` must reach ONE answer about review currency.
 *
 * The defect, as measured: the checkout held an uncommitted `yarn.lock` hunk, a
 * Claude fallback review was taken over HEAD plus that hunk, and `codex status` printed it CURRENT while the
 * landing refused it STALE. Both verbs fold the same rows through the same `loopFailures`; they judged
 * different trees. Every case here builds a real repository and real receipts, then asks the working-tree
 * fold `codex status` prints, the landing reader `github enqueue` calls, and `checkoutLandingFloor` — what
 * `--check` refuses on — and pins which of them agree.
 *
 * Zero mocks: the seams are a scratch repository, a scratch state home, a Codex home that does not exist and an
 * in-memory fallback store per home.
 */

import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, describe, expect, it } from "vitest";

import { checkoutLandingFloor } from "../../../codex/checkoutLandingFloor.js";
import {
  type ClaudeFallbackPlanReceipt,
  fallbackLedgerEntries,
  validateFallbackPlan,
} from "../../../codex/fallbackPlan.js";
import type { FallbackRegisterPort } from "../../../codex/fallbackPort.js";
import { type ClaudeFallbackReviewReceipt, validateFallbackReview } from "../../../codex/fallbackReview.js";
import type { TreeFingerprint } from "../../../codex/fingerprint.js";
import { captureTreeFingerprint, resolveRepoRoot } from "../../../codex/gitDiff.js";
import { readLocalCodexLoop } from "../../../codex/landingGateRun.js";
import { type LedgerEntry, ledgerForBranch, loopFailures } from "../../../codex/ledger.js";
import type { CodexPassTree } from "../../../codex/types.js";
import { unwrap } from "../../../lib/result.js";
import { stateHomePaths } from "../../../stateHome.js";
import { memoryCodexSignInPort } from "../../codexSignInFixture.js";
import { memoryFallbackRegisterPort, putFallbackReceipt, putFallbackRequest } from "../../fallbackRegisterFixture.js";
import { memorySupersessionPort } from "../../landingRegistersFixture.js";
import { seedTemplate } from "../../seedTemplate.js";
import { gitInTemp, REAL_GIT_TIMEOUT_MS } from "../../tempGitRepo.js";

const REAL_GIT = { timeout: REAL_GIT_TIMEOUT_MS };
const REPO = "acme/widget";
const BRANCH = "feature";
/** A Codex home nothing creates, so no live cap is read — see `landingGateWiring/harness.ts` for why. */
const CAP = { blockedBy: "capped", limitId: null, observedAtIso: "2026-10-01T00:00:00.000Z", reachedType: null };
const CLAUDE = { host: "claude-code", model: "opus", workspace: null } as const;

const dirs: string[] = [];
/** One in-memory fallback store per scratch home, so a home's receipts are only that home's. */
const ports = new Map<string, FallbackRegisterPort>();

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
  ports.clear();
});

/** The fallback port standing for `home`'s store. */
function portFor({ home }: { home: string }): FallbackRegisterPort {
  return ports.get(home)!;
}

function scratch({ label }: { label: string }): string {
  const dir = mkdtempSync(join(tmpdir(), `slopweaver-currency-${label}-`));
  dirs.push(dir);
  return dir;
}

/**
 * The seeded repository every case starts from, built ONCE per file and only ever copied, never written: its
 * `git init`, config and first commit were a sixth of each case's git spawns. A copy carries the index's stale stat
 * data, which the porcelain `git diff` every fingerprint runs refreshes, so a copy fingerprints as the seed did.
 */
let template: string | undefined;

afterAll(() => {
  if (template !== undefined) {
    rmSync(template, { force: true, recursive: true });
  }
});

/** The seeded template, built by whichever case asks first. */
function templateRepo(): string {
  if (template !== undefined) {
    return template;
  }
  template = seedTemplate({ prefix: "slopweaver-currency-template-", seed: seedRepo });
  return template;
}

/** A repository on `feature` with `origin` set and one commit: the tree a plan reads BEFORE the work. */
function scratchRepo(): string {
  const dir = scratch({ label: "repo" });
  cpSync(templateRepo(), dir, { recursive: true });
  return dir;
}

/** Seed `dir` as {@link scratchRepo} describes, with real git. */
function seedRepo({ dir }: { dir: string }): void {
  for (const args of [
    ["init", "--initial-branch=feature"],
    ["config", "user.email", "dev@example.invalid"],
    ["config", "user.name", "Dev"],
    ["remote", "add", "origin", `git@github.com:${REPO}.git`],
  ]) {
    gitInTemp({ args, cwd: dir });
  }
  writeFileSync(join(dir, "a.txt"), "one\n");
  commitAll({ dir, message: "before the work" });
}

function commitAll({ dir, message }: { dir: string; message: string }): void {
  gitInTemp({ args: ["add", "-A"], cwd: dir });
  gitInTemp({ args: ["commit", "-m", message], cwd: dir });
}

function fingerprint({ dir }: { dir: string }): TreeFingerprint {
  return unwrap(captureTreeFingerprint({ cwd: dir }));
}

function treeOf({ now }: { now: TreeFingerprint }): CodexPassTree {
  return {
    branch: BRANCH,
    dirtyBytes: now.dirtyBytes,
    fingerprint: now.digest,
    headSha: now.headSha,
    treeSha: now.treeSha,
  };
}

/** A fallback PLAN prepared and recorded over the tree as it stands — the `plan-fallback` verbs' two halves. */
async function recordPlan({ dir, home }: { dir: string; home: string }): Promise<ClaudeFallbackPlanReceipt> {
  const now = fingerprint({ dir });
  const request = {
    capEvidence: CAP,
    createdAtIso: "2026-10-01T01:00:00.000Z",
    mode: "plan",
    pass: "p2",
    promptBytes: 1,
    promptSha256: "p".repeat(64),
    repoRoot: unwrap(resolveRepoRoot({ cwd: dir })),
    requestId: "plan-req",
    schemaVersion: 1,
    taskSha256: "t".repeat(64),
    tree: treeOf({ now }),
  } as const;
  const port = portFor({ home });
  const requestBytes = await putFallbackRequest({ home, port, request });
  const receipt = unwrap(
    validateFallbackPlan({
      answer: JSON.stringify({ blockers: [], bodyMarkdown: "the plan", summary: "s", verdict: "READY" }),
      completedAtIso: "2026-10-01T01:05:00.000Z",
      now,
      planner: CLAUDE,
      receiptId: "plan-rcpt",
      request,
      requestBytes,
    }),
  );
  await putFallbackReceipt({ home, port, receipt });
  return receipt;
}

/** A fallback REVIEW prepared and recorded over the tree as it stands, dirty bytes included. */
async function recordReview({
  dir,
  home,
  verdict,
}: {
  dir: string;
  home: string;
  verdict: "CLEAN" | "BROKEN";
}): Promise<ClaudeFallbackReviewReceipt> {
  const now = fingerprint({ dir });
  const request = {
    baseRef: "origin/main",
    baseSha: now.headSha,
    capEvidence: CAP,
    createdAtIso: "2026-10-01T02:00:00.000Z",
    diffBytes: 1,
    diffSha256: "d".repeat(64),
    headSha: now.headSha,
    pass: "r3",
    property: { id: "r3-04", statement: "the work does what it says" },
    repoRoot: unwrap(resolveRepoRoot({ cwd: dir })),
    requestId: "review-req",
    schemaVersion: 1,
    tree: treeOf({ now }),
  } as const;
  const port = portFor({ home });
  const requestBytes = await putFallbackRequest({ home, port, request });
  const receipt = unwrap(
    validateFallbackReview({
      answer: JSON.stringify({
        counterexample: verdict === "BROKEN" ? "this input" : "",
        evidence: "read the packet",
        propertyId: "r3-04",
        summary: "s",
        verdict,
      }),
      completedAtIso: "2026-10-01T02:05:00.000Z",
      now,
      receiptId: "review-rcpt",
      request,
      requestBytes,
      reviewer: CLAUDE,
    }),
  );
  await putFallbackReceipt({ home, port, receipt });
  return receipt;
}

/**
 * A state home with an orchestration directory, so the pass-record scan reads an empty set rather than none,
 * and its own empty fallback store.
 */
function scratchHome(): string {
  const home = scratch({ label: "home" });
  mkdirSync(stateHomePaths({ home }).orchestration, { recursive: true });
  ports.set(home, memoryFallbackRegisterPort());
  return home;
}

/** The fold `codex status` prints its rows from: the receipts judged against the WORKING tree. */
function worktreeRows({
  dir,
  plan,
  review,
}: {
  dir: string;
  plan: ClaudeFallbackPlanReceipt;
  review: ClaudeFallbackReviewReceipt;
}): readonly LedgerEntry[] {
  const now = fingerprint({ dir });
  const repoRoot = unwrap(resolveRepoRoot({ cwd: dir }));
  return ledgerForBranch({
    branch: BRANCH,
    fallbackEntries: fallbackLedgerEntries({
      branch: BRANCH,
      now,
      repoRoot,
      scan: { planReceipts: [plan], receipts: [review] },
    }),
    now,
    records: [],
    repoRoot,
  }).entries;
}

/** What `github enqueue` reads for a pull request whose head is this checkout's tip of {@link BRANCH}. */
async function landingFailures({ dir, home }: { dir: string; home: string }): Promise<readonly string[]> {
  const head = { baseSha: undefined, branch: BRANCH, headSha: fingerprint({ dir }).headSha, repository: REPO };
  const read = await readLocalCodexLoop({
    cwd: dir,
    fallbackPort: portFor({ home }),
    head,
    home,
    signInPort: memoryCodexSignInPort(),
    supersessions: memorySupersessionPort(),
  });
  if (read.kind !== "read") {
    throw new Error(`the landing reader refused to read: ${read.reason}`);
  }
  return read.evidence.failures;
}

/** What `codex status --check` refuses on. */
async function checkFailures({ dir, home }: { dir: string; home: string }): Promise<readonly string[]> {
  return (
    await checkoutLandingFloor({
      branch: BRANCH,
      cwd: dir,
      fallbackPort: portFor({ home }),
      home,
      signInPort: memoryCodexSignInPort(),
      supersessions: memorySupersessionPort(),
    })
  ).failures;
}

describe("codex status --check and github enqueue agree on review currency", REAL_GIT, () => {
  it("a STALE READY fallback plan plus a CURRENT CLEAN fallback review over the committed head clears both", async () => {
    const dir = scratchRepo();
    const home = scratchHome();
    const plan = await recordPlan({ dir, home });
    writeFileSync(join(dir, "b.txt"), "the work\n");
    commitAll({ dir, message: "the work" });
    const review = await recordReview({ dir, home, verdict: "CLEAN" });

    expect(worktreeRows({ dir, plan, review }).map((row) => `${row.pass} ${row.freshness.kind}`)).toEqual([
      "r3 current",
      "p2 stale",
    ]);
    expect(loopFailures({ entries: worktreeRows({ dir, plan, review }) })).toEqual([]);
    expect(await landingFailures({ dir, home })).toEqual([]);
    expect(await checkFailures({ dir, home })).toEqual([]);
  });

  it("a review over HEAD plus an uncommitted hunk is CURRENT for the working tree and STALE for both landing readers", async () => {
    const dir = scratchRepo();
    const home = scratchHome();
    const plan = await recordPlan({ dir, home });
    writeFileSync(join(dir, "b.txt"), "the work\n");
    commitAll({ dir, message: "the work" });
    // The measured shape: an uncommitted edit nobody means to land, read by the review along with the commit.
    writeFileSync(join(dir, "a.txt"), "one\nlocal only\n");
    const review = await recordReview({ dir, home, verdict: "CLEAN" });
    const headSha = fingerprint({ dir }).headSha;

    expect(worktreeRows({ dir, plan, review })[0]!.freshness.kind).toBe("current");
    const landing = await landingFailures({ dir, home });
    expect(landing).toHaveLength(1);
    expect(landing[0]).toContain("1 review pass(es) ran but none is both current and conclusive");
    expect(landing[0]).toContain(
      `the newest, r3 (r3-04), is STALE: the pass read ${String(review.request.tree.dirtyBytes)} byte(s) of ` +
        `uncommitted change on top of HEAD ${headSha.slice(0, 12)}, and the tree being judged carries none of it`,
    );
    expect(await checkFailures({ dir, home })).toEqual(landing);
  });

  it("a review over a tree the work has since moved past refuses in both landing readers", async () => {
    const dir = scratchRepo();
    const home = scratchHome();
    await recordPlan({ dir, home });
    writeFileSync(join(dir, "b.txt"), "the work\n");
    commitAll({ dir, message: "the work" });
    await recordReview({ dir, home, verdict: "CLEAN" });
    writeFileSync(join(dir, "c.txt"), "more work after the review\n");
    commitAll({ dir, message: "more work" });

    const landing = await landingFailures({ dir, home });
    expect(landing).toHaveLength(1);
    expect(landing[0]).toContain("the newest, r3 (r3-04), is STALE: the committed tree changed after the pass read it");
    expect(await checkFailures({ dir, home })).toEqual(landing);
  });

  it("a CURRENT BROKEN fallback review still vetoes in both landing readers", async () => {
    const dir = scratchRepo();
    const home = scratchHome();
    await recordPlan({ dir, home });
    writeFileSync(join(dir, "b.txt"), "the work\n");
    commitAll({ dir, message: "the work" });
    await recordReview({ dir, home, verdict: "BROKEN" });

    const landing = await landingFailures({ dir, home });
    expect(landing).toEqual([
      "r3 is CURRENT and BROKEN (r3-04) — fix it, then take the second and last review pass over the fixed diff",
    ]);
    expect(await checkFailures({ dir, home })).toEqual(landing);
  });

  it("an edit made after a review of the committed head counts for nothing at --check, exactly as at the landing", async () => {
    const dir = scratchRepo();
    const home = scratchHome();
    const plan = await recordPlan({ dir, home });
    writeFileSync(join(dir, "b.txt"), "the work\n");
    commitAll({ dir, message: "the work" });
    const review = await recordReview({ dir, home, verdict: "CLEAN" });
    writeFileSync(join(dir, "a.txt"), "one\nnot committed\n");

    expect(worktreeRows({ dir, plan, review })[0]!.freshness.kind).toBe("stale");
    expect(await landingFailures({ dir, home })).toEqual([]);
    expect(await checkFailures({ dir, home })).toEqual([]);
  });

  it("refuses rather than judging when the branch has no tip in this checkout", async () => {
    const dir = scratchRepo();
    const home = scratchHome();

    const floor = await checkoutLandingFloor({
      branch: "nowhere",
      cwd: dir,
      fallbackPort: portFor({ home }),
      home,
      signInPort: memoryCodexSignInPort(),
      supersessions: memorySupersessionPort(),
    });

    expect(floor.headSha).toBeUndefined();
    expect(floor.failures).toHaveLength(1);
    expect(floor.failures[0]).toContain("cannot resolve the tip of nowhere in this checkout");
  });
});
