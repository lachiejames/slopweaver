/**
 * The owner's protect list as a corpus verb honours it: one judge per operation, and the one line a refusal says.
 *
 * The committer (`./corpusWriter.ts`) is the single seam every bronze append goes through, and before it asked here it
 * read a source's whole bronze tree for its dedup index and appended to it without asking the protect list at all — so
 * a refresh of a source the owner marked `no-access` read every row and wrote more. The `PreToolUse` guard cannot see
 * that: it judges a tool call's operands, never a path a verb resolves for itself. The corpus READERS had the same
 * blind spot, and ask the same judge: `./bronzeStorage.ts`'s listing, `./corpusDirRead.ts`'s tally and every walk
 * through `./corpusStore.ts`'s `scanJsonlProtected`.
 *
 * A walk's root is judged as a `list` and REFUSED when an entry covers it. Every entry the walk meets is judged as a
 * `list` before it is statted or followed, and a `.jsonl` as a `read` before it is opened; a covered one is SKIPPED
 * and named in the walk's result (`ProtectedSkip`), so one `no-access` entry under a root never refuses a reader of
 * the rest of it. A file about to be written is a `write`, which a `read-only` entry refuses as well. Each path is
 * judged under its lexical and its resolved spelling (`../protectedPaths/ownerEntries.ts`), so a symlink into a
 * protected tree is skipped before anything under it is listed or read.
 *
 * The protect list is read afresh for every judge built, so an entry the owner adds mid-run refuses the next
 * operation, and a registry that has since become unreadable refuses every later one. Judging and opening are
 * separate system calls, so a path swapped for a symlink between the two is not caught; that residue is stated in
 * `docs/security/protected-paths.md`.
 */
import { err, ok, type Result } from "#lib/result.js";

import { type PathAccess, protectionHitAny } from "../protectedPaths/decide.js";
import {
  type OwnerProtectionError,
  ownerProtectionFor,
  resolvedPathSpellings,
} from "../protectedPaths/ownerEntries.js";
import type { ProtectedPath } from "../protectedPaths/registry.js";

import type { CorpusSource } from "./types.js";

/** Resolves the owner's protect-list entries; production reads both registries, a test injects its own. */
export type OwnerProtectionResolver = () => Result<readonly ProtectedPath[], OwnerProtectionError>;

/** Refuses one access a corpus verb is about to make, with the one line that says why. */
export type CorpusJudge = (args: { access: PathAccess; path: string }) => Result<void>;

/** What a refusal says the verb was doing: `refusing to <verb> <target>`. */
export interface ProtectionOperation {
  /** What the verb does, as a refusal says it: `read`, `write`, `compact`. */
  readonly verb: string;
  /** What it does it to: a source, or `the corpus`. */
  readonly target: string;
}

const VERB: Readonly<Record<PathAccess, string>> = { list: "list", read: "read", search: "search", write: "write to" };

/**
 * The one line a protected corpus access is refused with, naming the operation, the path, the entry that covers it
 * and the owner's own reason — whitespace collapsed, so a reason recorded over several lines stays one line here.
 *
 * @param operation what the verb was doing
 * @param access what it was about to do to the path
 * @param path the path it was about to touch
 * @param entry the protect-list entry that refuses it
 * @returns the refusal line
 */
function protectedCorpusRefusal({
  operation,
  access,
  path,
  entry,
}: {
  operation: ProtectionOperation;
  access: PathAccess;
  path: string;
  entry: ProtectedPath;
}): string {
  const why = entry.why.replace(/\s+/gu, " ").trim();
  return (
    `refusing to ${operation.verb} ${operation.target}: it would ${VERB[access]} ${path}, which the owner's protect ` +
    `list marks ${entry.mode} at ${entry.path} (${why})`
  );
}

/**
 * The one line a protected bronze access is refused with: {@link protectedCorpusRefusal} as the bronze writer says it.
 *
 * @param source the source being written
 * @param access what the committer was about to do
 * @param path the path it was about to do it to
 * @param entry the protect-list entry that refuses it
 * @returns the refusal line
 */
export function protectedBronzeRefusal({
  source,
  access,
  path,
  entry,
}: {
  source: CorpusSource;
  access: PathAccess;
  path: string;
  entry: ProtectedPath;
}): string {
  return protectedCorpusRefusal({ access, entry, operation: { target: source, verb: "write" }, path });
}

/**
 * The one line an operation is refused with when the owner's protection cannot be read at all.
 *
 * @param operation what the verb was doing
 * @param error why the protect list could not be read
 * @returns the refusal line
 */
function protectionUnknownRefusal({
  operation,
  error,
}: {
  operation: ProtectionOperation;
  error: OwnerProtectionError;
}): string {
  return `refusing to ${operation.verb} ${operation.target}: ${error.message.replace(/\s+/gu, " ").trim()}`;
}

/**
 * The resolver a corpus verb calls: the injected one, or both of the owner's registries read afresh on every call.
 *
 * Never held between operations. A committer lives for a whole crawl, so a list read once would miss an entry the
 * owner added mid-run and keep writing past a registry that has since become unreadable — failing closed only on the
 * first commit. Two small files per judge is the price.
 *
 * @param home the Slopweaver home the verb runs against
 * @param protection an injected resolver, which a test supplies so it never reads the owner's own registry
 * @returns the resolver the verb calls
 */
export function protectionResolver({
  home,
  protection,
}: {
  home: string;
  protection?: OwnerProtectionResolver | undefined;
}): OwnerProtectionResolver {
  if (protection !== undefined) {
    return protection;
  }
  return () => ownerProtectionFor({ home });
}

/**
 * One path a judged walk left out because the owner's protect list covers it: never statted, followed or opened.
 *
 * @internal — an element of a walk's `protectedSkipped`, which every reporting caller names.
 */
export interface ProtectedSkip {
  /** The path the walk met, as it spelled it — inside the entry, or a symlink resolving into it. */
  readonly path: string;
  /** The entry that covers it, carried whole so a caller names it exactly as `protect list` prints its path. */
  readonly entry: ProtectedPath;
}

/**
 * What a judged walk asks of the owner's protect list: refuse a step outright, or name the entry covering one.
 *
 * A walk REFUSES its own root when an entry covers it and SKIPS a covered child, which it names in its result: one
 * `no-access` entry under a root must never refuse every reader of the rest of that root.
 */
export interface CorpusWalkJudge {
  /** Refuses an access an entry covers, with the one line that says why. */
  readonly judge: CorpusJudge;
  /** The entry an access reaches under any spelling of its path, or `undefined` when none does. */
  readonly coverOf: (args: { access: PathAccess; path: string }) => ProtectedPath | undefined;
}

/**
 * The walk judge for one corpus operation, or the refusal when the owner's protection cannot be read.
 *
 * @param operation what the verb is doing, as its refusal says it
 * @param protection resolves the owner's entries
 * @returns a judge that refuses any access an entry covers, and the lookup naming that entry
 */
export function corpusWalkJudgeFor({
  operation,
  protection,
}: {
  operation: ProtectionOperation;
  protection: OwnerProtectionResolver;
}): Result<CorpusWalkJudge> {
  const entries = protection();
  if (entries.isErr()) {
    return err([protectionUnknownRefusal({ error: entries.error, operation })]);
  }
  const coverOf = ({ access, path }: { access: PathAccess; path: string }): ProtectedPath | undefined =>
    protectionHitAny({ access, entries: entries.value, targets: resolvedPathSpellings({ path }) });
  const judge: CorpusJudge = ({ access, path }) => {
    const hit = coverOf({ access, path });
    if (hit === undefined) {
      return ok(undefined);
    }
    return err([protectedCorpusRefusal({ access, entry: hit, operation, path })]);
  };
  return ok({ coverOf, judge });
}

/**
 * The judge for one corpus operation, or the refusal when the owner's protection cannot be read.
 *
 * @param operation what the verb is doing, as its refusal says it
 * @param protection resolves the owner's entries
 * @returns a judge that refuses any access an entry covers, under every spelling of its path
 */
export function corpusJudgeFor({
  operation,
  protection,
}: {
  operation: ProtectionOperation;
  protection: OwnerProtectionResolver;
}): Result<CorpusJudge> {
  return corpusWalkJudgeFor({ operation, protection }).map((walk) => walk.judge);
}

/**
 * The walk judge for one source's commit: {@link corpusWalkJudgeFor} as the bronze writer words it.
 *
 * @param source the source being written
 * @param protection resolves the owner's entries
 * @returns a judge that refuses any access an entry covers, and the lookup naming that entry
 */
export function bronzeJudgeFor({
  source,
  protection,
}: {
  source: CorpusSource;
  protection: OwnerProtectionResolver;
}): Result<CorpusWalkJudge> {
  return corpusWalkJudgeFor({ operation: { target: source, verb: "write" }, protection });
}

/**
 * The one line a judged walk names a skipped path with: the protect list's own entry path, its mode, and the path the
 * walk met when that differs (a symlink resolving into the entry).
 *
 * @param skip what the walk left out
 * @returns the line, never the skipped path's contents
 */
export function protectedSkipLine({ skip }: { skip: ProtectedSkip }): string {
  const via = skip.path === skip.entry.path ? "" : ` (met as ${skip.path})`;
  return `${skip.entry.path} [${skip.entry.mode}]${via}`;
}
