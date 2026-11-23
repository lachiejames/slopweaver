/**
 * The top-level golden-proof flow: capture both panes for real (invisibly, through VHS — see
 * {@link ./tape.js}), extract each side's real resolved-version text, and compose the pair.
 *
 * The two panes are captured one after the other rather than at once: each is a whole `vhs` run, and there
 * is no window to keep out of the way any more, so the concurrency the retired AppleScript path needed
 * bought nothing here beyond a second `ttyd` server and headless browser fighting for the same machine.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { err, type Result } from "../../lib/result.js";
import { captureYarnWhyPane } from "./capture.js";
import { composeGoldenProof } from "./compose.js";
import { yarnWhyErrorLines } from "./errors.js";
import { extractResolvedVersion } from "./resolvedVersion.js";
import { runYarnWhyText } from "./runYarnWhy.js";
import { realVhsExec, type VhsExec } from "./vhsExec.js";

/** One side's inputs: the worktree it runs in, and the label shown above its pane. */
export interface GoldenProofSide {
  readonly worktree: string;
  readonly label: string;
}

/**
 * The four effects the flow drives — the VHS runner, each pane's capture, each side's `yarn why` text and the
 * compositor — so a test can supply fakes and no VHS, Yarn, headless browser or image library runs.
 */
export interface GoldenProofDeps {
  /** Build the VHS runner both captures share; called once per proof, before either capture. */
  readonly createVhsRunner: () => VhsExec;
  readonly capturePane: typeof captureYarnWhyPane;
  readonly readWhyText: typeof runYarnWhyText;
  readonly compose: typeof composeGoldenProof;
}

/** The production {@link GoldenProofDeps}: real VHS, a real `yarn why`, the real compositor. */
const PRODUCTION_GOLDEN_PROOF_DEPS: GoldenProofDeps = {
  capturePane: captureYarnWhyPane,
  compose: composeGoldenProof,
  createVhsRunner: realVhsExec,
  readWhyText: runYarnWhyText,
};

/**
 * Run the full golden-proof flow for one dependency across two worktrees, writing the composed image to
 * `outPath`.
 *
 * @param dependency the dependency name to query with `yarn why`
 * @param before the "before" side (worktree + label)
 * @param after the "after" side (worktree + label)
 * @param outPath where to write the composed PNG
 * @param deps the runner, capture, text read and compositor; the real ones unless a test supplies fakes
 * @returns ok once the file is written, or every step's accumulated error messages
 */
export async function buildGoldenProof({
  dependency,
  before,
  after,
  outPath,
  deps = PRODUCTION_GOLDEN_PROOF_DEPS,
}: {
  dependency: string;
  before: GoldenProofSide;
  after: GoldenProofSide;
  outPath: string;
  deps?: GoldenProofDeps;
}): Promise<Result<void>> {
  const workDir = mkdtempSync(join(tmpdir(), "slopweaver-golden-proof-"));
  try {
    const runner = deps.createVhsRunner();
    const beforeCapture = deps.capturePane({
      dependency,
      exec: runner,
      framesDir: join(workDir, "before-frames"),
      tapePath: join(workDir, "before.tape"),
      worktree: before.worktree,
    });
    const afterCapture = deps.capturePane({
      dependency,
      exec: runner,
      framesDir: join(workDir, "after-frames"),
      tapePath: join(workDir, "after.tape"),
      worktree: after.worktree,
    });
    const captureErrors = [beforeCapture, afterCapture]
      .filter((result) => result.isErr())
      .flatMap((result) => yarnWhyErrorLines({ error: result._unsafeUnwrapErr() }));
    if (captureErrors.length > 0) {
      return err(captureErrors);
    }
    const beforePng = beforeCapture._unsafeUnwrap();
    const afterPng = afterCapture._unsafeUnwrap();

    const beforeResolved = extractResolvedVersion({
      dependency,
      output: deps.readWhyText({ dependency, worktree: before.worktree }),
    });
    const afterResolved = extractResolvedVersion({
      dependency,
      output: deps.readWhyText({ dependency, worktree: after.worktree }),
    });

    const composed = await deps.compose({
      after: { imagePath: afterPng, label: after.label, resolved: afterResolved },
      before: { imagePath: beforePng, label: before.label, resolved: beforeResolved },
      dependency,
      outPath,
    });
    return composed.mapErr((error) => yarnWhyErrorLines({ error }));
  } finally {
    rmSync(workDir, { force: true, recursive: true });
  }
}
