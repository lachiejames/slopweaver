/**
 * The picture half of `slopweaver hand post`: `--shot` and its `--box` flags read into the draft's `shot`, and the
 * order the picture is stored in relative to the row that names it.
 *
 * Two orderings are the design. The picture is read and checked before the step is built and stored only after
 * admission, so a refusal decided before the append writes nothing. And it is stored BEFORE the row is appended,
 * so a row never names a picture that is not there — with a refused append taking back a picture this post created.
 */
import type { HandStepError } from "../../../hand/errors.js";
import { appendHandPost, type HandPostReceipt } from "../../../hand/multiAppend.js";
import { type HandShot, parseBoxFlag, type ShotBox } from "../../../hand/shot.js";
import type { HandShotError } from "../../../hand/shotErrors.js";
import { discardHandShot, type ReadShot, readHandShot, storeHandShot } from "../../../hand/shotStore.js";
import type { HandStep } from "../../../hand/step.js";
import type { RowAdmission } from "../../../hand/store.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { repeatedFlagValues } from "../../parseFlags.js";

import { flag, type HandDeps } from "./deps.js";
import { type HandPostArgsError, HandPostArgsErrors } from "./postArgsErrors.js";

/** The paired flags as typed: the PNG's path and each `--box` value. */
export interface ShotFlags {
  readonly path: string;
  readonly boxes: readonly string[];
}

/**
 * `--shot` and its `--box` flags, paired: both or neither, never one without the other.
 *
 * @param values every parsed flag
 * @param rest the argv tail, which holds every `--box` (the parser keeps only the last)
 * @returns the picture's path and the boxes as typed, `undefined` when neither was passed, or the refusal
 */
export function shotFlagsOf({
  values,
  rest,
}: {
  values: Readonly<Record<string, unknown>>;
  rest: readonly string[];
}): Result<ShotFlags | undefined, HandPostArgsError> {
  const path = flag({ name: "shot", values });
  const boxes = repeatedFlagValues({ name: "box", rest });
  if (path === undefined && boxes.length === 0) {
    return ok(undefined);
  }
  if (path === undefined || boxes.length === 0) {
    return err(HandPostArgsErrors.shotUnpaired({ hasShot: path !== undefined }));
  }
  return ok({ boxes, path });
}

/**
 * The picture `--shot` names, read and checked, with its boxes parsed — the draft's `shot`, which `buildHandStep`
 * then judges against the picture's own size. Nothing is stored here: a refused posting leaves no blob.
 *
 * @param shot the paired flags, or `undefined` for a step without a picture
 * @returns the read picture and the draft field, `undefined` without one, or the first refusal
 */
export function shotDraftOf({
  shot,
}: {
  shot: ShotFlags | undefined;
}): Result<{ read: ReadShot; draft: HandShot } | undefined, HandShotError | HandStepError> {
  if (shot === undefined) {
    return ok(undefined);
  }
  const read = readHandShot({ path: shot.path });
  if (read.isErr()) {
    return err(read.error);
  }
  const boxes: ShotBox[] = [];
  for (const value of shot.boxes) {
    const box = parseBoxFlag({ value });
    if (box.isErr()) {
      return err(box.error);
    }
    boxes.push(box.value);
  }
  const { height, sha256, width } = read.value;
  return ok({ draft: { boxes, height, sha256, width }, read: read.value });
}

/**
 * Store the step's picture, then append the row that names it — so a row never names a picture that is not there —
 * and take a picture this post created back out when the append refuses, so a refused post leaves nothing behind.
 *
 * @param deps the diagnostic channel every refusal is written to
 * @param home the state home the store and the register live under
 * @param nowIso the instant the append is stamped with
 * @param read the checked picture, or `undefined` for a step without one
 * @param step the admitted step
 * @param supersedes the id the step re-cuts, when it re-cuts one
 * @param admitRow the register's check on the board row the step names, run inside the append's lock
 * @returns the append's receipt, or `undefined` once the refusal has been written
 */
export async function appendWithPicture({
  deps,
  home,
  nowIso,
  read,
  step,
  supersedes,
  admitRow,
}: {
  deps: HandDeps;
  home: string;
  nowIso: string;
  read: ReadShot | undefined;
  step: HandStep;
  supersedes: string | undefined;
  admitRow: RowAdmission;
}): Promise<HandPostReceipt | undefined> {
  let stored: { path: string; created: boolean } | undefined;
  if (read !== undefined) {
    const kept = storeHandShot({ home, shot: read });
    if (kept.isErr()) {
      deps.writeDiagnostic(`hand post: ${kept.error.message}`);
      return undefined;
    }
    stored = kept.value;
  }
  const written = await appendHandPost({ admitRow, home, nowIso, step, supersedes });
  if (written.isOk()) {
    return written.value;
  }
  deps.writeDiagnostic(`hand post: ${written.error.message}`);
  const left = stored === undefined ? undefined : discardHandShot({ stored });
  if (left !== undefined) {
    deps.writeDiagnostic(`  the picture it stored could not be taken back out — ${left}`);
  }
  return undefined;
}
