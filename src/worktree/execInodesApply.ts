/**
 * The filesystem edge of {@link ../worktree/execInodes.js}: walk one checkout's `node_modules`, find every
 * Mach-O image, and make sure each one is a hardlink to Slopweaver's own exec store rather than to yarn's
 * content store.
 *
 * Synchronous throughout, because `no-headless` bans the async `node:child_process` API repo-wide and this
 * module sits on the same install path as `shell.ts`, which is synchronous for that reason.
 *
 * The walk is cheap by construction and the steady state is cheaper. The exec store's own inodes are read
 * once per run (~30 `stat`s), and any image already carrying one of them is skipped without being hashed —
 * so a second run over an unchanged tree hashes nothing at all. Only an image yarn has just re-linked back
 * to its own store is hashed, and only that image.
 */
import { createHash } from "node:crypto";
import type { Dirent, Stats } from "node:fs";
import { closeSync, linkSync, mkdirSync, openSync, readdirSync, readSync, renameSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { writeFileAtomicStream } from "../lib/writeAtomic.js";

import {
  couldBeNativeImage,
  type ExecInodeOutcome,
  type ExecInodeReport,
  execInodeVerdict,
  execStoreEntryName,
  inodeKey,
  isMachO,
  MACH_O_MAGIC_BYTES,
} from "./execInodes.js";

/** How much of an image is hashed per read. Large enough that a 296 MiB binary is ~37 reads, small enough
 * that the buffer is never a data-sized allocation. */
const HASH_CHUNK_BYTES = 8 * 1024 * 1024;

/** The permission bits carried from a source image onto its exec-store entry. */
const MODE_BITS = 0o777;

/**
 * The binary `doctor` uses as the sentinel for a whole tree.
 *
 * Hard-coded to this platform's triple because that is what the sentinel is FOR: an arm64 macOS worktree
 * either has this file or has never installed, and a checkout without it simply reports nothing rather than
 * claiming health. The full walk needs no such list — it matches Mach-O headers.
 */
const ESBUILD_SENTINEL = "@esbuild/darwin-arm64/bin/esbuild";

/** Directory entries that never hold a dependency's native image and cost real time to descend. */
const SKIPPED_DIRS: ReadonlySet<string> = new Set([".bin", ".cache", ".yarn-state.yml"]);

/** One file's leading bytes, or an empty view when it cannot be opened. */
function leadingBytes({ path }: { path: string }): Uint8Array {
  const buffer = new Uint8Array(MACH_O_MAGIC_BYTES);
  let fd: number;
  try {
    fd = openSync(path, "r");
  } catch {
    return new Uint8Array(0);
  }
  try {
    readSync(fd, buffer, 0, MACH_O_MAGIC_BYTES, 0);
    return buffer;
  } catch {
    return new Uint8Array(0);
  } finally {
    closeSync(fd);
  }
}

/** Every inode the exec store currently owns, so an already-safe image is recognised without being hashed. */
function storeInodes({ execStore }: { execStore: string }): ReadonlySet<string> {
  const keys = new Set<string>();
  let entries: readonly string[];
  try {
    entries = readdirSync(execStore);
  } catch {
    return keys;
  }
  for (const entry of entries) {
    try {
      const stat = statSync(join(execStore, entry));
      keys.add(inodeKey({ identity: { dev: stat.dev, ino: stat.ino } }));
    } catch {
      // A store entry that vanished between the readdir and the stat is simply not in the set — the image
      // that would have matched it is hashed and re-seeded, which is the correct answer either way.
    }
  }
  return keys;
}

/** One native image found on the walk, with the `stat` the decisions need. */
interface NativeImage {
  readonly path: string;
  readonly dev: number;
  readonly ino: number;
  readonly size: number;
  readonly mode: number;
}

/** One file's `stat`, or `undefined` when it vanished between the readdir and the call. */
function statOf({ path }: { path: string }): Stats | undefined {
  try {
    return statSync(path);
  } catch {
    return undefined;
  }
}

/** One file as a native image, or `undefined` when it is not one. */
function nativeImageAt({ path }: { path: string }): NativeImage | undefined {
  const stat = statOf({ path });
  if (stat === undefined || !couldBeNativeImage({ mode: stat.mode, path })) {
    return undefined;
  }
  if (!isMachO({ header: leadingBytes({ path }) })) {
    return undefined;
  }
  return { dev: stat.dev, ino: stat.ino, mode: stat.mode, path, size: stat.size };
}

/** Recursively collect every Mach-O image under one directory. */
function collectNativeImages({ dir, found }: { dir: string; found: NativeImage[] }): void {
  let entries: readonly Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory() && !SKIPPED_DIRS.has(entry.name)) {
      collectNativeImages({ dir: path, found });
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    const image = nativeImageAt({ path });
    if (image !== undefined) {
      found.push(image);
    }
  }
}

/**
 * One image's content hash, lowercase hex, read a chunk at a time.
 *
 * Chunked rather than `readFileSync`: the largest image in this tree is 296 MiB
 * (`@anthropic-ai/claude-agent-sdk-darwin-arm64/claude`, `slopweaver worktree unshare --report` prints the
 * whole footprint), and a single buffer that size is a data-sized allocation for no reason.
 */
function hashOf({ path }: { path: string }): string {
  const hash = createHash("sha256");
  forEachChunk({
    onChunk: (bytes) => {
      hash.update(bytes);
    },
    path,
  });
  return hash.digest("hex");
}

/**
 * Make sure the exec store holds this image's content, seeded from the image itself.
 *
 * Seeding copies to a temp name and RENAMES it into place, so an entry is never observed half-written and
 * an existing entry's inode is never touched. Copying from a poisoned inode is safe and is the whole cure:
 * the bytes are correct, it is the inode that macOS has condemned, so a fresh one executes again.
 *
 * @param execStore the store directory
 * @param image the file to seed from
 * @returns the entry's absolute path
 */
function ensureStoreEntry({ execStore, image }: { execStore: string; image: NativeImage }): string {
  const entry = join(execStore, execStoreEntryName({ sha256: hashOf({ path: image.path }) }));
  try {
    statSync(entry);
    return entry;
  } catch {
    // Absent — seed it below.
  }
  // Streamed and fsynced through the one atomic writer rather than copied: the largest image here is
  // 296 MiB, and a store entry observed half-written would be a poisoned binary of a different kind.
  writeFileAtomicStream({
    fileMode: image.mode & MODE_BITS,
    path: entry,
    produce: ({ writeBytes }) => {
      forEachChunk({
        onChunk: (bytes) => {
          writeBytes({ bytes });
        },
        path: image.path,
      });
    },
  });
  return entry;
}

/** Read one file a chunk at a time, handing each chunk to `onChunk`. */
function forEachChunk({ path, onChunk }: { path: string; onChunk: (bytes: Buffer) => void }): void {
  const buffer = Buffer.allocUnsafe(HASH_CHUNK_BYTES);
  const fd = openSync(path, "r");
  try {
    let read = readSync(fd, buffer, 0, HASH_CHUNK_BYTES, null);
    while (read > 0) {
      onChunk(buffer.subarray(0, read));
      read = readSync(fd, buffer, 0, HASH_CHUNK_BYTES, null);
    }
  } finally {
    closeSync(fd);
  }
}

/** Replace one image with a hardlink to its exec-store entry, via a temp name so nothing is ever missing. */
function relinkToStore({ entry, image }: { entry: string; image: NativeImage }): void {
  const temp = `${image.path}.${String(process.pid)}.tmp`;
  linkSync(entry, temp);
  renameSync(temp, image.path);
}

/** What one image's handling produced. */
function settleImage({
  execStore,
  image,
  root,
  apply,
  inodes,
}: {
  execStore: string;
  image: NativeImage;
  root: string;
  apply: boolean;
  inodes: ReadonlySet<string>;
}): ExecInodeOutcome {
  const path = relative(root, image.path);
  if (execInodeVerdict({ file: { dev: image.dev, ino: image.ino }, storeInodes: inodes }) === "private") {
    return { action: "already-private", detail: undefined, path, size: image.size };
  }
  if (!apply) {
    return { action: "shared", detail: undefined, path, size: image.size };
  }
  try {
    relinkToStore({ entry: ensureStoreEntry({ execStore, image }), image });
    return { action: "relinked", detail: undefined, path, size: image.size };
  } catch (error: unknown) {
    return {
      action: "failed",
      detail: error instanceof Error ? error.message : String(error),
      path,
      size: image.size,
    };
  }
}

/**
 * Walk one checkout's `node_modules` and privatise every native image's inode.
 *
 * @param root the checkout or worktree to walk — its `node_modules` is the only thing read
 * @param execStore the exec store to link into, created when absent
 * @param apply whether to relink, or only to report what is still shared with yarn's store
 * @returns one row per native image found, in walk order
 */
export function privatiseExecInodes({
  root,
  execStore,
  apply,
}: {
  root: string;
  execStore: string;
  apply: boolean;
}): ExecInodeReport {
  if (apply) {
    mkdirSync(execStore, { recursive: true });
  }
  const found: NativeImage[] = [];
  collectNativeImages({ dir: join(root, "node_modules"), found });
  const inodes = storeInodes({ execStore });
  return {
    applied: apply,
    execStore,
    outcomes: found.map((image) => settleImage({ apply, execStore, image, inodes, root })),
    root,
  };
}

/**
 * The one binary `doctor` checks, and whether it is still on an inode yarn can write.
 *
 * A whole-tree walk is far too expensive for something that runs at every session start, so this stats ONE
 * sentinel: esbuild is the binary that actually bit, twice, (`ws:405`, `ws:411`), and it is
 * relinked in the same pass as every other native image — so a shared esbuild proves the pass has not run
 * here, and a private one proves it has.
 *
 * Private to ANY of `execStores` is private: the sentinel is statted ONCE and that one inode is looked up in every
 * store, so a `worktree unshare` relinking it from one store to another between two reads cannot make it read
 * shared in both.
 *
 * @param root the checkout to check
 * @param execStores the exec stores its binaries may be linked into — the cache root's, and the home's pre-move one
 * @returns the sentinel's verdict, or `undefined` when this checkout has no esbuild to judge
 */
export function esbuildInodeVerdict({
  root,
  execStores,
}: {
  root: string;
  execStores: readonly string[];
}): "private" | "shared" | undefined {
  const path = join(root, "node_modules", ESBUILD_SENTINEL);
  let stat: Stats;
  try {
    stat = statSync(path);
  } catch {
    return undefined;
  }
  const file = { dev: stat.dev, ino: stat.ino };
  const anyPrivate = execStores.some(
    (execStore) => execInodeVerdict({ file, storeInodes: storeInodes({ execStore }) }) === "private",
  );
  return anyPrivate ? "private" : "shared";
}
