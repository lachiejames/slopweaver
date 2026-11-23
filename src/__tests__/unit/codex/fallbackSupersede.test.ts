/**
 * Retiring a Claude fallback review receipt — the same supersede path a Codex review pass has.
 *
 * MEASURED, and it is why this is a lane of its own rather than a case in
 * `./supersession.test.ts`: a BROKEN fallback receipt stood CURRENT on a branch, a CLEAN receipt under
 * the same property stood beside it, and `codex supersede --artifact <receiptId>` answered `no pass with
 * artifact id … ran on this branch in this checkout` — because the verb built its ledger from pass records
 * alone while the floor that counted the receipt built one from both. A receipt the landing floor counts
 * (an owner ruling) that no verb can retire blocks every landing for as long as Codex stays capped.
 *
 * Two halves, and both are needed: the fold marks a receipt retired (pure), and the VERB reaches one
 * end-to-end over a real checkout, real receipts in an in-memory fallback store and the real register.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runCodexSupersedeOver } from "../../../cli/commands/codex/supersedeRun.js";
import { EXIT_ERROR, EXIT_OK } from "../../../cli/exitCodes.js";
import type { FallbackRegisterPort } from "../../../codex/fallbackPort.js";
import {
  type ClaudeFallbackReviewRequest,
  fallbackReviewEntries,
  validateFallbackReview,
} from "../../../codex/fallbackReview.js";
import { type TreeFingerprint, treeFingerprint } from "../../../codex/fingerprint.js";
import { captureTreeFingerprint, resolveRepoRoot } from "../../../codex/gitDiff.js";
import { readLocalCodexLoop } from "../../../codex/landingGateRun.js";
import { ledgerForBranch } from "../../../codex/ledger.js";
import { renderLedger } from "../../../codex/ledgerRender.js";
import type { Supersession } from "../../../codex/supersession.js";
import type { SupersessionPort } from "../../../codex/supersessionPort.js";
import { unwrap } from "../../../lib/result.js";
import { stateHomePaths } from "../../../stateHome.js";
import { memoryCodexSignInPort } from "../../codexSignInFixture.js";
import {
  type MemoryFallbackStore,
  memoryFallbackRegisterPort,
  memoryFallbackStore,
  putFallbackReceipt,
  putFallbackRequest,
  unavailableFallbackRegisterPort,
} from "../../fallbackRegisterFixture.js";
import { memorySupersessionPort, memorySupersessionStore } from "../../landingRegistersFixture.js";
import { gitInTemp, REAL_GIT_TIMEOUT_MS } from "../../tempGitRepo.js";

/** The real-git budget, hoisted so a `describe` naming it still fits one line. */
const REAL_GIT = { timeout: REAL_GIT_TIMEOUT_MS };

const REPO = "/w/repo";
const BRANCH = "feature";
const HEAD = "06e12d9aa1b2c3d4e5f60718293a4b5c6d7e8f90";
const dirs: string[] = [];
/** One in-memory fallback store per scratch home, so a home's receipts are only that home's. */
const stores = new Map<string, MemoryFallbackStore>();

afterEach(() => {
  dirs.splice(0).forEach((dir) => {
    rmSync(dir, { force: true, recursive: true });
  });
  stores.clear();
});

/** The fallback port standing for `home`'s store. */
function portFor({ home }: { home: string }): FallbackRegisterPort {
  return memoryFallbackRegisterPort({ store: stores.get(home)! });
}

/** A throwaway directory this file owns, removed after every test. */
function scratch({ label }: { label: string }): string {
  const dir = mkdtempSync(join(tmpdir(), `slopweaver-fbsup-${label}-`));
  dirs.push(dir);
  return dir;
}

/**
 * A one-commit repository on `feature`, which is what a receipt's tree has to describe. The `origin` remote
 * is not decoration: `readLocalCodexLoop` resolves the pull request's repository first and answers
 * `unreadable` without one, which would make every floor read below vacuous.
 */
function scratchRepo({ label }: { label: string }): string {
  const dir = scratch({ label });
  const steps: readonly (readonly string[])[] = [
    ["init", "--initial-branch=feature"],
    ["config", "user.email", "dev@example.invalid"],
    ["config", "user.name", "Dev"],
    ["remote", "add", "origin", "git@github.com:acme/widget.git"],
  ];
  for (const args of steps) {
    gitInTemp({ args, cwd: dir });
  }
  writeFileSync(join(dir, "a.txt"), "one\n");
  gitInTemp({ args: ["add", "-A"], cwd: dir });
  gitInTemp({ args: ["commit", "-m", "first"], cwd: dir });
  return dir;
}

function answerJson({ verdict, propertyId }: { verdict: "CLEAN" | "BROKEN"; propertyId: string }): string {
  return JSON.stringify({
    counterexample: verdict === "BROKEN" ? "the packet's own input" : "",
    evidence: "read the packet",
    propertyId,
    summary: "s",
    verdict,
  });
}

/** A request/receipt pair written through the port, exactly as `review-fallback prepare`/`record` leave one. */
async function recordReceipt({
  home,
  repoRoot,
  now,
  requestId,
  receiptId,
  verdict,
  completedAtIso,
  propertyId = "r1-01",
}: {
  home: string;
  repoRoot: string;
  now: TreeFingerprint;
  requestId: string;
  receiptId: string;
  verdict: "CLEAN" | "BROKEN";
  completedAtIso: string;
  propertyId?: string;
}): Promise<void> {
  const request: ClaudeFallbackReviewRequest = {
    baseRef: "origin/main",
    baseSha: now.headSha,
    capEvidence: {
      blockedBy: "Codex reported workspace_member_usage_limit_reached at 2026-09-13T14:49:01.803Z",
      limitId: "premium",
      observedAtIso: "2026-09-13T14:49:01.803Z",
      reachedType: "workspace_member_usage_limit_reached",
    },
    createdAtIso: "2026-09-14T01:00:00.000Z",
    diffBytes: 1,
    diffSha256: "d".repeat(64),
    headSha: now.headSha,
    pass: "r1",
    property: { id: propertyId, statement: "s" },
    repoRoot,
    requestId,
    schemaVersion: 1,
    tree: { branch: BRANCH, dirtyBytes: 0, fingerprint: now.digest, headSha: now.headSha, treeSha: now.treeSha },
  };
  const port = portFor({ home });
  const requestBytes = await putFallbackRequest({ home, port, request });
  const receipt = unwrap(
    validateFallbackReview({
      answer: answerJson({ propertyId, verdict }),
      completedAtIso,
      now,
      receiptId,
      request,
      requestBytes,
      reviewer: { host: "claude-code", model: "opus", workspace: null },
    }),
  );
  await putFallbackReceipt({ home, port, receipt });
}

/**
 * A home with the orchestration root present, so the pass-record scan reads an empty directory not a gap, and
 * its own empty fallback store.
 */
function scratchHome({ label }: { label: string }): string {
  const home = scratch({ label });
  mkdirSync(stateHomePaths({ home }).orchestration, { recursive: true });
  stores.set(home, memoryFallbackStore());
  return home;
}

/** The verb, invoked exactly as the dispatcher does, over `home`'s store unless a port is named. */
function supersede({
  home,
  repoRoot,
  artifactId,
  fallbackPort = portFor({ home }),
  supersessions,
  reason = "the wording asked for an unbounded walk",
}: {
  home: string;
  repoRoot: string;
  artifactId: string;
  fallbackPort?: FallbackRegisterPort;
  supersessions: SupersessionPort;
  reason?: string;
}): Promise<number> {
  return runCodexSupersedeOver({
    argv: [
      "node",
      "slopweaver",
      "codex",
      "supersede",
      "--artifact",
      artifactId,
      "--reason",
      reason,
      "--home",
      home,
      "--repo",
      repoRoot,
    ],
    fallbackPort,
    supersessions,
  });
}

describe("the ledger fold marks a retired fallback receipt", () => {
  const tree = { branch: BRANCH, dirtyBytes: 0, fingerprint: "", headSha: HEAD, treeSha: `${HEAD.slice(2)}ab` };
  const now: TreeFingerprint = treeFingerprint({ dirtyPatch: "", headSha: HEAD, treeSha: tree.treeSha });

  function receiptRow({
    receiptId,
    verdict,
    completedAtIso,
  }: {
    receiptId: string;
    verdict: "CLEAN" | "BROKEN";
    completedAtIso: string;
  }) {
    const request: ClaudeFallbackReviewRequest = {
      baseRef: "origin/main",
      baseSha: HEAD,
      capEvidence: {
        blockedBy: "capped",
        limitId: "premium",
        observedAtIso: "2026-09-13T14:49:01.803Z",
        reachedType: null,
      },
      createdAtIso: "2026-09-14T01:00:00.000Z",
      diffBytes: 1,
      diffSha256: "d".repeat(64),
      headSha: HEAD,
      pass: "r1",
      property: { id: "r1-01", statement: "s" },
      repoRoot: REPO,
      requestId: `req-${receiptId}`,
      schemaVersion: 1,
      tree: { ...tree, fingerprint: now.digest },
    };
    return unwrap(
      validateFallbackReview({
        answer: answerJson({ propertyId: "r1-01", verdict }),
        completedAtIso,
        now,
        receiptId,
        request,
        requestBytes: JSON.stringify(request),
        reviewer: { host: "claude-code", model: "opus", workspace: null },
      }),
    );
  }

  const row: Supersession = {
    artifactId: "rcpt-broken",
    atIso: "2026-09-14T03:00:00.000Z",
    propertyId: "r1-01",
    reason: "the wording asked for an unbounded walk",
    replacedBy: "rcpt-clean",
  };

  function fold({ supersessions }: { supersessions: ReadonlyMap<string, Supersession> }) {
    const receipts = [
      receiptRow({ completedAtIso: "2026-09-14T01:30:00.000Z", receiptId: "rcpt-broken", verdict: "BROKEN" }),
      receiptRow({ completedAtIso: "2026-09-14T02:30:00.000Z", receiptId: "rcpt-clean", verdict: "CLEAN" }),
    ];
    return ledgerForBranch({
      branch: BRANCH,
      fallbackEntries: fallbackReviewEntries({ branch: BRANCH, now, receipts, repoRoot: REPO }),
      now,
      records: [],
      repoRoot: REPO,
      supersessions,
    });
  }

  it("carries the retirement onto the receipt's own row, keyed by receipt id", () => {
    const entries = fold({ supersessions: new Map([[row.artifactId, row]]) }).entries;
    const retired = entries.find((entry) => entry.artifactId === "rcpt-broken")!;
    expect(retired.superseded!.replacedBy).toBe("rcpt-clean");
    expect(retired.superseded!.reason).toBe("the wording asked for an unbounded walk");
  });

  it("leaves an unretired receipt's row exactly as it was — the witness can fire", () => {
    const entries = fold({ supersessions: new Map() }).entries;
    expect(entries.find((entry) => entry.artifactId === "rcpt-broken")!.superseded).toBeUndefined();
  });

  it("keeps the retired receipt VISIBLE, printed as SUPERSEDED with its reason", () => {
    const lines = renderLedger({
      branch: BRANCH,
      entries: fold({ supersessions: new Map([[row.artifactId, row]]) }).entries,
      headSha: HEAD,
      withoutSidecar: 0,
      unattributed: 0,
      unplaceable: [],
      unreadable: 0,
    });
    expect(lines).toContain("        SUPERSEDED by rcpt-clean on 2026-09-14T03:00:00.000Z");
    expect(lines).toContain("        reason: the wording asked for an unbounded walk");
  });
});

// Real git over a real checkout, so the lane's own real-git budget applies rather than its 20s default.
describe("codex supersede reaches a Claude fallback receipt", REAL_GIT, () => {
  it("retires a CURRENT BROKEN receipt that a CLEAN one replaced, and the review floor stops refusing", async () => {
    const home = scratchHome({ label: "retire" });
    const dir = scratchRepo({ label: "retire" });
    const repoRoot = unwrap(resolveRepoRoot({ cwd: dir }));
    const now = unwrap(captureTreeFingerprint({ cwd: dir }));
    await recordReceipt({
      completedAtIso: "2026-09-14T01:30:00.000Z",
      home,
      now,
      receiptId: "rcpt-broken",
      repoRoot,
      requestId: "req-broken",
      verdict: "BROKEN",
    });
    await recordReceipt({
      completedAtIso: "2026-09-14T02:30:00.000Z",
      home,
      now,
      receiptId: "rcpt-clean",
      repoRoot,
      requestId: "req-clean",
      verdict: "CLEAN",
    });

    const supersessions = memorySupersessionPort();
    expect(await supersede({ artifactId: "rcpt-broken", home, repoRoot: dir, supersessions })).toBe(EXIT_OK);

    expect(unwrap(await supersessions.read({ home })).get("rcpt-broken")!.replacedBy).toBe("rcpt-clean");
    const after = await readLocalCodexLoop({
      cwd: dir,
      fallbackPort: portFor({ home }),
      head: { baseSha: undefined, branch: BRANCH, headSha: now.headSha, repository: "acme/widget" },
      home,
      signInPort: memoryCodexSignInPort(),
      supersessions,
    });
    expect(after.kind).toBe("read");
    // Only the PLAN half is left: a receipt never satisfies it, and a retirement never invents one. The
    // witness fires in the other direction in the refusal case below, where the BROKEN row keeps the floor
    // shut — one floor read per test, because each one shells git over a real checkout.
    //
    // The refusal carries `cappedPlanNextStep`'s route because the receipt in this fixture witnesses
    // a cap, which is exactly the state this whole lane is about: asserting the bare sentence would pass
    // over the one line telling the operator how a capped branch still lands.
    expect(after.kind === "read" ? after.evidence.failures : []).toEqual([
      "no planning pass has run on this branch — nothing planned the work before it was " +
        "written. Codex is CAPPED, and nothing waits on it (the owner's ruling): BEFORE the work, a " +
        "visible Claude session takes the plan — `slopweaver codex plan-fallback prepare`, answer the packet, then " +
        "`codex plan-fallback record` before any edit; work that already began without one rides " +
        '`--acknowledge codex-loop-incomplete --reason "…"` on the landing verb, the reason citing ' +
        "$SLOPWEAVER_HOME/supervisor-scratch/handoff-9257/owner-turn-253-2.txt and written to the door ledger",
    ]);
  });

  it("REFUSES a receipt with nothing in its place, so a lone BROKEN receipt cannot be waved away", async () => {
    const home = scratchHome({ label: "lone" });
    const dir = scratchRepo({ label: "lone" });
    const repoRoot = unwrap(resolveRepoRoot({ cwd: dir }));
    const now = unwrap(captureTreeFingerprint({ cwd: dir }));
    await recordReceipt({
      completedAtIso: "2026-09-14T01:30:00.000Z",
      home,
      now,
      receiptId: "rcpt-broken",
      repoRoot,
      requestId: "req-broken",
      verdict: "BROKEN",
    });

    const store = memorySupersessionStore();
    const supersessions = memorySupersessionPort({ store });
    expect(await supersede({ artifactId: "rcpt-broken", home, repoRoot: dir, supersessions })).toBe(EXIT_ERROR);
    expect(store.rows.size).toBe(0);
    const after = await readLocalCodexLoop({
      cwd: dir,
      fallbackPort: portFor({ home }),
      head: { baseSha: undefined, branch: BRANCH, headSha: now.headSha, repository: "acme/widget" },
      home,
      signInPort: memoryCodexSignInPort(),
      supersessions,
    });
    expect(after.kind).toBe("read");
    expect(after.kind === "read" ? after.evidence.failures : []).toContain(
      "r1 is CURRENT and BROKEN (r1-01) — fix it, then take the second and last review pass over the fixed diff",
    );
  });

  it("refuses an unreadable receipt scan rather than reporting the named receipt never ran", async () => {
    const home = scratchHome({ label: "unreadable" });
    const dir = scratchRepo({ label: "unreadable" });
    stores.get(home)!.rows.set("req-x", { receiptText: "{ not json", requestId: "req-x", requestText: "{}" });
    expect(unwrap(await portFor({ home }).scan({ home })).unreadable).toBe(1);

    const store = memorySupersessionStore();
    const supersessions = memorySupersessionPort({ store });
    expect(await supersede({ artifactId: "rcpt-broken", home, repoRoot: dir, supersessions })).toBe(EXIT_ERROR);
    expect(store.rows.size).toBe(0);
  });

  it("refuses when the fallback store is down, even over a receipt pair it would otherwise retire", async () => {
    const home = scratchHome({ label: "store-down" });
    const dir = scratchRepo({ label: "store-down" });
    const repoRoot = unwrap(resolveRepoRoot({ cwd: dir }));
    const now = unwrap(captureTreeFingerprint({ cwd: dir }));
    for (const [receiptId, verdict, completedAtIso] of [
      ["rcpt-broken", "BROKEN", "2026-09-14T01:30:00.000Z"],
      ["rcpt-clean", "CLEAN", "2026-09-14T02:30:00.000Z"],
    ] as const) {
      await recordReceipt({ completedAtIso, home, now, receiptId, repoRoot, requestId: `req-${receiptId}`, verdict });
    }

    const store = memorySupersessionStore();
    const exit = await supersede({
      artifactId: "rcpt-broken",
      fallbackPort: unavailableFallbackRegisterPort(),
      home,
      repoRoot: dir,
      supersessions: memorySupersessionPort({ store }),
    });

    expect(exit).toBe(EXIT_ERROR);
    expect(store.rows.size).toBe(0);
  });
});
