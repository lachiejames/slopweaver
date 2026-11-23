/**
 * The in-process memory of which call-file prefixes `./unreadRead.ts` has already verified, so the chair's courier
 * stops re-reading and re-hashing every call it ever heard on each five-second pass.
 *
 * ## Why, measured
 *
 * `talk courier --follow` calls `readUnread` on every five-second pass (`COURIER_WAKE_EVERY_MS`), and every call file with a
 * cursor frontier had every byte before that frontier read, JSON-decoded and SHA-256-hashed again to prove it is what
 * was read — 15 MB of call history at the time (`du -sh "$SLOPWEAVER_HOME/talk/calls"`), growing with every call, so
 * the follower's CPU grew without bound. Repro of the live cost: `ps -o time= -p <the courier's node pid>` twice, a
 * known wall interval apart.
 *
 * ## The criterion
 *
 * A prefix proven once by its bytes is then trusted on its STAT: the same file (dev, ino), the same size, the same
 * mtime AND ctime to the nanosecond, and the same frontier (offset and prefix hash). That is a weaker guarantee than
 * re-hashing, taken on purpose (the handover row that asked for this named exactly that key): equal stats are not a
 * content proof, so a rewrite that leaves all five fields equal is trusted until the file next moves. ctime is in the
 * key beyond mtime because user space cannot set it, so a same-size rewrite with its mtime put back by `utimes` still
 * re-verifies; what is left is a privileged restore of the metadata or a write the filesystem never stamps.
 * The stat is the one taken BEFORE the verifying read: a write landing during that read leaves the file with a stat
 * that differs from the cached one, so the next pass re-verifies rather than trusting bytes it never saw. A pass that
 * trusts a proof stats the file again once its tail is read, and re-reads it uncached if anything moved in between
 * (a rewrite landing just after the first stat would otherwise be accepted for that one pass), so
 * against a write that moves the stat a hit is never laxer than the uncached read, whose own window is a write landing
 * after its bytes were read.
 *
 * The call still being spoken grows every few seconds and so misses on every pass, exactly as before; every finished
 * call hits.
 *
 * ## What a hit still costs, measured on 41 calls
 *
 * A pass over the real home took 121 ms of CPU uncached and 31 ms cached; deep-copying the kept facts (3,671 ids and
 * origins in all) is about 3.5 ms of that. Repro: time `readUnread` twenty times in one process with
 * `process.cpuUsage()`, in this tree and at a commit before this module existed.
 *
 * {@link prefixStillVerified} is the pure decision. The map of proofs is private to `./unreadPrefixProof.ts`, never
 * exported, so nothing outside that module can hand out or change a proof it trusts.
 */
import type { Hash } from "node:crypto";

import type { CallTail } from "./unreadWords.js";

/** What a call's lines before the frontier say, as a tail carries it. */
export type PrefixFacts = Pick<
  CallTail,
  "endedBefore" | "finalBefore" | "originBefore" | "relaysBefore" | "seenBefore" | "seenOriginBefore"
>;

/** A call file's identity and shape, as one `fstat` with `bigint: true` reads them. */
export interface PrefixStat {
  readonly dev: bigint;
  readonly ino: bigint;
  readonly size: bigint;
  readonly mtimeNs: bigint;
  readonly ctimeNs: bigint;
}

/** What one verification proved: which file, as it stood, up to which frontier. */
export interface PrefixProof {
  readonly stat: PrefixStat;
  readonly offset: number;
  readonly prefixSha256: string;
}

/** A proof, plus what the verifying read learned: the prefix's facts and the hash state after its last byte. */
export interface VerifiedPrefix extends PrefixProof {
  readonly facts: PrefixFacts;
  /** Never fed: a reader takes `hash.copy()` and feeds that. */
  readonly hash: Hash;
}

/**
 * Whether a prefix proven earlier still stands, so its bytes need not be read and hashed again: the file's stat is
 * identical in every field and the frontier is the one it was proven up to.
 *
 * @param cached the last proof for this path, if any
 * @param stat the file's stat now, taken before any read of it
 * @param frontier the frontier the reader stands at now
 * @returns true only when nothing that could change the prefix has changed
 */
export function prefixStillVerified({
  cached,
  stat,
  frontier,
}: {
  cached: PrefixProof | undefined;
  stat: PrefixStat;
  frontier: { readonly offset: number; readonly prefixSha256: string };
}): boolean {
  if (cached === undefined) {
    return false;
  }
  return (
    cached.offset === frontier.offset &&
    cached.prefixSha256 === frontier.prefixSha256 &&
    statUnmoved({ after: stat, before: cached.stat })
  );
}

/**
 * Whether two stats of one call file agree in every field the proof keys on.
 *
 * @param before the earlier stat
 * @param after the later stat
 * @returns true only when dev, ino, size, mtime and ctime are all equal
 */
export function statUnmoved({ before, after }: { before: PrefixStat; after: PrefixStat }): boolean {
  return (
    before.dev === after.dev &&
    before.ino === after.ino &&
    before.size === after.size &&
    before.mtimeNs === after.mtimeNs &&
    before.ctimeNs === after.ctimeNs
  );
}
