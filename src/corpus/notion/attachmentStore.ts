/**
 * Where an attachment's bytes live once they are fetched, and why they live there rather than in the record.
 *
 * **Content-addressed by SHA-256, sharded two characters deep** — the scheme itself is
 * `corpus/contentStore.ts`, shared with the parsed-body sidecar so the two can never drift apart. Holding
 * one copy per digest is not a micro-optimisation here: on the measured workspace a policy PDF really is
 * attached to several pages, and a per-record copy would multiply exactly the largest files.
 *
 * **A record carries the DIGEST, never the url.** Notion's signed urls expire inside the hour — the block
 * json says so in its own `expiry_time` — so a url written into bronze is a dead pointer by the time anyone
 * reads it, and worse, it looks live. The digest is stable forever and resolves to a path with no network.
 *
 * **Bytes never enter the JSONL.** A record's `text` and `raw` are read whole by several verbs, so a
 * base64'd PDF inside one would be loaded into heap by everything that touches that record. The bytes sit
 * beside the corpus and are opened only by something that actually wants them.
 */
import { join } from "node:path";

import { stateHomePaths } from "../../stateHome.js";

import { contentDigest, contentPath, type StoredContent, storeContent } from "../contentStore.js";

/** Where one stored attachment ended up. */
export type StoredAttachment = StoredContent;

/**
 * The root every Notion attachment is stored under. Pure.
 *
 * The corpus root comes from `stateHome.ts` rather than being spelled here. The state-home guard refuses a
 * second place that derives a `$SLOPWEAVER_HOME` sub-path, and it caught this module doing exactly that.
 *
 * @param home the state home the corpus lives under
 * @returns the per-source store root
 */
export function attachmentRoot({ home }: { home: string }): string {
  return join(stateHomePaths({ home }).corpus.attachments, "notion");
}

/**
 * The path an attachment with this digest occupies under a home. Pure.
 *
 * @param home the state home the corpus lives under
 * @param digest the lowercase-hex SHA-256 of the bytes
 * @returns the absolute path, sharded on the digest's first two characters
 */
export function attachmentPath({ home, digest }: { home: string; digest: string }): string {
  return contentPath({ digest, root: attachmentRoot({ home }) });
}

/**
 * The SHA-256 of some bytes, lowercase hex. Pure.
 *
 * @param bytes the exact bytes to name
 * @returns the digest
 */
export function attachmentDigest({ bytes }: { bytes: Buffer }): string {
  return contentDigest({ bytes });
}

/**
 * Put an attachment's bytes in the store, or recognise that they are already there.
 *
 * @param home the state home the corpus lives under
 * @param bytes the exact bytes as they arrived
 * @returns the digest, the path, and whether this was already held
 */
export function storeAttachment({ home, bytes }: { home: string; bytes: Buffer }): StoredAttachment {
  return storeContent({ bytes, root: attachmentRoot({ home }) });
}
