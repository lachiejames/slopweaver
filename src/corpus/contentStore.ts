/**
 * The content-addressed blob store both Notion sidecars stand on — attachment BYTES and parsed page BODIES.
 *
 * **One scheme, one place.** The naming and sharding here were written once for attachments
 * (`notion/attachmentStore.ts`) and are now read by a second store, so they live in a module of their own
 * rather than being re-typed. That is not tidiness: this repository has already measured what a scattered
 * copy of a small rule costs — four independent `tsToIso` implementations stood in the tree at once,
 * disagreeing on the empty case, and none was wrong on its own
 * (`.claude/rules/typescript-patterns.md`). A second store sharding one character deep, or hashing the
 * serialised form instead of the bytes, would be exactly that defect with the blast radius of the corpus.
 *
 * **SHA-256, sharded two characters deep.** The digest is the name, so identical content is held once no
 * matter how many records point at it. The shard keeps any one directory small enough that a `readdir` over
 * the store stays cheap — the failure the temp-directory incident taught this repository the
 * expensive way (`.claude/rules/testing.md` carries the 758,840-directory measurement).
 *
 * **A store is a ROOT plus bytes, and the root is the caller's.** This module derives no `$SLOPWEAVER_HOME`
 * sub-path of its own — `stateHome.ts` owns every one of those and the `home-safety` guard refuses a second
 * place that invents one. Each caller resolves its own root there and hands it in.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { writeFileAtomicBytes } from "../lib/writeAtomic.js";

/** Where one stored blob ended up. */
export interface StoredContent {
  /** The SHA-256 of the bytes, lowercase hex — the stable name a record refers to it by. */
  readonly digest: string;
  /** The absolute path the bytes are at. */
  readonly path: string;
  /** Whether these bytes were already in the store, so nothing was written. */
  readonly deduped: boolean;
}

/**
 * The SHA-256 of some bytes, lowercase hex. Pure.
 *
 * @param bytes the exact bytes to name
 * @returns the digest
 */
export function contentDigest({ bytes }: { bytes: Buffer }): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * The path content with this digest occupies under a store root. Pure.
 *
 * @param root the store root, resolved by the caller from `stateHome.ts`
 * @param digest the lowercase-hex SHA-256 of the bytes
 * @returns the absolute path, sharded on the digest's first two characters
 */
export function contentPath({ root, digest }: { root: string; digest: string }): string {
  return join(root, digest.slice(0, 2), digest);
}

/**
 * Put bytes in the store, or recognise that they are already there.
 *
 * Idempotent by construction, which is what makes a re-pull cheap: the second run computes the same digest,
 * finds the file, and writes nothing. That is the same property the owner asked for at the page level —
 * _"if you've already got a page in the index, you don't need to do the whole thing again"_ — applied to the
 * bytes underneath it.
 *
 * @param root the store root, resolved by the caller from `stateHome.ts`
 * @param bytes the exact bytes as they arrived
 * @returns the digest, the path, and whether this was already held
 */
export function storeContent({ root, bytes }: { root: string; bytes: Buffer }): StoredContent {
  const digest = contentDigest({ bytes });
  const path = contentPath({ digest, root });
  if (existsSync(path)) {
    return { deduped: true, digest, path };
  }
  writeFileAtomicBytes({ bytes, path });
  return { deduped: false, digest, path };
}
