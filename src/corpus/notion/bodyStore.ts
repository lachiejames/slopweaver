/**
 * Where a page's PARSED BODY lives, so that re-deriving its text never calls Notion again.
 *
 * ## The asymmetry this closes
 *
 * A bronze record carries a rendered `text` and a `raw` object. For GitHub, Slack and Linear `raw` is the
 * provider's own JSON, so anything derived from one of those records can be re-derived from what is already
 * on disk. For Notion `raw` has only ever held the PAGE object — its title, its properties, its timestamps —
 * and never the body. The body was a ONE-WAY render: once `text` was written, the structure that produced it
 * was gone, and changing how a Notion body renders meant re-fetching every page in the workspace. That is
 * the cost this module removes, and it is the payoff of parsing the body into a typed tree at all
 * (`markdownProjection.ts`); until something stored the tree, the parser's only consumer was the same
 * render pass that would have run without it.
 *
 * ## Why a SIDECAR, and not a field on the record
 *
 * A page fans out into one record per 1,500-character chunk (`project.ts`). A tree put on the record would
 * therefore be written once per chunk — the largest page measured on this workspace holds 527,140
 * characters, so its tree would be duplicated across hundreds of rows — and every verb that reads a record's
 * `text` or `raw` would pull the whole tree into heap to get at a chunk. Storing it beside the corpus and
 * naming it by digest keeps the rows small, so only a caller that actually wants the structure pays for it.
 *
 * Content-addressing buys the second property the owner asked for by name: _"if you've already got a page in
 * the index, you don't need to do the whole thing again"_. An unchanged body serialises to identical bytes,
 * hashes to the same digest, finds the file already there and writes nothing — and the record's attr is
 * byte-identical too, so an unchanged page's fingerprint does not move.
 *
 * ## Serialising through `safeJson`
 *
 * A body's size is set by the page, not by this code, which is exactly the class
 * `.claude/rules/typescript-patterns.md` names: where only the data knows its size, the serialisation goes
 * through `safeJsonStringify`/`safeJsonParse` — warn at 32 MiB, refuse at 100 MiB — rather than through a
 * bare `JSON.stringify` that would abort the process with V8's own string-length error instead of a message
 * naming what was being written.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { err, ok, type Result } from "../../lib/result.js";
import { safeJsonParse, safeJsonStringify } from "../../lib/safeJson.js";
import { stateHomePaths } from "../../stateHome.js";

import { contentDigest, contentPath, type StoredContent, storeContent } from "../contentStore.js";

import { type NotionBodyError, NotionBodyErrors } from "./bodyErrors.js";

import type { NotionMdNode } from "./markdownNodes.js";

/** Where one stored body ended up. */
export type StoredBody = StoredContent;

/** The prefix a record's body reference carries, naming the hash that produced the digest. */
const BODY_REF_PREFIX = "sha256:";

/**
 * The root every parsed Notion body is stored under. Pure.
 *
 * The corpus root comes from `stateHome.ts` rather than being spelled here — the `home-safety` guard refuses
 * a second place that derives a `$SLOPWEAVER_HOME` sub-path.
 *
 * @param home the state home the corpus lives under
 * @returns the per-source store root
 */
export function bodyRoot({ home }: { home: string }): string {
  return join(stateHomePaths({ home }).corpus.bodies, "notion");
}

/**
 * The path a body with this digest occupies under a home. Pure.
 *
 * @param home the state home the corpus lives under
 * @param digest the lowercase-hex SHA-256 of the serialised tree
 * @returns the absolute path, sharded on the digest's first two characters
 */
export function bodyPath({ home, digest }: { home: string; digest: string }): string {
  return contentPath({ digest, root: bodyRoot({ home }) });
}

/**
 * How a record names its body. Pure.
 *
 * The hash is named in the value rather than assumed, so a future second algorithm is a readable difference
 * on the row instead of a digest of the wrong length that still parses.
 *
 * @param digest the lowercase-hex SHA-256 of the serialised tree
 * @returns the reference a record carries
 */
export function bodyRef({ digest }: { digest: string }): string {
  return `${BODY_REF_PREFIX}${digest}`;
}

/**
 * The digest inside a record's body reference, or undefined when the value is not one. Pure.
 *
 * @param ref the attribute value read off a record
 * @returns the lowercase-hex digest, or undefined
 */
export function bodyRefDigest({ ref }: { ref: string }): string | undefined {
  if (!ref.startsWith(BODY_REF_PREFIX)) {
    return undefined;
  }
  const digest = ref.slice(BODY_REF_PREFIX.length);
  return /^[0-9a-f]{64}$/.test(digest) ? digest : undefined;
}

/**
 * The exact bytes a tree is stored as. Pure, and the one place the serialised form is decided.
 *
 * Both the writer and any future reader go through this, so the digest a re-pull computes is the digest the
 * first pull wrote for the same tree. A second place that serialised with different spacing would break
 * dedup silently — every unchanged page would look new.
 *
 * @param tree the parsed body
 * @returns the bytes to hash and to write
 */
export function serialiseBody({ tree }: { tree: readonly NotionMdNode[] }): Buffer {
  return Buffer.from(safeJsonStringify({ label: "notion page body tree", value: tree }), "utf8");
}

/**
 * Put a parsed body in the store, or recognise that it is already there.
 *
 * @param home the state home the corpus lives under
 * @param tree the parsed body, as `markdownProjection.ts` produced it
 * @returns the digest, the path, and whether this body was already held
 */
export function storeBody({ home, tree }: { home: string; tree: readonly NotionMdNode[] }): StoredBody {
  return storeContent({ bytes: serialiseBody({ tree }), root: bodyRoot({ home }) });
}

/**
 * Read a stored body back by digest.
 *
 * Typed rather than on the default string list, because its failures are genuinely different KINDS and one
 * of them is an alarm rather than a miss — see `bodyErrors.ts`.
 *
 * @param home the state home the corpus lives under
 * @param digest the lowercase-hex SHA-256 the record carries
 * @returns the parsed tree, or which way reading it failed
 */
export function readBody({
  home,
  digest,
}: {
  home: string;
  digest: string;
}): Result<readonly NotionMdNode[], NotionBodyError> {
  const path = bodyPath({ digest, home });
  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch {
    return err(NotionBodyErrors.missing({ digest, path }));
  }
  // The digest is CHECKED rather than assumed. Content-addressing makes the name a claim about the bytes,
  // and nothing enforces that claim after the write — a half-written file, a disk error or a hand-edit all
  // leave a path whose contents no longer hash to their own name. An unverified read would hand a caller a
  // tree it believes came from a page it did not, which is worse than the missing-file case because it
  // looks fine. Verifying costs one sha256 against parsing the same bytes, so it is never the reason not to.
  const actual = contentDigest({ bytes });
  if (actual !== digest) {
    return err(NotionBodyErrors.digestMismatch({ actual, digest }));
  }
  let parsed: unknown;
  try {
    parsed = safeJsonParse({ label: `notion page body tree ${digest}`, text: bytes.toString("utf8") });
  } catch (cause) {
    return err(NotionBodyErrors.unparseable({ cause, digest }));
  }
  if (!Array.isArray(parsed)) {
    return err(NotionBodyErrors.notATree({ digest }));
  }
  // What the cast cannot prove is that an OLDER shape of the tree is still assignable to today's node type.
  // That is a real risk and it is handled where it belongs — a caller that cannot use what it reads
  // re-fetches the page, which is the same recovery as a missing file.
  return ok(parsed as readonly NotionMdNode[]);
}
