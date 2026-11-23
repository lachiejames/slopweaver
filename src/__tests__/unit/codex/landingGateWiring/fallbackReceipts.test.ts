/**
 * `readLocalCodexLoop` reads Claude fallback receipts through the same floor as a Codex pass, proved against
 * a real scratch repository.
 *
 * Zero mocks: every edge is a plain function the harness writes, per `.claude/rules/testing.md`.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { validateFallbackReview } from "../../../../codex/fallbackReview.js";
import { resolveRepoRoot } from "../../../../codex/gitDiff.js";
import { readLocalCodexLoop } from "../../../../codex/landingGateRun.js";
import { unwrap } from "../../../../lib/result.js";
import { stateHomePaths } from "../../../../stateHome.js";
import { memoryCodexSignInPort } from "../../../codexSignInFixture.js";
import {
  memoryFallbackRegisterPort,
  memoryFallbackStore,
  putFallbackReceipt,
  putFallbackRequest,
} from "../../../fallbackRegisterFixture.js";
import { memorySupersessionPort } from "../../../landingRegistersFixture.js";
import { gitInTemp } from "../../../tempGitRepo.js";
import { headOf, homes, REAL_GIT, REPO, scratchHome, unwrapFingerprint } from "./harness.js";

// Real git, so the real-git budget applies rather than the lane's 20s default. MEASURED on a
// loaded machine: every test in this describe, and the detached-HEAD case above, timed out at 20s while doing
// nothing wrong — the flake `tempGitRepo.ts`'s own `REAL_GIT_TIMEOUT_MS` docstring names.
describe("readLocalCodexLoop reads Claude fallback receipts through the same floor", REAL_GIT, () => {
  function scratchRepo({ label }: { label: string }): string {
    const dir = mkdtempSync(join(tmpdir(), `slopweaver-repo-${label}-`));
    homes.push(dir);
    const steps: readonly (readonly string[])[] = [
      ["init", "--initial-branch=feature"],
      ["config", "user.email", "dev@example.invalid"],
      ["config", "user.name", "Dev"],
      ["remote", "add", "origin", `git@github.com:${REPO}.git`],
    ];
    for (const args of steps) {
      gitInTemp({ args, cwd: dir });
    }
    writeFileSync(join(dir, "a.txt"), "one\n");
    gitInTemp({ args: ["add", "-A"], cwd: dir });
    gitInTemp({ args: ["commit", "-m", "first"], cwd: dir });
    return dir;
  }

  /** A stored receipt that will not parse — a row no verb here writes, so it can only be a defect or an edit. */
  it("reports unreadable when a receipt will not parse, rather than judging the survivors", async () => {
    const home = scratchHome({ label: "bad-receipt" });
    mkdirSync(stateHomePaths({ home }).orchestration, { recursive: true });
    const store = memoryFallbackStore();
    store.rows.set("req-x", { receiptText: "{ not json", requestId: "req-x", requestText: "{}" });

    const dir = scratchRepo({ label: "bad-receipt" });
    const read = await readLocalCodexLoop({
      cwd: dir,
      fallbackPort: memoryFallbackRegisterPort({ store }),
      head: headOf({ cwd: dir }),
      home,
      signInPort: memoryCodexSignInPort(),
      supersessions: memorySupersessionPort(),
    });

    expect(read.kind).toBe("unreadable");
    expect(read.kind === "unreadable" ? read.reason : "").toContain(
      "1 Claude fallback review receipt(s) could not be read or no longer bind to their request",
    );
  });

  /** The witness can fire: a real prepare/record pair over this checkout becomes a review row on the floor. */
  it("counts a bound, CURRENT receipt as the review half of the floor", async () => {
    const home = scratchHome({ label: "good-receipt" });
    mkdirSync(stateHomePaths({ home }).orchestration, { recursive: true });
    const dir = scratchRepo({ label: "good-receipt" });
    const now = unwrapFingerprint({ cwd: dir });
    const request = {
      baseRef: "origin/main",
      baseSha: now.headSha,
      capEvidence: {
        blockedBy: "capped",
        limitId: "premium",
        observedAtIso: "2026-09-13T14:49:01.803Z",
        reachedType: null,
      },
      createdAtIso: "2026-09-14T01:00:00.000Z",
      diffBytes: 1,
      diffSha256: "d".repeat(64),
      headSha: now.headSha,
      pass: "r1",
      property: { id: "r1-01", statement: "s" },
      // git reports the REAL path (`/private/var/…` on macOS), and the ledger keys on what git reports.
      repoRoot: unwrap(resolveRepoRoot({ cwd: dir })),
      requestId: "req-good",
      schemaVersion: 1,
      tree: { branch: "feature", dirtyBytes: 0, fingerprint: now.digest, headSha: now.headSha, treeSha: now.treeSha },
    } as const;
    const fallbackPort = memoryFallbackRegisterPort();
    const bytes = await putFallbackRequest({ home, port: fallbackPort, request });
    const receipt = unwrap(
      validateFallbackReview({
        answer: JSON.stringify({
          counterexample: "",
          evidence: "e",
          propertyId: "r1-01",
          summary: "s",
          verdict: "CLEAN",
        }),
        completedAtIso: "2026-09-14T01:30:00.000Z",
        now,
        receiptId: "rcpt-good",
        request,
        requestBytes: bytes,
        reviewer: { host: "claude-code", model: null, workspace: null },
      }),
    );
    await putFallbackReceipt({ home, port: fallbackPort, receipt });

    const read = await readLocalCodexLoop({
      cwd: dir,
      fallbackPort,
      head: headOf({ cwd: dir }),
      home,
      signInPort: memoryCodexSignInPort(),
      supersessions: memorySupersessionPort(),
    });

    expect(read.kind).toBe("read");
    // The REVIEW half is met by the receipt; only the plan half remains, which a receipt can never satisfy —
    // and, the receipt witnessing the cap, the refusal names the acknowledgement that half rides.
    expect(read.kind === "read" ? read.evidence.failures : []).toEqual([
      "no planning pass has run on this branch — nothing planned the work before it was written" +
        ". Codex is CAPPED, and nothing waits on it (the owner's ruling): BEFORE the work, a " +
        "visible Claude session takes the plan — `slopweaver codex plan-fallback prepare`, answer the packet, then " +
        "`codex plan-fallback record` before any edit; work that already began without one rides " +
        '`--acknowledge codex-loop-incomplete --reason "…"` on the landing verb, the reason citing ' +
        "$SLOPWEAVER_HOME/supervisor-scratch/handoff-9257/owner-turn-253-2.txt and written to the door ledger",
    ]);
  });
});
