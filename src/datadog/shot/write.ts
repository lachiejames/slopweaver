/**
 * Getting a capture's bytes safely onto disk, and refusing the ones that are not evidence.
 *
 * The rule it enforces is the one this whole module exists for: **a capture is graded before it is
 * reported, and a failed grade throws the bytes away rather than warning about them.** The worst failure a
 * proof tool has is a silent bad proof, which gets believed where a crash would get fixed.
 *
 * Nothing here may launch a browser — the owner's ruling (`docs/browser-route.md`; what it
 * retired, `docs/browser-route/screenshot-reading-and-retirement.md`). The bytes arrive one of two ways: a
 * file the operator captured (`shot file`, through {@link gradeAndCommit}), or the PNG the Playwright relay
 * took in the owner's own Chrome (`shot monitor`, through {@link gradeAndCommitBytes}). Both go through one grade,
 * which is the part that makes either of them evidence.
 *
 * Every capture is written to a sibling `.partial` file and committed onto the caller's path only after it
 * grades, so a refusal leaves any existing file at the target untouched. A failed run can never
 * half-replace yesterday's good proof with today's bad one.
 */

import { copyFileSync, readFileSync, rmSync, writeFileSync } from "node:fs";

import { err, ok, type Result } from "../../lib/result.js";
import { writeFileAtomicBytes } from "../../lib/writeAtomic.js";
import { type DatadogShotError, DatadogShotErrors } from "./errors.js";
import { gradeCapture, type PngDimensions, pngDimensions } from "./imageCheck.js";

/** Where a capture is written before it has been graded. */
function stagingPathFor({ path }: { path: string }): string {
  return `${path}.partial`;
}

/**
 * Grade a just-written capture and move it onto its final path, or throw the whole thing away.
 *
 * @param stagingPath where the capture was written
 * @param finalPath where a graded capture belongs
 * @returns what the graded image declares, or why nothing was kept
 */
function commitCapture({
  stagingPath,
  finalPath,
}: {
  stagingPath: string;
  finalPath: string;
}): Result<PngDimensions, DatadogShotError> {
  const read = readStaged({ stagingPath });
  if (read.isErr()) {
    return err(read.error);
  }
  const graded = gradeStaged({ bytes: read.value, finalPath });
  if (graded.isErr()) {
    rmSync(stagingPath, { force: true });
    return err(graded.error);
  }
  try {
    writeFileAtomicBytes({ bytes: read.value, path: finalPath });
  } catch (cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    rmSync(stagingPath, { force: true });
    return err(DatadogShotErrors.outputUnwritable({ detail, path: finalPath }));
  }
  rmSync(stagingPath, { force: true });
  return ok(graded.value);
}

/** Read back what the browser just wrote, turning a missing or unreadable staging file into the typed error. */
function readStaged({ stagingPath }: { stagingPath: string }): Result<Buffer, DatadogShotError> {
  try {
    return ok(readFileSync(stagingPath));
  } catch (cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return err(DatadogShotErrors.outputUnwritable({ detail, path: stagingPath }));
  }
}

/** Grade the staged bytes: a readable PNG header, and a real area. */
function gradeStaged({
  bytes,
  finalPath,
}: {
  bytes: Buffer;
  finalPath: string;
}): Result<PngDimensions, DatadogShotError> {
  const dimensions = pngDimensions({ bytes });
  if (dimensions.isErr()) {
    return err(DatadogShotErrors.imageUnusable({ detail: dimensions.error.message, path: finalPath }));
  }
  return gradeCapture({ byteLength: bytes.byteLength, dimensions: dimensions.value, path: finalPath });
}

/**
 * Grade an image the operator captured and commit it — the whole write path in one step.
 *
 * The source is COPIED to the staging path rather than graded in place, so the same rule holds as when a
 * browser wrote it: a refusal throws away only the copy, and never touches either the operator's own file
 * or whatever good capture already sits at the destination.
 *
 * @param sourcePath the PNG as captured
 * @param imagePath where a graded capture belongs
 * @returns what the graded image declares, or why nothing was kept
 */
export function gradeAndCommit({
  sourcePath,
  imagePath,
}: {
  sourcePath: string;
  imagePath: string;
}): Result<PngDimensions, DatadogShotError> {
  const staging = stagingPathFor({ path: imagePath });
  try {
    copyFileSync(sourcePath, staging);
  } catch (cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return err(DatadogShotErrors.outputUnwritable({ detail, path: sourcePath }));
  }
  return commitCapture({ finalPath: imagePath, stagingPath: staging });
}

/**
 * Grade bytes this verb produced and commit them — the same write path, for a capture this verb took.
 *
 * Written to the staging path first so the grade and the atomic move are the ones {@link gradeAndCommit}
 * runs: a capture that fails its grade leaves whatever good proof already sits at `imagePath` untouched.
 *
 * @param bytes the PNG to file — for `shot monitor`, the viewport capture already cut to the marked panel
 * @param imagePath where a graded capture belongs
 * @returns what the graded image declares, or why nothing was kept
 */
export function gradeAndCommitBytes({
  bytes,
  imagePath,
}: {
  bytes: Uint8Array;
  imagePath: string;
}): Result<PngDimensions, DatadogShotError> {
  const staging = stagingPathFor({ path: imagePath });
  try {
    writeFileSync(staging, bytes);
  } catch (cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return err(DatadogShotErrors.outputUnwritable({ detail, path: staging }));
  }
  return commitCapture({ finalPath: imagePath, stagingPath: staging });
}
