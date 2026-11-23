import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { requestGround } from "../../../../../cli/commands/codex/fallbackReviewGround.js";
import { EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import type { FallbackCapEvidence } from "../../../../../codex/fallbackReview.js";
import type { ReviewDiff } from "../../../../../codex/gitDiff.js";
import {
  CODEX_UNREGISTERED_REVIEW_MODE,
  type CodexProviderUnregisteredEvidence,
} from "../../../../../codex/providerUnregistered.js";
import type { CodexPassTree } from "../../../../../codex/types.js";

const CAP: FallbackCapEvidence = {
  blockedBy: "spend cap",
  limitId: null,
  observedAtIso: "2026-09-23T06:00:00.000Z",
  reachedType: null,
};
const UNREGISTERED: CodexProviderUnregisteredEvidence = {
  kind: "codex-provider-unregistered",
  observedAtIso: "2026-11-04T21:00:00.000Z",
  why: "the adopted plan register carries no Codex plan",
};
const DIFF: ReviewDiff = {
  baseSha: "b".repeat(40),
  bytes: 120,
  headSha: "a".repeat(40),
  repoRoot: "/w/repo",
  sha256: "d".repeat(64),
  text: "diff",
};
const TREE: CodexPassTree = { branch: "feature", dirtyBytes: 0, fingerprint: "fp-1", headSha: "a".repeat(40) };
const ARGS = { pass: "r3" as const, property: { id: "r3-01", statement: "a claim" } };

let home: string | undefined;

afterEach(() => {
  if (home !== undefined) {
    rmSync(home, { force: true, recursive: true });
  }
  home = undefined;
});

describe("requestGround", () => {
  it("stands on the cap prepare already read when no --after-refusal was given", () => {
    home = mkdtempSync(join(tmpdir(), "sw-fbground-"));
    expect(
      requestGround({
        afterRefusal: undefined,
        args: ARGS,
        diff: DIFF,
        fleetGround: { evidence: CAP, kind: "cap" },
        home,
        tree: TREE,
      }),
    ).toEqual({ capEvidence: CAP });
  });

  it("stands on the unregistered ground under its own mode, carrying no cap evidence", () => {
    home = mkdtempSync(join(tmpdir(), "sw-fbground-"));
    expect(
      requestGround({
        afterRefusal: undefined,
        args: ARGS,
        diff: DIFF,
        fleetGround: { evidence: UNREGISTERED, kind: "unregistered" },
        home,
        tree: TREE,
      }),
    ).toEqual({ ground: UNREGISTERED, mode: CODEX_UNREGISTERED_REVIEW_MODE });
  });

  it("refuses as a usage error an --after-refusal naming no readable pass record", () => {
    home = mkdtempSync(join(tmpdir(), "sw-fbground-"));
    expect(
      requestGround({ afterRefusal: "no-such-pass", args: ARGS, diff: DIFF, fleetGround: undefined, home, tree: TREE }),
    ).toBe(EXIT_USAGE);
  });
});
