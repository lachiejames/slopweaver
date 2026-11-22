/**
 * The write-side preflight every corpus REWRITER asks before its first byte: one ordered list of every path the
 * operation will read, list, write or tree-write, judged in full against the owner's protect list before any effect.
 *
 * Why a batch rather than a check at each write: an operation that touches several paths (compaction unlinking a
 * source's window files, a share rewrite across files, a receipt sweep) would otherwise change file A before
 * discovering that file B is covered, and a writer here is a REFUSER, never a partial writer. So the whole set is
 * judged first, and the first refusal stops the operation with the judge's own line (`./bronzeProtection.ts`).
 *
 * A `tree-write` is a write that may create or replace ANY descendant of its root (a staged export, a subset home),
 * refused when an entry covers the root or lies anywhere beneath it.
 */
import { ok, type Result } from "#lib/result.js";

import type { PathAccess } from "../protectedPaths/decide.js";
import {
  type CorpusWalkJudge,
  corpusWalkJudgeFor,
  type OwnerProtectionResolver,
  type ProtectionOperation,
  protectionResolver,
} from "./bronzeProtection.js";

/** One path an operation will touch, and how. */
export interface CorpusAccess {
  /** A judge access, or `tree-write` for a write that may land anywhere beneath `path`. */
  readonly access: PathAccess | "tree-write";
  readonly path: string;
}

/**
 * Judge every access in the order given, stopping at the first one the owner's protect list covers.
 *
 * @param walk the operation's judge, built once for the whole batch
 * @param accesses every path the operation will touch, in the order it touches them
 * @returns nothing when every access is allowed, or the first refusal's line
 */
function judgeCorpusAccesses({
  walk,
  accesses,
}: {
  walk: CorpusWalkJudge;
  accesses: readonly CorpusAccess[];
}): Result<void> {
  for (const { access, path } of accesses) {
    const judged = access === "tree-write" ? walk.judgeTreeWrite({ path }) : walk.judge({ access, path });
    if (judged.isErr()) {
      return judged;
    }
  }
  return ok(undefined);
}

/**
 * The preflight a corpus rewriter calls before its first effect: the owner's protect list read once for the
 * operation, every access judged, and the judge handed back so a later step of the same operation (a sink, a sweep)
 * asks the very list the preflight did.
 *
 * @param home the Slopweaver home whose registries apply, beside the account's own default
 * @param protection an injected resolver, which a test supplies so it never reads the owner's own registry
 * @param operation what the verb is doing, as its refusal says it
 * @param accesses every path the operation will touch, in the order it touches them
 * @returns the operation's judge, or the refusal when the list cannot be read or covers an access
 */
export function preflightCorpusAccesses({
  home,
  protection,
  operation,
  accesses,
}: {
  home: string;
  protection: OwnerProtectionResolver | undefined;
  operation: ProtectionOperation;
  accesses: readonly CorpusAccess[];
}): Result<CorpusWalkJudge> {
  return corpusWalkJudgeFor({ operation, protection: protectionResolver({ home, protection }) }).andThen((walk) =>
    judgeCorpusAccesses({ accesses, walk }).map(() => walk),
  );
}
