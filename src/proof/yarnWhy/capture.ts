/**
 * Orchestrating one `yarn why` capture pane: build the tape, write it, run VHS in the worktree, and hand
 * back the settled frame it recorded.
 *
 * Split from {@link ./vhsExec.js} so this ordering is testable against a hand-written recording fake — no
 * `vhs` process ever starts in a test, matching the pattern `cmux/spawn.ts` established for the same
 * reason. There is no poll loop here any more: the tape's own `Wait` is the real completion signal, and
 * VHS fails the run when it times out ({@link ./tape.js} carries both measurements).
 */
import { join } from "node:path";

import { err, ok, type Result } from "../../lib/result.js";
import { type YarnWhyError, YarnWhyErrors } from "./errors.js";
import { buildCaptureTape, lastTextFrame } from "./tape.js";
import type { VhsExec } from "./vhsExec.js";

/** One capture pane's inputs. */
export interface CapturePaneRequest {
  readonly exec: VhsExec;
  readonly worktree: string;
  readonly dependency: string;
  readonly tapePath: string;
  readonly framesDir: string;
}

/**
 * Run one `yarn why <dependency>` capture pane end to end, invisibly: no window is opened, because VHS
 * serves the pty through `ttyd` on loopback and renders it headlessly.
 *
 * @param exec the VHS-driving seam (real or a test fake)
 * @param worktree the absolute worktree path VHS runs from, which the recorded pty inherits
 * @param dependency the dependency name to query
 * @param tapePath where to write this pane's tape
 * @param framesDir the absolute directory the tape records into
 * @returns the captured frame's path, or the refusal or VHS's own failure message
 */
export function captureYarnWhyPane({
  exec,
  worktree,
  dependency,
  tapePath,
  framesDir,
}: CapturePaneRequest): Result<string, YarnWhyError> {
  const tape = buildCaptureTape({ dependency, framesDir });
  if (tape.isErr()) {
    return err(tape.error);
  }

  exec.writeTape({ path: tapePath, source: tape.value });
  try {
    exec.runTape({ cwd: worktree, tapePath });
  } catch (error: unknown) {
    return err(YarnWhyErrors.captureFailed({ cause: error, dependency, worktree }));
  }

  const frame = lastTextFrame({ names: exec.listFrames({ dir: framesDir }) });
  if (frame === undefined) {
    return err(YarnWhyErrors.noFrames({ dependency, worktree }));
  }
  return ok(join(framesDir, frame));
}
