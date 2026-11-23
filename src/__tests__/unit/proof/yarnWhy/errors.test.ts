/**
 * The golden-proof pipeline's typed failures: each variant built through its factory, with its code and the exact
 * lines {@link yarnWhyErrorLines} renders.
 */
import { describe, expect, it } from "vitest";

import { YarnWhyErrors, yarnWhyErrorLines } from "../../../../proof/yarnWhy/errors.js";

describe("YarnWhyErrors", () => {
  it("wraps every input problem and renders each reason on its own line, in order", () => {
    const error = YarnWhyErrors.inputRefused({
      problems: [
        YarnWhyErrors.packageNameUnsafe({ dependency: "a b" }),
        YarnWhyErrors.framesDirRelative({ framesDir: "x" }),
        YarnWhyErrors.framesDirTapeUnsafe({ framesDir: "x" }),
      ],
    });

    expect(error.code).toBe("INPUT_REFUSED");
    expect(error.problems.map((problem) => problem.code)).toEqual([
      "PACKAGE_NAME_UNSAFE",
      "FRAMES_DIR_RELATIVE",
      "FRAMES_DIR_TAPE_UNSAFE",
    ]);
    expect(yarnWhyErrorLines({ error })).toEqual([
      "not a package name, so it will not be typed: a b",
      "frames directory must be absolute, got x",
      "frames directory cannot be written into a VHS tape: x",
    ]);
  });

  it("renders a capture failure as its one message, carrying a non-Error cause as text", () => {
    const error = YarnWhyErrors.captureFailed({ cause: "boom", dependency: "left-pad", worktree: "/wt" });

    expect(error.code).toBe("CAPTURE_FAILED");
    expect(yarnWhyErrorLines({ error })).toEqual([`vhs failed capturing "yarn why left-pad" in /wt: boom`]);
  });

  it("renders the no-frames, output-path and compose failures as one message each", () => {
    const noFrames = YarnWhyErrors.noFrames({ dependency: "left-pad", worktree: "/wt" });
    const badPath = YarnWhyErrors.outputPathInvalid({ outPath: "out.jpg" });
    const composeFailed = YarnWhyErrors.composeFailed({ cause: new Error("disk full") });

    expect([noFrames.code, badPath.code, composeFailed.code]).toEqual([
      "NO_FRAMES",
      "OUTPUT_PATH_INVALID",
      "COMPOSE_FAILED",
    ]);
    expect(yarnWhyErrorLines({ error: noFrames })).toEqual([`vhs recorded no frames for "yarn why left-pad" in /wt`]);
    expect(yarnWhyErrorLines({ error: badPath })).toEqual([
      "golden-proof compose failed: outPath must end in .png, got out.jpg",
    ]);
    expect(yarnWhyErrorLines({ error: composeFailed })).toEqual(["golden-proof compose failed: disk full"]);
  });
});
