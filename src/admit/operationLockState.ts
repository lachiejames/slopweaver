/*
 * Reading what stands at an operation lock's path — a directory holding one token file, a plain-file lock an
 * older build wrote, or nothing — for `./operationLockTakeover.ts` to judge. Read-only: nothing here removes,
 * renames or writes, so every decision about what to do with what was read stays in that module.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { isRecord } from "../lib/parsers.js";

import type { LockContents } from "./operationLockHeld.js";
import { guardianOf } from "./processGuardian.js";

/** The one file inside a lock directory — or, with no token, a plain-file lock at the path itself. */
export interface Holder {
  readonly token: string | undefined;
  readonly contents: LockContents;
}

/** What is at the lock path right now. `in-flux` is a directory with no file in it — another contender's
 * takeover between its `unlink` and its `rmdir`, or the instant before a rename replaces it. */
export type LockState =
  | { readonly kind: "absent" }
  | { readonly kind: "in-flux" }
  | { readonly kind: "unreadable" }
  | { readonly kind: "held"; readonly holder: Holder };

/**
 * Parse a lock file's contents, returning undefined when it cannot be trusted.
 *
 * A record from before the guardian field reads exactly as it always did. A `guardian` is kept only when it is
 * exactly one (`./processGuardian.ts` `guardianOf`); a malformed one is DROPPED rather than refusing the record, so it
 * leaves the record judged as an unguarded one — never more lenient, and never a lock wedged by a field.
 *
 * @returns the record, or `undefined` when it is not JSON or lacks its pid or instant
 */
function parseLockContents({ raw }: { raw: string }): LockContents | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || typeof parsed["pid"] !== "number" || typeof parsed["acquiredAtIso"] !== "string") {
      return undefined;
    }
    const start = typeof parsed["start"] === "string" ? parsed["start"] : undefined;
    const guardian = guardianOf({ value: parsed["guardian"] });
    if (guardian === undefined) {
      return { acquiredAtIso: parsed["acquiredAtIso"], pid: parsed["pid"], start };
    }
    return { acquiredAtIso: parsed["acquiredAtIso"], guardian, pid: parsed["pid"], start };
  } catch {
    return undefined;
  }
}

/** How a failed read of the plain-file lock is classified. Its `readFileSync` is a SECOND syscall after
 * the `readdirSync` that found the path was not a directory, so the path can change shape in between and
 * the errno says which way it moved: ENOENT is a peer's takeover that already unlinked it, EISDIR/ENOTDIR
 * is a peer's own lock directory renamed onto it, and both mean go round again rather than refuse. The two
 * other readers in this file already answer that way — `readLockState` maps readdir's own ENOENT to
 * `absent` and `readTokenFile` maps its own to `in-flux`; this reader was the one that never did. Anything
 * else is a genuine read fault and stays `unreadable`. */
function plainFileReadFailure({ error }: { error: unknown }): LockState {
  if (!isRecord(error)) {
    return { kind: "unreadable" };
  }
  const code = error["code"];
  if (code === "ENOENT") {
    return { kind: "absent" };
  }
  if (code === "EISDIR" || code === "ENOTDIR") {
    return { kind: "in-flux" };
  }
  return { kind: "unreadable" };
}

/**
 * A lock written as a plain file by the shape that preceded the directory — read for one last judgement.
 *
 * A record that does not PARSE stays `unreadable`: that is content rather than shape, and treating it as a
 * path in motion would send a corrupt lock round again forever instead of refusing it. Only the read itself
 * is classified, by {@link plainFileReadFailure}.
 *
 * MEASURED: mapping every throw from that read to `unreadable` made this module refuse with
 * "a lock already exists at <path> and could not be read to check its age" about a path a peer had already
 * cleared — a lock that did not exist, reported as one too broken to judge. It reddened the subprocess lane
 * on a three-markdown-file diff, through BOTH of vitest's attempts
 * (the plain-file case). Racing eight contenders at a plain-file-seeded lock
 * reproduced it 2 laps in 100 under a 24-way CPU load and 0 in 100 unloaded; after this change, 0 in 100
 * under that same load. Repro:
 * `for i in $(seq 1 40); do yarn vitest run --config config/vitest/subprocess.ts src/__tests__/subprocess/admit/operationLockRace.test.ts || break; done`
 *
 * @param path the plain file to read — the lock path itself, or the hard link a takeover re-reads it through
 * @returns the holder it names, or how the read failed
 */
export function readPlainFileLock({ path }: { path: string }): LockState {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error: unknown) {
    return plainFileReadFailure({ error });
  }
  const contents = parseLockContents({ raw });
  if (contents === undefined) {
    return { kind: "unreadable" };
  }
  return { holder: { contents, token: undefined }, kind: "held" };
}

/**
 * Read whatever is at the lock path: a directory holding one token file, a plain-file lock, or nothing.
 *
 * @returns what stands at the path at the instant it was read
 */
export function readLockState({ path }: { path: string }): LockState {
  let names: string[];
  try {
    names = readdirSync(path);
  } catch (error: unknown) {
    if (isRecord(error) && error["code"] === "ENOENT") {
      return { kind: "absent" };
    }
    if (isRecord(error) && error["code"] === "ENOTDIR") {
      return readPlainFileLock({ path });
    }
    return { kind: "unreadable" };
  }
  const [token] = names;
  if (token === undefined) {
    return { kind: "in-flux" };
  }
  if (names.length > 1) {
    return { kind: "unreadable" };
  }
  return readTokenFile({ path, token });
}

/** Read the one token file a directory-shaped lock holds; gone between the listing and the read is in-flux. */
function readTokenFile({ path, token }: { path: string; token: string }): LockState {
  let raw: string;
  try {
    raw = readFileSync(join(path, token), "utf8");
  } catch (error: unknown) {
    if (isRecord(error) && error["code"] === "ENOENT") {
      return { kind: "in-flux" };
    }
    return { kind: "unreadable" };
  }
  const contents = parseLockContents({ raw });
  if (contents === undefined) {
    return { kind: "unreadable" };
  }
  return { holder: { contents, token }, kind: "held" };
}
