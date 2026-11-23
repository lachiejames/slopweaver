/**
 * `codex review`'s pre-spend lines read over a real state home and a real checkout: a chase built from
 * Claude fallback receipts reaches the reader, filtered to the properties about to run, and a detached HEAD
 * reads no history at all.
 *
 * Zero mocks: the receipts are written through the same port `review-fallback record` uses, over an in-memory
 * store.
 */

import { mkdirSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import { reviewAnnounceLines } from "../../../../../cli/commands/codex/reviewAnnounce.js";
import type { FallbackRegisterPort } from "../../../../../codex/fallbackPort.js";
import { resolveRepoRoot } from "../../../../../codex/gitDiff.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { stateHomePaths } from "../../../../../stateHome.js";
import {
  FALLBACK_FIXTURE_OUTAGE,
  memoryFallbackRegisterPort,
  unavailableFallbackRegisterPort,
} from "../../../../fallbackRegisterFixture.js";
import { memorySupersessionPort, unavailableSupersessionPort } from "../../../../landingRegistersFixture.js";
import { REAL_GIT_TIMEOUT_MS } from "../../../../tempGitRepo.js";
import { recordFallback, removeScratch, scratch, scratchRepo } from "./fallbackBranchFixture.js";

afterEach(() => {
  removeScratch();
});

/** A home and a checkout holding three BROKEN runs of one property and one CLEAN run of another. */
async function chasedBranch(): Promise<{ home: string; port: FallbackRegisterPort; repoRoot: string }> {
  const home = scratch({ label: "home" });
  mkdirSync(stateHomePaths({ home }).orchestration, { recursive: true });
  const dir = scratchRepo();
  const port = memoryFallbackRegisterPort();
  for (const minute of [10, 20, 30]) {
    await recordFallback({ dir, home, minute, port, propertyId: "r3-07", verdict: "BROKEN" });
  }
  await recordFallback({ dir, home, minute: 40, port, propertyId: "r3-08", verdict: "CLEAN" });
  return { home, port, repoRoot: unwrap(resolveRepoRoot({ cwd: dir })) };
}

const SCOPE = "reviewing 1 property over 42 bytes of diff (sha256 abcdefabcdef…), 1 at a time";

describe("reviewAnnounceLines", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it("prints the chase a branch's fallback receipts hold for a property about to run", async () => {
    const { home, port, repoRoot } = await chasedBranch();
    const lines = await reviewAnnounceLines({
      branch: "feature",
      concurrency: 1,
      count: 1,
      diff: { bytes: 42, repoRoot, sha256: "abcdef".repeat(10) },
      fallbackPort: port,
      home,
      propertyIds: ["r3-07"],
      supersessions: memorySupersessionPort(),
    });
    expect(lines.slice(0, 2)).toEqual([
      SCOPE,
      "CHASE: r3-07 (r3) came back BROKEN on its last 3 of 3 run(s) on this branch — each fix met a new counterexample",
    ]);
    expect(lines).toHaveLength(3);
  });

  it("leaves out a chase on a property that is not about to run", async () => {
    const { home, port, repoRoot } = await chasedBranch();
    const lines = await reviewAnnounceLines({
      branch: "feature",
      concurrency: 1,
      count: 1,
      diff: { bytes: 42, repoRoot, sha256: "abcdef".repeat(10) },
      fallbackPort: port,
      home,
      propertyIds: ["r3-08"],
      supersessions: memorySupersessionPort(),
    });
    expect(lines).toEqual([SCOPE]);
  });

  it("says the chase was skipped when the supersession register cannot be read, and still prints the scope", async () => {
    const { home, port, repoRoot } = await chasedBranch();
    const supersessions = unavailableSupersessionPort();
    const outage = unwrapErr(await supersessions.read({ home }));
    const lines = await reviewAnnounceLines({
      branch: "feature",
      concurrency: 1,
      count: 1,
      diff: { bytes: 42, repoRoot, sha256: "abcdef".repeat(10) },
      fallbackPort: port,
      home,
      propertyIds: ["r3-07"],
      supersessions,
    });
    expect(lines).toEqual([SCOPE, `property-chase reading skipped — ${outage.message}`]);
  });

  it("reads no history on a detached HEAD", async () => {
    const { home, port, repoRoot } = await chasedBranch();
    const lines = await reviewAnnounceLines({
      branch: null,
      concurrency: 1,
      count: 1,
      diff: { bytes: 42, repoRoot, sha256: "abcdef".repeat(10) },
      fallbackPort: port,
      home,
      propertyIds: ["r3-07"],
      supersessions: memorySupersessionPort(),
    });
    expect(lines).toEqual([SCOPE]);
  });

  it("says the chase was skipped when the store is down, and still announces the scope", async () => {
    const { home, repoRoot } = await chasedBranch();
    const lines = await reviewAnnounceLines({
      branch: "feature",
      concurrency: 1,
      count: 1,
      diff: { bytes: 42, repoRoot, sha256: "abcdef".repeat(10) },
      fallbackPort: unavailableFallbackRegisterPort(),
      home,
      propertyIds: ["r3-07"],
      supersessions: memorySupersessionPort(),
    });
    expect(lines).toEqual([
      SCOPE,
      `property-chase reading skipped — the fallback receipts could not be read: ${FALLBACK_FIXTURE_OUTAGE.message}`,
    ]);
  });
});
