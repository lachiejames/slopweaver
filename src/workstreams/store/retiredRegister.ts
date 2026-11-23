/**
 * The tombstone at the retired register's path: a DIRECTORY standing where `workstreams/register.json` was, made
 * durable before the store is opened, so a build from before the move can neither write that file nor read one.
 *
 * ## Why a directory
 *
 * The old code wrote the register by staging a sibling and renaming it onto the path (`#lib/writeAtomic.js`), and read
 * it with `statSync` then `readFileSync`. A rename of a file onto a directory fails, and so does reading a directory,
 * so from the instant the tombstone exists an old seat's write and read both fail with nothing changed — without any
 * change to the old code. It is installed under the old code's own operation lock, {@link RETIRED_REGISTER_LOCK_KEY},
 * so an old write already in flight finishes first and is then found here as a regular file.
 *
 * ## Refuse, never import
 *
 * A regular file, a symlink or anything else at the path refuses every store-backed read and write. Nothing imports a
 * file: no install held one at the cutover, and a converter from the old shape would be the riskiest code in the move,
 * written for a file nobody has. A person moves it aside and re-enters what it held.
 *
 * ## Durable before the store opens, on EVERY open
 *
 * A directory entry survives a power loss only once its parent directory is synced, and a file's bytes only once the
 * file is. A process can die between any two of those steps, and the next one cannot know where, so every open — a
 * fresh install or an existing tombstone — replays all four syncs in order before it hands back: the marker, the
 * tombstone, `workstreams`, the home. Each is STRICT, unlike `writeFileAtomic`'s
 * best-effort directory sync: a failure is `WORKSTREAM_TOMBSTONE_NOT_DURABLE` and the store is never opened.
 *
 * ## Whom it fences, and the residue
 *
 * The adversary is the OLD WRITER, which takes the same lock, so nothing it does can land between the look and the
 * syncs. The two components the tombstone owns are synced without following a link (`O_NOFOLLOW`), so one swapped in
 * after the look fails the sync rather than syncing its target. What stays out of reach is a
 * process that skips the lock and swaps a component AFTER its own sync: any re-check is just as racy, and a local
 * process willing to do that can delete the tombstone outright.
 *
 * Every effect is a seam ({@link RetiredRegisterSeams}), so the order is a transcript a test reads.
 */
import { join } from "node:path";

import { err, ok, type Result } from "#lib/result.js";

import { stateHomePaths } from "../../stateHome.js";

import { type WorkstreamStoreError, WorkstreamStoreErrors } from "./errors.js";
import { describeStoreCause } from "./port.js";

/**
 * The operation-lock key the OLD register writers took around every read-modify-write. The tombstone is installed
 * under the same key so it cannot land between an old seat's compare and its rename; it must never change.
 */
export const RETIRED_REGISTER_LOCK_KEY = "workstreams-register";

/** The one file inside the tombstone, and the exact bytes it holds. */
export const RETIRED_REGISTER_MARKER_NAME = "RETIRED";
export const RETIRED_REGISTER_MARKER = [
  "The workstream register lives in the store: read it with `slopweaver workstreams list`.",
  "This directory stands where register.json was, so a build from before the move can neither write nor read that file.",
  "Do not remove it.",
  "",
].join("\n");

/** What one look at the retired register's path found. */
export type RetiredRegisterNode =
  | { readonly kind: "absent" }
  | { readonly kind: "file" }
  | { readonly kind: "symlink" }
  | { readonly kind: "other" }
  | {
      readonly kind: "directory";
      /** Every entry's name, sorted. */
      readonly entries: readonly string[];
      /**
       * The marker: a regular file and its bytes, an entry of that name that is NOT a regular file (a link, a
       * directory — never followed, never written through), or `null` when there is no entry of that name.
       */
      readonly marker: { readonly kind: "file"; readonly contents: string } | { readonly kind: "not-a-file" } | null;
    };

/** Every effect the tombstone needs; each throws on failure, and the shell types what it throws. */
export interface RetiredRegisterSeams {
  /** `lstat` the path, never following a link, and list a directory and read its marker. */
  readonly inspect: (request: { readonly path: string }) => RetiredRegisterNode;
  /** Make a directory, owner-only, its parents included; an existing one is no failure. */
  readonly makeDirectory: (request: { readonly path: string }) => void;
  /** Write the marker's bytes, owner-only, replacing any partial one. */
  readonly writeMarker: (request: { readonly path: string; readonly contents: string }) => void;
  /** Open a file without following a link and `fsync` it. */
  readonly syncFile: (request: { readonly path: string }) => void;
  /** Open a directory and `fsync` it. */
  readonly syncDirectory: (request: { readonly path: string; readonly followLink: boolean }) => void;
  /** Take {@link RETIRED_REGISTER_LOCK_KEY} under the home; the error is why it is held. */
  readonly lock: (request: { readonly home: string }) => Result<{ readonly release: () => void }, string>;
}

/**
 * What the path's state calls for: install the tombstone (absent, or a directory holding only a missing or partial
 * marker, which a process that died mid-install leaves), only re-sync it (exactly the marker), or refuse naming what
 * stands there instead.
 *
 * @returns the step, or the words for what is there when it must refuse
 */
export function retiredRegisterStep({
  node,
}: {
  node: RetiredRegisterNode;
}): { readonly step: "install" | "sync" } | { readonly found: string } {
  switch (node.kind) {
    case "absent":
      return { step: "install" };
    case "file":
      return { found: "a regular file" };
    case "symlink":
      return { found: "a symbolic link" };
    case "other":
      return { found: "something that is neither a file nor a directory" };
    case "directory": {
      const foreign = node.entries.filter((entry) => entry !== RETIRED_REGISTER_MARKER_NAME);
      if (foreign.length > 0) {
        return { found: `a directory holding ${foreign.join(", ")}` };
      }
      if (node.marker === null) {
        return { step: "install" };
      }
      if (node.marker.kind === "not-a-file") {
        return { found: `a directory whose ${RETIRED_REGISTER_MARKER_NAME} is not a regular file` };
      }
      return { step: node.marker.contents === RETIRED_REGISTER_MARKER ? "sync" : "install" };
    }
    default: {
      const unhandled: never = node;
      return unhandled;
    }
  }
}

/**
 * Install or confirm the tombstone and make it durable: inspect, install when called for, then the four syncs in
 * order — all under the lock, which is released before this returns.
 *
 * @returns nothing once every sync has completed; the refusal when something else stands at the path; an outage or
 *   `WORKSTREAM_TOMBSTONE_NOT_DURABLE` when a step failed, and then the store must not be opened
 */
function settleTombstone({
  home,
  path,
  seams,
}: {
  home: string;
  path: string;
  seams: RetiredRegisterSeams;
}): Result<void, WorkstreamStoreError> {
  let node: RetiredRegisterNode;
  try {
    node = seams.inspect({ path });
  } catch (cause) {
    return err(
      WorkstreamStoreErrors.unavailable({
        doing: `check the retired register at ${path}`,
        reason: describeStoreCause({ cause }),
      }),
    );
  }
  const step = retiredRegisterStep({ node });
  if ("found" in step) {
    return err(WorkstreamStoreErrors.retiredRegisterPresent({ found: step.found, path }));
  }
  const workstreams = join(path, "..");
  const marker = join(path, RETIRED_REGISTER_MARKER_NAME);
  try {
    if (step.step === "install") {
      seams.makeDirectory({ path });
      seams.writeMarker({ contents: RETIRED_REGISTER_MARKER, path: marker });
    }
    seams.syncFile({ path: marker });
    seams.syncDirectory({ followLink: false, path });
    seams.syncDirectory({ followLink: true, path: workstreams });
    seams.syncDirectory({ followLink: true, path: home });
  } catch (cause) {
    return err(WorkstreamStoreErrors.tombstoneNotDurable({ path, reason: describeStoreCause({ cause }) }));
  }
  return ok(undefined);
}

/**
 * Stand the tombstone at the retired register's path under `home`, durably, before the store is opened. Every
 * store-backed workstream read and write passes this first; the store is opened only on `ok`.
 *
 * @param home the state home whose `workstreams/register.json` is fenced
 * @returns nothing once the tombstone is durable; otherwise the refusal, and nothing beyond the tombstone was touched
 */
export function fenceRetiredWorkstreamRegister({
  home,
  seams,
}: {
  home: string;
  seams: RetiredRegisterSeams;
}): Result<void, WorkstreamStoreError> {
  const path = stateHomePaths({ home }).workstreamsRegisterJson;
  let lock: Result<{ readonly release: () => void }, string>;
  try {
    lock = seams.lock({ home });
  } catch (cause) {
    lock = err(describeStoreCause({ cause }));
  }
  if (lock.isErr()) {
    return err(
      WorkstreamStoreErrors.unavailable({
        doing: `take the ${RETIRED_REGISTER_LOCK_KEY} lock to fence ${path}`,
        reason: lock.error,
      }),
    );
  }
  try {
    return settleTombstone({ home, path, seams });
  } finally {
    lock.value.release();
  }
}
