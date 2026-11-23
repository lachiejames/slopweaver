/**
 * The third-review-pass refusal, read over a real state home and a real checkout: two reviewed diffs refuse a
 * third before anything is spent, a diff already reviewed still runs, the hatch lets a third through and says
 * so, and a fold it cannot read refuses unless the hatch is open.
 *
 * Zero mocks: the passes are Claude fallback receipts written through the in-memory register port — the cap is
 * on review, not on a provider, so they spend the same two passes a Codex row does.
 */

import { mkdirSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import { ALLOW_CODEX_REVIEW_PASS_CAP_ENV, reviewCapVerdict } from "../../../../../cli/commands/codex/reviewCapGate.js";
import type { FallbackRegisterPort } from "../../../../../codex/fallbackPort.js";
import { resolveRepoRoot } from "../../../../../codex/gitDiff.js";
import { hatchFor } from "../../../../../hatch/lookup.js";
import { unwrap } from "../../../../../lib/result.js";
import { stateHomePaths } from "../../../../../stateHome.js";
import {
  FALLBACK_FIXTURE_OUTAGE,
  memoryFallbackRegisterPort,
  unavailableFallbackRegisterPort,
} from "../../../../fallbackRegisterFixture.js";
import { memorySupersessionPort } from "../../../../landingRegistersFixture.js";
import { REAL_GIT_TIMEOUT_MS } from "../../../../tempGitRepo.js";
import { diffAtMinute, recordFallback, removeScratch, scratch, scratchRepo } from "./fallbackBranchFixture.js";

afterEach(() => {
  removeScratch();
});

const VERB = "codex review";

/** A home and a checkout whose branch has had `minutes.length` review passes, one distinct diff each. */
async function reviewedBranch({
  minutes,
}: {
  minutes: readonly number[];
}): Promise<{ home: string; port: FallbackRegisterPort; repoRoot: string }> {
  const home = scratch({ label: "home" });
  mkdirSync(stateHomePaths({ home }).orchestration, { recursive: true });
  const dir = scratchRepo();
  const port = memoryFallbackRegisterPort();
  for (const minute of minutes) {
    await recordFallback({ dir, home, minute, port, propertyId: "r3-07", verdict: "BROKEN" });
  }
  return { home, port, repoRoot: unwrap(resolveRepoRoot({ cwd: dir })) };
}

describe("reviewCapVerdict", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it("lets the second pass run over a new diff, and says which pass it is", async () => {
    const { home, port, repoRoot } = await reviewedBranch({ minutes: [10] });
    const verdict = await reviewCapVerdict({
      branch: "feature",
      diff: { repoRoot, sha256: diffAtMinute({ minute: 20 }) },
      env: {},
      fallbackPort: port,
      home,
      supersessions: memorySupersessionPort(),
      verb: VERB,
    });
    expect(verdict).toEqual({ lines: ["codex review: review pass 2 of 2 on feature"], refused: false });
  });

  it("refuses a third diff before anything is spent, naming both reviewed diffs and the hatch", async () => {
    const { home, port, repoRoot } = await reviewedBranch({ minutes: [10, 20] });
    const verdict = await reviewCapVerdict({
      branch: "feature",
      diff: { repoRoot, sha256: diffAtMinute({ minute: 30 }) },
      env: {},
      fallbackPort: port,
      home,
      supersessions: memorySupersessionPort(),
      verb: VERB,
    });
    const hatch = hatchFor({ id: "codex-review-pass-cap" });
    expect(verdict.refused).toBe(true);
    expect(verdict.lines).toEqual([
      `${hatch.command} blocked because ${hatch.caught} (feature has had its two review passes (diffs ` +
        "dddddddddddd… and dddddddddddd…) and this diff (dddddddddddd…) would be a third — land it with every " +
        "finding still standing acknowledged as codex-loop-incomplete with a --reason (`codex status --check` " +
        "prints each one)).",
      `Legitimate exceptions may include ${hatch.exceptions.join("; ")}.`,
      `To override use the designated escape hatch ${ALLOW_CODEX_REVIEW_PASS_CAP_ENV}=1 ${hatch.command}.`,
      "Use good judgement to determine whether the owner would approve of this, then proceed or correct your approach.",
    ]);
  });

  it("still runs another property over a diff the branch already reviewed — that is the same pass", async () => {
    const { home, port, repoRoot } = await reviewedBranch({ minutes: [10, 20] });
    const verdict = await reviewCapVerdict({
      branch: "feature",
      diff: { repoRoot, sha256: diffAtMinute({ minute: 10 }) },
      env: {},
      fallbackPort: port,
      home,
      supersessions: memorySupersessionPort(),
      verb: VERB,
    });
    expect(verdict).toEqual({ lines: ["codex review: review pass 1 of 2 on feature"], refused: false });
  });

  it("runs a third pass under the hatch, and says it was one", async () => {
    const { home, port, repoRoot } = await reviewedBranch({ minutes: [10, 20] });
    const verdict = await reviewCapVerdict({
      branch: "feature",
      diff: { repoRoot, sha256: diffAtMinute({ minute: 30 }) },
      env: { [ALLOW_CODEX_REVIEW_PASS_CAP_ENV]: "1" },
      fallbackPort: port,
      home,
      supersessions: memorySupersessionPort(),
      verb: VERB,
    });
    expect(verdict).toEqual({
      lines: [
        "codex review: a THIRD review pass on feature, run by SLOPWEAVER_ALLOW_CODEX_REVIEW_PASS_CAP=1 — say why in the pull request",
      ],
      refused: false,
    });
  });

  it("refuses when the fold cannot be read, since it cannot tell this is not a third pass", async () => {
    const { home, repoRoot } = await reviewedBranch({ minutes: [10, 20] });
    const verdict = await reviewCapVerdict({
      branch: "feature",
      diff: { repoRoot, sha256: diffAtMinute({ minute: 30 }) },
      env: {},
      fallbackPort: unavailableFallbackRegisterPort(),
      home,
      supersessions: memorySupersessionPort(),
      verb: VERB,
    });
    const hatch = hatchFor({ id: "codex-review-pass-cap" });
    expect(verdict.refused).toBe(true);
    expect(verdict.lines[0]).toBe(
      `${hatch.command} blocked because ${hatch.caught} (which review pass this diff would be on feature cannot ` +
        `be told, so it might be a third: the fallback receipts could not be read: ${FALLBACK_FIXTURE_OUTAGE.message} ` +
        "— the landing floor refuses on the same read, so repair it first).",
    );
  });

  it("runs under the hatch when the fold cannot be read, and says so", async () => {
    const { home, repoRoot } = await reviewedBranch({ minutes: [10, 20] });
    const verdict = await reviewCapVerdict({
      branch: "feature",
      diff: { repoRoot, sha256: diffAtMinute({ minute: 30 }) },
      env: { [ALLOW_CODEX_REVIEW_PASS_CAP_ENV]: "1" },
      fallbackPort: unavailableFallbackRegisterPort(),
      home,
      supersessions: memorySupersessionPort(),
      verb: VERB,
    });
    expect(verdict).toEqual({
      lines: [
        "codex review: the two-pass review cap could not be checked (the fallback receipts could not be read: " +
          `${FALLBACK_FIXTURE_OUTAGE.message}), and SLOPWEAVER_ALLOW_CODEX_REVIEW_PASS_CAP=1 runs this review ` +
          "anyway — say why in the pull request",
      ],
      refused: false,
    });
  });

  it("refuses nothing on a detached HEAD, which no branch's count covers", async () => {
    const { home, port, repoRoot } = await reviewedBranch({ minutes: [10, 20] });
    const verdict = await reviewCapVerdict({
      branch: null,
      diff: { repoRoot, sha256: diffAtMinute({ minute: 30 }) },
      env: {},
      fallbackPort: port,
      home,
      supersessions: memorySupersessionPort(),
      verb: VERB,
    });
    expect(verdict).toEqual({ lines: [], refused: false });
  });
});
