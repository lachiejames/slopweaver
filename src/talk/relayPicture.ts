/**
 * The picture a relay carries — a frame of the screen the owner shared, stored beside the turn so the supervisor can
 * open it the way it opens a screenshot the owner pastes.
 *
 * Images of what the owner is looking at are often how the owner communicates directly with the supervisor. The
 * console takes the frame from a screen share the owner already opened from the voice widget — never a
 * capture of its own (`site/lib/screenFrame.ts` says why the share won) — and hands the verb a file. This
 * module is where that file is checked and kept.
 *
 * ## The verb re-checks what the route checked
 *
 * The route validates the data URL it was posted, and this module validates the FILE it was handed, because
 * the verb is callable without the route. Both check the same two things: a size bound and WebP's own magic
 * (`RIFF` at 0, `WEBP` at 8). Nothing decodes the image, so a WebP-shaped file of the right size passes; what
 * the check buys is that a relay cannot be used to park an arbitrary file under the home.
 *
 * ## One picture per turn, never replaced
 *
 * The destination is derived from the turn id, and the turn's digest carries the picture's sha256
 * (`relayDraft.ts`), so a retry carrying a different frame is a `RELAY_CONFLICT` before anything is written
 * here. What reaches {@link persistRelayPicture} with a file already in place is therefore a retry of the SAME
 * picture, and it is accepted only when the bytes on disk hash to the recorded digest. The first frame is
 * never overwritten by another, and the file a row names is always one the verb wrote itself.
 */
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { err, ok, type Result } from "../lib/result.js";
import { writeFileAtomicBytes } from "../lib/writeAtomic.js";
import { stateHomePaths } from "../stateHome.js";

import { type TalkError, TalkErrors } from "./errors.js";

/** The largest picture a relay may carry. A 2048-wide WebP of a busy screen is a few hundred KiB. */
export const RELAY_PICTURE_MAX_BYTES = 768 * 1024;

/**
 * Why a relay carries no picture: the owner had not shared their screen, a look at it (a share's frame or the desktop
 * app's own still) gave no frame, the desktop app's look was refused because macOS Screen Recording is off for it — no
 * share involved, and a permission the owner can grant — the turn was relayed before relays carried pictures at all,
 * the owner typed the steer on the console and attached no image, or their screen was shared but no frame was taken on
 * their word this turn — a relay never grabs one the owner did not ask for.
 */
export type NoPictureReason =
  | "screen-not-shared"
  | "capture-failed"
  | "screen-recording-off"
  | "predates-pictures"
  | "not-attached"
  | "not-taken-this-turn";

/** The picture a relay carries, or why it carries none. */
export type RelayPicture =
  | { readonly kind: "attached"; readonly path: string; readonly bytes: number; readonly sha256: string }
  | { readonly kind: "none"; readonly reason: NoPictureReason };

/** A picture ready to keep: what the row will name, and the bytes to write when there are any. */
export interface PreparedRelayPicture {
  readonly picture: RelayPicture;
  readonly data: Buffer | undefined;
}

/** Where a WebP's chunk list starts: after `RIFF`, its size field and `WEBP`. */
const WEBP_CHUNKS_AT = 12;

/** The first chunk a WebP may open with: lossy, lossless, or the extended header. */
const WEBP_FIRST_CHUNKS: ReadonlySet<string> = new Set(["VP8 ", "VP8L", "VP8X"]);

/** The chunks that carry the image itself; `VP8X` is only a header in front of one. */
const WEBP_IMAGE_CHUNKS: ReadonlySet<string> = new Set(["VP8 ", "VP8L"]);

/**
 * Whether bytes are a WebP by its container's structure, WITHOUT decoding it: `RIFF` at 0 whose size field is
 * the file's own length less eight, `WEBP` at 8, a first chunk that may open a WebP, every chunk (padded to
 * even) tiling the file exactly, and at least one of them a `VP8 ` or `VP8L` image chunk. A header-shaped
 * shell, or an extended header with no image behind it, is refused; a malformed bitstream inside an image
 * chunk is not seen, because nothing here decodes.
 *
 * @param bytes the file's contents
 * @returns `true` for a structurally whole WebP container carrying an image chunk
 */
export function isWebp({ bytes }: { bytes: Uint8Array }): boolean {
  const ascii = ({ from }: { from: number }): string => String.fromCharCode(...bytes.subarray(from, from + 4));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const opens =
    bytes.length >= WEBP_CHUNKS_AT + 8 &&
    ascii({ from: 0 }) === "RIFF" &&
    view.getUint32(4, true) === bytes.length - 8 &&
    ascii({ from: 8 }) === "WEBP" &&
    WEBP_FIRST_CHUNKS.has(ascii({ from: WEBP_CHUNKS_AT }));
  if (!opens) {
    return false;
  }
  let at = WEBP_CHUNKS_AT;
  let image = false;
  while (at + 8 <= bytes.length) {
    const size = view.getUint32(at + 4, true);
    image = image || WEBP_IMAGE_CHUNKS.has(ascii({ from: at }));
    at += 8 + size + (size % 2);
  }
  return image && at === bytes.length;
}

/**
 * Where one turn's picture is kept: beside its turn record.
 *
 * @param home the Slopweaver home
 * @param turnId the relay's turn
 * @returns the absolute path of `<turnId>.webp`
 */
export function relayPicturePath({ home, turnId }: { home: string; turnId: string }): string {
  return join(stateHomePaths({ home }).talkTurns, `${turnId}.webp`);
}

/**
 * Check the file a relay was handed and describe the picture it will carry — or say why it carries none.
 *
 * @param home the Slopweaver home the picture will be kept under
 * @param turnId the relay's turn, which names the destination
 * @param sourcePath the file the route wrote, or `undefined` when no picture was sent
 * @param screenNotTaken whether the share was open but no frame was taken on the owner's word this turn
 * @param screenFailed whether a look at the owner's screen, a share's frame or the desktop app's own still, gave no frame
 * @param screenRecordingOff whether the desktop app's look was refused because macOS Screen Recording is off for it
 * @param typed whether the owner typed the steer on the console, where a missing picture is an image they did not attach
 * @returns the prepared picture, or `PICTURE_INVALID`
 */
export function prepareRelayPicture({
  home,
  turnId,
  sourcePath,
  screenFailed,
  screenNotTaken,
  screenRecordingOff,
  typed,
}: {
  home: string;
  turnId: string;
  sourcePath: string | undefined;
  screenFailed: boolean;
  screenNotTaken: boolean;
  screenRecordingOff: boolean;
  typed: boolean;
}): Result<PreparedRelayPicture, TalkError> {
  if (sourcePath === undefined) {
    let reason: NoPictureReason = "screen-not-shared";
    if (typed) {
      reason = "not-attached";
    } else if (screenRecordingOff) {
      reason = "screen-recording-off";
    } else if (screenFailed) {
      reason = "capture-failed";
    } else if (screenNotTaken) {
      reason = "not-taken-this-turn";
    }
    return ok({ data: undefined, picture: { kind: "none", reason } });
  }
  // The supervisor line types the path, and a typed line cannot carry a control character: it would name a
  // different path than the one kept, so a home whose path holds one keeps no picture at all.
  const destination = relayPicturePath({ home, turnId });
  if (/\p{Cc}/u.test(destination)) {
    return err(
      TalkErrors.pictureInvalid({
        path: destination,
        why: "holds a control character, so no typed line could name it",
      }),
    );
  }
  const read = readPictureSource({ sourcePath });
  if (read.isErr()) {
    return err(read.error);
  }
  const data = read.value;
  return ok({
    data,
    picture: {
      bytes: data.length,
      kind: "attached",
      path: destination,
      sha256: createHash("sha256").update(data).digest("hex"),
    },
  });
}

/**
 * Read the file a relay was handed, refusing anything but a regular file within the cap that is a WebP.
 *
 * @returns the bytes read, or `PICTURE_INVALID`
 */
function readPictureSource({ sourcePath }: { sourcePath: string }): Result<Buffer, TalkError> {
  const tooBig = ({ size }: { size: number }): Result<Buffer, TalkError> =>
    err(
      TalkErrors.pictureInvalid({
        path: sourcePath,
        why: `is ${String(size)} bytes; a relay carries up to ${String(RELAY_PICTURE_MAX_BYTES)}`,
      }),
    );
  let data: Buffer;
  try {
    const stat = statSync(sourcePath);
    if (!stat.isFile()) {
      return err(TalkErrors.pictureInvalid({ path: sourcePath, why: "is not a regular file" }));
    }
    if (stat.size > RELAY_PICTURE_MAX_BYTES) {
      return tooBig({ size: stat.size });
    }
    data = readFileSync(sourcePath);
  } catch (cause) {
    const why = cause instanceof Error ? cause.message : String(cause);
    return err(TalkErrors.pictureInvalid({ path: sourcePath, why: `could not be read: ${why}` }));
  }
  // Measured again on the bytes READ: the stat above bounds the read, and the file can grow between the two.
  if (data.length > RELAY_PICTURE_MAX_BYTES) {
    return tooBig({ size: data.length });
  }
  if (!isWebp({ bytes: data })) {
    return err(
      TalkErrors.pictureInvalid({
        path: sourcePath,
        why: "is not a WebP image (no RIFF/WEBP container around an image chunk)",
      }),
    );
  }
  return ok(data);
}

/**
 * Keep a prepared picture at its turn's path, writing the bytes THIS run holds every time, so whatever file a
 * row names is one this verb wrote rather than one it found.
 *
 * The turn record is claimed BEFORE the picture is kept. A turn claimed just now has never kept a picture, so
 * whatever sits at its path is not this turn's and is atomically replaced — refusing it instead would leave the
 * claimed record behind, and the retry, reading as a resume, would adopt the file. A turn claimed
 * earlier (a replay, or a resume after a crash between keeping the file and registering the row) may find its
 * own picture there: the same bytes are rewritten, and anything else is refused, because the first frame is
 * never replaced.
 *
 * @param prepared what {@link prepareRelayPicture} returned
 * @param claimedNow whether this run's claim created the turn record, rather than finding one
 * @returns nothing on success, or `PICTURE_INVALID` when the write failed or something else holds the path
 */
export function persistRelayPicture({
  prepared,
  claimedNow,
}: {
  prepared: PreparedRelayPicture;
  claimedNow: boolean;
}): Result<void, TalkError> {
  const { picture, data } = prepared;
  if (picture.kind === "none" || data === undefined) {
    return ok(undefined);
  }
  try {
    const held = claimedNow ? undefined : heldPictureProblem({ path: picture.path, sha256: picture.sha256 });
    if (held !== undefined) {
      return err(TalkErrors.pictureInvalid({ path: picture.path, why: held }));
    }
    // A rename over the path: a symlink or a stale file there is replaced as an entry, never written through.
    writeFileAtomicBytes({ bytes: data, fileMode: 0o600, path: picture.path });
    return ok(undefined);
  } catch (cause) {
    const why = cause instanceof Error ? cause.message : String(cause);
    return err(TalkErrors.pictureInvalid({ path: picture.path, why: `could not be kept: ${why}` }));
  }
}

/**
 * Why an already-claimed turn may not keep its picture over what is at its path, if anything stops it.
 *
 * `lstat`, not `exists`: a symlink would pass a hash of whatever it points at today, so anything there that
 * is not a regular file is refused before its bytes are read.
 *
 * @returns the refusal's reason, or `undefined` when the path is empty or holds this turn's own bytes
 */
function heldPictureProblem({ path, sha256 }: { path: string; sha256: string }): string | undefined {
  const there = lstatSync(path, { throwIfNoEntry: false });
  if (there === undefined) {
    return undefined;
  }
  if (!there.isFile()) {
    return "is held by something that is not a regular file";
  }
  if (createHash("sha256").update(readFileSync(path)).digest("hex") !== sha256) {
    return "already holds a different picture for this turn, and the first one is never replaced";
  }
  return undefined;
}
