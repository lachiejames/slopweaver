/**
 * The inflated objects inside a git bundle — so the authored leg's secret scan reads what a `.bundle` in
 * `worktree-bundles/` actually carries rather than its zlib streams.
 *
 * A bundle is a text header (`# v2 git bundle` or `# v3 git bundle`, its refs, a blank line) followed by one
 * packfile: `PACK`, a version, an object count, then each object as a type-and-size varint, a base reference
 * for a delta, and a zlib stream. Every object's stream is inflated as it is, delta or not: a delta's insert
 * instructions carry their new bytes literally, so a token added by a commit is in the inflated delta even
 * when the object is never reconstructed. MEASURED over this install's 101 bundles (repro:
 * `slopweaver store import-fleet --only authored --dry-run`): 2,663 objects, 4,877,736 inflated bytes, every
 * pack parsed.
 *
 * Pure: bytes in, buffers or the reason out. A pack that will not parse is an error, never an empty list —
 * the caller refuses a bundle it cannot read rather than storing it unchecked.
 */
import { inflateSync } from "node:zlib";

import { isRecord } from "#lib/parsers.js";
import { err, ok, type Result } from "#lib/result.js";

import { FleetImportErrors, type UnreadableGitBundleError } from "./errors.js";

/** The two bundle headers git writes. */
const BUNDLE_HEADERS: ReadonlySet<string> = new Set(["# v2 git bundle\n", "# v3 git bundle\n"]);

/** The most inflated bytes one bundle may expand to before it is refused — a guard on a decompression bomb. */
const GIT_BUNDLE_MAX_INFLATED_BYTES = 512 * 1024 * 1024;

/** Pack object type 6: a delta against a base at an offset in the same pack. */
const OFS_DELTA = 6;
/** Pack object type 7: a delta against a base named by its 20-byte id. */
const REF_DELTA = 7;

/**
 * Whether some bytes are a git bundle.
 *
 * @param bytes the file's bytes
 * @returns true when they open with a bundle header
 */
export function isGitBundle({ bytes }: { bytes: Uint8Array }): boolean {
  const head = Buffer.from(bytes.subarray(0, 16)).toString("latin1");
  return BUNDLE_HEADERS.has(head);
}

/**
 * Every object's inflated bytes, in pack order.
 *
 * @param bytes a git bundle's bytes
 * @returns each object's inflated stream, or the typed reason the pack could not be read
 */
export function gitBundleObjects({
  bytes,
}: {
  bytes: Uint8Array;
}): Result<readonly Buffer[], UnreadableGitBundleError> {
  const buffer = Buffer.from(bytes);
  const start = buffer.indexOf("\n\nPACK", 0, "latin1");
  if (start < 0) {
    return err(FleetImportErrors.unreadableGitBundle({ reason: "no packfile follows the bundle header" }));
  }
  const pack = start + 2;
  if (buffer.length < pack + 12) {
    return err(FleetImportErrors.unreadableGitBundle({ reason: "the packfile header is truncated" }));
  }
  const count = buffer.readUInt32BE(pack + 8);
  const objects: Buffer[] = [];
  let offset = pack + 12;
  let inflated = 0;
  try {
    for (let index = 0; index < count; index += 1) {
      offset = afterObjectHeader({ buffer, offset });
      const stream = inflatedStream({ raw: inflateSync(buffer.subarray(offset), { info: true }) });
      if (stream === undefined) {
        return err(
          FleetImportErrors.unreadableGitBundle({ reason: "zlib did not report how much of the pack it read" }),
        );
      }
      objects.push(stream.bytes);
      offset += stream.consumed;
      inflated += stream.bytes.length;
      if (inflated > GIT_BUNDLE_MAX_INFLATED_BYTES) {
        return err(
          FleetImportErrors.unreadableGitBundle({
            reason: `it inflates past ${String(GIT_BUNDLE_MAX_INFLATED_BYTES)} bytes`,
          }),
        );
      }
    }
  } catch (cause) {
    return err(
      FleetImportErrors.unreadableGitBundle({
        reason: `object ${String(objects.length + 1)} of ${String(count)} would not inflate: ${String(cause)}`,
      }),
    );
  }
  return ok(objects);
}

/**
 * What `inflateSync(…, { info: true })` returns, narrowed at run time: Node's types declare a plain `Buffer`
 * for every overload, while `info` really returns the output beside the engine that counted its input.
 *
 * @param raw the call's return value
 * @returns the inflated bytes and how many input bytes produced them, or `undefined` when it is not that shape
 */
function inflatedStream({ raw }: { raw: unknown }): { bytes: Buffer; consumed: number } | undefined {
  if (!isRecord(raw) || !Buffer.isBuffer(raw["buffer"]) || !isRecord(raw["engine"])) {
    return undefined;
  }
  const consumed = raw["engine"]["bytesWritten"];
  if (typeof consumed !== "number") {
    return undefined;
  }
  return { bytes: raw["buffer"], consumed };
}

/**
 * Step over one object's header — its type-and-size varint and, for a delta, its base reference.
 *
 * @param buffer the whole bundle
 * @param offset where the object starts
 * @returns where its zlib stream starts
 */
function afterObjectHeader({ buffer, offset }: { buffer: Buffer; offset: number }): number {
  let at = offset;
  let byte = byteAt({ at, buffer });
  const type = (byte >> 4) & 7;
  at += 1;
  while ((byte & 0x80) !== 0) {
    byte = byteAt({ at, buffer });
    at += 1;
  }
  if (type === OFS_DELTA) {
    byte = byteAt({ at, buffer });
    at += 1;
    while ((byte & 0x80) !== 0) {
      byte = byteAt({ at, buffer });
      at += 1;
    }
  }
  if (type === REF_DELTA) {
    at += 20;
  }
  return at;
}

/**
 * One byte of the pack, throwing past its end so a truncated pack is an error rather than a zero.
 *
 * @param buffer the whole bundle
 * @param at the index
 * @returns the byte
 */
function byteAt({ buffer, at }: { buffer: Buffer; at: number }): number {
  const byte = buffer[at];
  if (byte === undefined) {
    throw new RangeError(`the pack ends at byte ${String(at)}`);
  }
  return byte;
}
