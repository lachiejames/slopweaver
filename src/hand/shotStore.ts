/**
 * Where a hand step's picture lives: `$SLOPWEAVER_HOME/hand-steps/shots/<sha[0:2]>/<sha256>`, the exact bytes
 * posted, named by their SHA-256 — `../corpus/contentStore.ts`'s naming and sharding, the one content-addressing
 * scheme in this repository.
 *
 * The step row records the hash, never a path (`./shot.ts`), so the card draws the bytes that were posted rather
 * than whatever sits at a path on the day the owner reads it. The console serves a blob only after re-hashing it
 * (`site/lib/draftMediaServe.ts`), so a blob changed under its name is refused rather than shown.
 *
 * Directories `0700`, files `0600`: a provider page can carry an account name or a key's prefix, so it is as private
 * as anything else under the home. A symbolic link anywhere between the home and the blob is refused before any
 * write, exactly as `../admit/slackDraftMediaStore.ts` refuses one, because following it would put the picture
 * outside the owner-only store. Identical bytes are held once and may back several steps, so the one delete here
 * takes back only a picture the refused post itself created.
 */
import { chmodSync, existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname } from "node:path";

import { firstLinkedEntry } from "#lib/pathContainment.js";
import { err, ok, type Result } from "#lib/result.js";
import { writeFileAtomicBytes } from "#lib/writeAtomic.js";
import { contentDigest, contentPath } from "../corpus/contentStore.js";
import { stateHomePaths } from "../stateHome.js";

import type { HandStepError } from "./errors.js";
import { pngSize } from "./shot.js";
import { type HandShotError, HandShotErrors } from "./shotErrors.js";

/** Owner-only permissions: a provider page can carry what only the owner should see. */
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/** The largest picture `hand post --shot` takes — a full-page 2x capture is a few MiB; past this is not a screenshot. */
const SHOT_BYTES_CAP = 16 * 1024 * 1024;

/** A picture read and checked, not yet stored: its bytes, their name, and the size its PNG header declares. */
export interface ReadShot {
  readonly bytes: Buffer;
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
}

/**
 * Where a picture with this hash lives under a home.
 *
 * @param home the state home the store lives under
 * @param sha256 the lowercase-hex SHA-256 the step records
 * @returns the absolute blob path, sharded on the hash's first two characters
 */
export function handShotPath({ home, sha256 }: { home: string; sha256: string }): string {
  return contentPath({ digest: sha256, root: stateHomePaths({ home }).handShots });
}

/**
 * The first entry below the home, on the way to a blob, that is a symbolic link, or `undefined` when none is.
 *
 * @returns the linked path, or `undefined`
 */
function linkedEntry({ home, path }: { home: string; path: string }): string | undefined {
  // `handShots` is `<home>/hand-steps/shots`, so two levels up is the home exactly as `stateHome.ts` spells it.
  return firstLinkedEntry({ path, top: dirname(dirname(stateHomePaths({ home }).handShots)) });
}

/**
 * Read the PNG `hand post --shot` names and check it is one, writing nothing — the step is judged before the
 * picture is stored, so a refused posting leaves no blob behind it.
 *
 * @param path the PNG as the poster named it
 * @returns the bytes, their hash and the picture's size, or why it is not a picture a step can carry
 */
export function readHandShot({ path }: { path: string }): Result<ReadShot, HandShotError | HandStepError> {
  let bytes: Buffer;
  try {
    // Sized before it is read, so a path naming something huge is refused without loading it.
    const { size } = statSync(path);
    if (size > SHOT_BYTES_CAP) {
      return err(
        HandShotErrors.shotStore({
          path,
          why: `is ${String(size)} bytes, past the ${String(SHOT_BYTES_CAP)} a screenshot needs`,
        }),
      );
    }
    bytes = readFileSync(path);
  } catch (cause: unknown) {
    return err(HandShotErrors.shotStore({ cause, path, why: "could not be read" }));
  }
  const size = pngSize({ bytes });
  if (size.isErr()) {
    return err(size.error);
  }
  return ok({ bytes, height: size.value.height, sha256: contentDigest({ bytes }), width: size.value.width });
}

/**
 * Store a picture {@link readHandShot} read under the home, by its hash.
 *
 * Idempotent: the same bytes land at the same name, and a second posting rewrites them identically. The modes are
 * settled after the write rather than trusted from it, since a recursive create never changes a directory it finds
 * and the umask can narrow what it asks for.
 *
 * @param home the state home the store lives under
 * @param shot the checked picture
 * @returns the blob's path and whether this call created it, or why it was not stored
 */
export function storeHandShot({
  home,
  shot,
}: {
  home: string;
  shot: ReadShot;
}): Result<{ path: string; created: boolean }, HandShotError> {
  const { bytes, sha256 } = shot;
  const blob = handShotPath({ home, sha256 });
  const linked = linkedEntry({ home, path: blob });
  if (linked !== undefined) {
    return err(
      HandShotErrors.shotStore({ path: linked, why: "is a symbolic link, so the store would leave the home" }),
    );
  }
  const created = !existsSync(blob);
  try {
    writeFileAtomicBytes({ bytes, dirMode: DIR_MODE, fileMode: FILE_MODE, path: blob });
    chmodSync(stateHomePaths({ home }).handShots, DIR_MODE);
    chmodSync(dirname(blob), DIR_MODE);
    chmodSync(blob, FILE_MODE);
  } catch (cause: unknown) {
    return err(HandShotErrors.shotStore({ cause, path: blob, why: "could not be written" }));
  }
  return ok({ created, path: blob });
}

/**
 * Take back a picture a refused post stored, so a refusal leaves nothing behind. Only one this post CREATED: a blob
 * that was already there is another step's too, since the store names a picture by its bytes.
 *
 * @param stored what {@link storeHandShot} returned for the post
 * @returns why it could not be removed, or `undefined` when it was removed or was never this post's
 */
export function discardHandShot({ stored }: { stored: { path: string; created: boolean } }): string | undefined {
  if (!stored.created) {
    return undefined;
  }
  try {
    rmSync(stored.path, { force: true });
  } catch (cause: unknown) {
    return cause instanceof Error ? cause.message : `${stored.path} could not be removed`;
  }
  return undefined;
}
