/**
 * The golden-proof flow with every effect replaced through `GoldenProofDeps` — no VHS, Yarn, headless browser
 * or image compositor runs. The runner is built once and shared by both captures, which run before then
 * after inside one work directory; each side's `yarn why` text becomes a sorted, de-duplicated caption handed
 * to the compositor with the original labels and output path; both capture failures are reported together
 * with nothing read or composed; and the work directory is gone afterwards either way.
 */
import { existsSync } from "node:fs";
import { basename, dirname } from "node:path";

import { describe, expect, it } from "vitest";

import { err, ok, unwrap, unwrapErr } from "../../../../lib/result.js";
import type { captureYarnWhyPane } from "../../../../proof/yarnWhy/capture.js";
import type { composeGoldenProof } from "../../../../proof/yarnWhy/compose.js";
import { YarnWhyErrors } from "../../../../proof/yarnWhy/errors.js";
import { buildGoldenProof, type GoldenProofDeps } from "../../../../proof/yarnWhy/orchestrate.js";
import type { runYarnWhyText } from "../../../../proof/yarnWhy/runYarnWhy.js";
import type { VhsExec } from "../../../../proof/yarnWhy/vhsExec.js";

const BEFORE = { label: "before: main", worktree: "/worktrees/main" };
const AFTER = { label: "after: lodash bump", worktree: "/worktrees/bump" };

/** `yarn why lodash` text naming each version per worktree — duplicated and out of order on the before side. */
const WHY_TEXT: Readonly<Record<string, string>> = {
  "/worktrees/bump": "└─ app@workspace:.\n   └─ lodash@npm:4.17.21 (via npm:^4.17.21)\n",
  "/worktrees/main":
    "├─ app@workspace:.\n│  └─ lodash@npm:4.17.21 (via npm:^4.17.0)\n" +
    "└─ legacy@npm:1.0.0\n   ├─ lodash@npm:4.17.20 (via npm:4.17.20)\n   └─ lodash@npm:4.17.21 (via npm:^4.17.0)\n",
};

/** A runner nothing drives — the capture fake below never touches it. */
const RUNNER: VhsExec = { listFrames: () => [], runTape: () => {}, writeTape: () => {} };

/** Fakes for all four effects, recording every call in one ordered event list. */
function recordingDeps({ failCaptures }: { failCaptures: boolean }): {
  composed: Parameters<typeof composeGoldenProof>[0][];
  deps: GoldenProofDeps;
  events: string[];
  workDirs: { path: string; existedDuringCapture: boolean }[];
  runnersSeen: VhsExec[];
} {
  const events: string[] = [];
  const composed: Parameters<typeof composeGoldenProof>[0][] = [];
  const workDirs: { path: string; existedDuringCapture: boolean }[] = [];
  const runnersSeen: VhsExec[] = [];
  const capturePane: typeof captureYarnWhyPane = (request) => {
    const side = basename(request.tapePath, ".tape");
    events.push(`capture ${side} ${request.worktree} ${request.dependency} ${basename(request.framesDir)}`);
    workDirs.push({ existedDuringCapture: existsSync(dirname(request.tapePath)), path: dirname(request.tapePath) });
    runnersSeen.push(request.exec);
    if (failCaptures) {
      return err(
        YarnWhyErrors.captureFailed({
          cause: new Error(`${side} vhs exited 1`),
          dependency: request.dependency,
          worktree: request.worktree,
        }),
      );
    }
    return ok(`/frames/${side}.png`);
  };
  const readWhyText: typeof runYarnWhyText = (input) => {
    events.push(`why ${input.worktree} ${input.dependency}`);
    return WHY_TEXT[input.worktree]!;
  };
  const compose: typeof composeGoldenProof = async (input) => {
    events.push("compose");
    composed.push(input);
    return ok(undefined);
  };
  const createVhsRunner: GoldenProofDeps["createVhsRunner"] = () => {
    events.push("runner");
    return RUNNER;
  };
  return { composed, deps: { capturePane, compose, createVhsRunner, readWhyText }, events, runnersSeen, workDirs };
}

describe("buildGoldenProof", () => {
  it("builds the runner, captures before then after, reads before then after, and composes last", async () => {
    const { deps, events, runnersSeen } = recordingDeps({ failCaptures: false });

    const result = await buildGoldenProof({
      after: AFTER,
      before: BEFORE,
      dependency: "lodash",
      deps,
      outPath: "/out/proof.png",
    });

    expect(unwrap(result)).toBe(undefined);
    expect(events).toEqual([
      "runner",
      "capture before /worktrees/main lodash before-frames",
      "capture after /worktrees/bump lodash after-frames",
      "why /worktrees/main lodash",
      "why /worktrees/bump lodash",
      "compose",
    ]);
    expect(runnersSeen.map((runner) => runner === RUNNER)).toEqual([true, true]);
  });

  it("hands the compositor sorted, de-duplicated captions with the original labels, images and output path", async () => {
    const { composed, deps } = recordingDeps({ failCaptures: false });

    await buildGoldenProof({ after: AFTER, before: BEFORE, dependency: "lodash", deps, outPath: "/out/proof.png" });

    expect(composed).toEqual([
      {
        after: { imagePath: "/frames/after.png", label: "after: lodash bump", resolved: "lodash@npm:4.17.21" },
        before: {
          imagePath: "/frames/before.png",
          label: "before: main",
          resolved: "lodash@npm:4.17.20, lodash@npm:4.17.21",
        },
        dependency: "lodash",
        outPath: "/out/proof.png",
      },
    ]);
  });

  it("reports both capture failures in before/after order, reading and composing nothing", async () => {
    const { deps, events } = recordingDeps({ failCaptures: true });

    const error = unwrapErr(
      await buildGoldenProof({ after: AFTER, before: BEFORE, dependency: "lodash", deps, outPath: "/out/proof.png" }),
    );

    expect(error).toEqual([
      'vhs failed capturing "yarn why lodash" in /worktrees/main: before vhs exited 1',
      'vhs failed capturing "yarn why lodash" in /worktrees/bump: after vhs exited 1',
    ]);
    expect(events).toEqual([
      "runner",
      "capture before /worktrees/main lodash before-frames",
      "capture after /worktrees/bump lodash after-frames",
    ]);
  });

  it("captures both sides inside one work directory that existed during the run and is removed after a success", async () => {
    const { deps, workDirs } = recordingDeps({ failCaptures: false });

    await buildGoldenProof({ after: AFTER, before: BEFORE, dependency: "lodash", deps, outPath: "/out/proof.png" });

    expect(workDirs).toHaveLength(2);
    expect(workDirs[1]!.path).toBe(workDirs[0]!.path);
    expect(workDirs.map(({ existedDuringCapture }) => existedDuringCapture)).toEqual([true, true]);
    expect(existsSync(workDirs[0]!.path)).toBe(false);
  });

  it("removes the work directory after a capture failure too", async () => {
    const { deps, workDirs } = recordingDeps({ failCaptures: true });

    await buildGoldenProof({ after: AFTER, before: BEFORE, dependency: "lodash", deps, outPath: "/out/proof.png" });

    expect(workDirs[0]!.existedDuringCapture).toBe(true);
    expect(existsSync(workDirs[0]!.path)).toBe(false);
  });
});
