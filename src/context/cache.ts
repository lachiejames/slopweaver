/**
 * The last-known-good copy of the always-loaded context, so a session start never depends on a database
 * being up.
 *
 * The ruling is that loading is mechanically enforced. A mechanism that only works while the local
 * Supabase stack is running is not enforced — it is enforced on a good day. So every successful read
 * writes this file, and a read that cannot reach the store emits the cache with its own age stamped on
 * it. That is a weaker claim than "current", and it is stated rather than hidden: the block says it is a
 * cache, how old it is, and why the live read failed.
 *
 * ## It is derived, never an authority
 *
 * Nothing edits this file. Supabase is the single place a fact about the owner or a person is changed, and this
 * is a projection of it that happens to survive the database being down. A file that could be edited
 * would be a second place to change a fact, which is the split the ruling removes.
 *
 * ## Why it is bound to the database it came from
 *
 * `storeFingerprint` is a hash of the connection string, not the string itself — a connection string can
 * carry a password and this file is not a secret store. It exists so a cache captured against one
 * database is never emitted against another: on a machine that repoints `SLOPWEAVER_STORE_URL`, the stale
 * cache would otherwise describe a different install's owner with no way for a reader to tell.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

import { z } from "zod";

import { err, ok, type Result } from "../lib/result.js";
import { safeJsonParse, safeJsonStringify } from "../lib/safeJson.js";
import { writeFileAtomic } from "../lib/writeAtomic.js";
import { type VoiceCohort, voiceCohortSchema } from "../store/profile/types.js";

import { type ContextCacheError, ContextCacheErrors } from "./errors.js";

/** The cache-file version. A file at another version is ignored rather than reinterpreted. */
const CONTEXT_CACHE_SCHEMA_VERSION = 1;

/** What the cache file holds. */
const contextCacheSchema = z.object({
  schemaVersion: z.literal(CONTEXT_CACHE_SCHEMA_VERSION),
  /** A hash of the connection string this was read from, so it is never emitted against another database. */
  storeFingerprint: z.string().min(1),
  /** When the live read that produced these lines happened. */
  capturedAtIso: z.iso.datetime(),
  /** The rendered lines, exactly as they were injected at capture time. */
  lines: z.array(z.string()),
  /**
   * The measured length cohorts, structured rather than rendered.
   *
   * Carried beside the lines so the outbound doors can read the register SYNCHRONOUSLY and without a
   * database — a voice check that opened a connection would run on every send, and one that could not run
   * offline would be a check that silently stops checking. Defaulted so a cache written before this field
   * existed still parses as a cache with no calibration, which is the true statement about it.
   */
  voiceRegister: z.array(voiceCohortSchema).default([]),
});

/** The cache, parsed. */
export type ContextCache = z.infer<typeof contextCacheSchema>;

/**
 * The fingerprint one connection string gets, so two caches are comparable without storing a credential.
 *
 * @param url the connection string
 * @returns the first 16 hex characters of its sha256, which is enough to distinguish databases and too
 *   little to attack
 */
export function storeFingerprint({ url }: { url: string }): string {
  return createHash("sha256").update(url, "utf8").digest("hex").slice(0, 16);
}

/**
 * Read the cache, refusing a file that is missing, malformed, at another version, or from another database.
 *
 * Every one of those is the same answer to the caller in PRACTICE — there is no usable cache, and it says
 * so either way — which is why each variant's `message` is the whole display. They are named variants
 * rather than bare strings because {@link ../context/errors} is where the set is readable at once, and
 * because a caller that ever does want to tell a fresh install from a corrupted one should not do it by
 * comparing prose.
 *
 * @param path where the cache file sits
 * @param expectedFingerprint the fingerprint of the database being read now
 * @returns the cache, or the typed reason it is not usable
 */
export function readContextCache({
  path,
  expectedFingerprint,
}: {
  path: string;
  expectedFingerprint: string;
}): Result<ContextCache, ContextCacheError> {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return err(ContextCacheErrors.absent());
  }
  let parsedJson: unknown;
  try {
    parsedJson = safeJsonParse({ label: "context cache", text: raw });
  } catch {
    return err(ContextCacheErrors.unreadable());
  }
  const parsed = contextCacheSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return err(ContextCacheErrors.staleSchema());
  }
  if (parsed.data.storeFingerprint !== expectedFingerprint) {
    return err(
      ContextCacheErrors.foreignStore({ actual: parsed.data.storeFingerprint, expected: expectedFingerprint }),
    );
  }
  return ok(parsed.data);
}

/**
 * Write the cache atomically, so a killed hook cannot leave a half-written file the next one reads.
 *
 * Creates the directory first, because a first run on a fresh install has no `$SLOPWEAVER_HOME/profile`
 * and a cache that only appeared on the SECOND session start would be a fallback absent exactly when a
 * new machine most needs one. It lives here rather than in a caller so this module owns the whole write.
 *
 * A cache the reader would refuse is never written: {@link readContextCache} rejects the whole file when one cohort
 * fails its schema, so writing one would leave the send door with no register at all.
 *
 * @param path where the cache file sits
 * @param cache what to write
 * @returns nothing on success, or the write failure
 */
export function writeContextCache({
  path,
  cache,
}: {
  path: string;
  cache: ContextCache;
}): Result<true, ContextCacheError> {
  const valid = contextCacheSchema.safeParse(cache);
  if (!valid.success) {
    return err(ContextCacheErrors.writeFailed({ cause: valid.error }));
  }
  const encoded = safeJsonStringify({ label: "context cache", value: cache });
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileAtomic({ contents: `${encoded}\n`, path });
    writeFileAtomic({ contents: contextCopyText({ cache }), path: contextCopyPath({ cachePath: path }) });
  } catch (error) {
    return err(ContextCacheErrors.writeFailed({ cause: error }));
  }
  return ok(true);
}

/**
 * Where the plain-text copy of a cache's lines sits: beside it, `.txt` for `.json`. It exists for the one reader that
 * cannot parse JSON — `hooks/lib/profile-delivered.sh`'s recovery lane, which delivers the owner's profile when no node gate
 * can run at all — and is rewritten with every cache, so it is never older than the cache.
 * Bash cannot compute the store fingerprint, so that lane emits it without the database check {@link readContextCache}
 * makes: the one residue is a store repointed on a machine whose runtime is also gone.
 *
 * @param cachePath where the cache file sits
 * @returns the copy's path
 */
export function contextCopyPath({ cachePath }: { cachePath: string }): string {
  return cachePath.endsWith(".json") ? `${cachePath.slice(0, -".json".length)}.txt` : `${cachePath}.txt`;
}

/**
 * The plain-text copy's contents: a line naming when it was captured, then the lines exactly as they were injected.
 *
 * @param cache the cache being written
 * @returns the text
 */
function contextCopyText({ cache }: { cache: ContextCache }): string {
  return [
    `# The owner's profile, as last read live from the store at ${cache.capturedAtIso}`,
    "",
    ...cache.lines,
    "",
  ].join("\n");
}

/**
 * The measured length cohorts a cache holds, ignoring which database it was captured against.
 *
 * The fingerprint check {@link readContextCache} applies is deliberately skipped here, and the reason is
 * the difference between the two payloads: the context block names PEOPLE and rows from one database, so
 * emitting it against another would describe a different install; a length cohort is a measurement of how
 * the OWNER writes, which is the same fact whichever database it was read out of. A voice check that refused to
 * run because the store URL had been repointed would be a check that stops checking for a reason the
 * caller cannot see.
 *
 * @param path where the cache file sits
 * @returns the cohorts, or none when there is no usable cache
 */
export function readCachedVoiceRegister({ path }: { path: string }): readonly VoiceCohort[] {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  let parsedJson: unknown;
  try {
    parsedJson = safeJsonParse({ label: "context cache", text: raw });
  } catch {
    return [];
  }
  const parsed = contextCacheSchema.safeParse(parsedJson);
  return parsed.success ? parsed.data.voiceRegister : [];
}

/**
 * How old a cache is, in whole minutes, as the phrase the stale banner uses.
 *
 * Whole minutes rather than a duration library: the number exists so a reader can decide whether to
 * trust a line, and "captured 3 minutes ago" and "captured 4,120 minutes ago" are the only two answers
 * that change anything.
 *
 * @param cache the cache being emitted
 * @param nowIso the instant it is being emitted at
 * @returns the age in whole minutes, never negative
 */
export function cacheAgeMinutes({ cache, nowIso }: { cache: ContextCache; nowIso: string }): number {
  const elapsed = Date.parse(nowIso) - Date.parse(cache.capturedAtIso);
  return Math.max(0, Math.floor(elapsed / 60_000));
}
