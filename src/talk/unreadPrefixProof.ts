/**
 * Proving a call file's bytes before a reader's frontier are what was read — the prefix half of `./unreadRead.ts`'s
 * read — and keeping each proof in-process so the chair's courier does not re-hash every finished call on every
 * five-second pass. The decision of when a kept proof may stand is the pure `./unreadPrefixCache.ts`; the map of proofs
 * lives here, never exported, so nothing outside this module can hand out or change a proof it trusts.
 */
import { createHash, type Hash } from "node:crypto";
import { fstatSync } from "node:fs";

import { err, ok, type Result } from "../lib/result.js";

import { type CallOrigin, originAfterOpen } from "./callOrigin.js";
import { type UnreadError, UnreadErrors } from "./unreadErrors.js";
import { decodedLine, forEachWholeLine, NEWLINE } from "./unreadLines.js";
import {
  type PrefixFacts,
  type PrefixStat,
  prefixStillVerified,
  statUnmoved,
  type VerifiedPrefix,
} from "./unreadPrefixCache.js";
import type { CallFrontier } from "./unreadWords.js";

/** A newline, as the bytes the hash is fed after each line. */
const NEWLINE_BYTES = Buffer.from([NEWLINE]);

/** Every prefix this process has verified, by call file path — one entry per file, the latest frontier's. */
const verifiedPrefixes = new Map<string, VerifiedPrefix>();

/**
 * Hash a call file's first `length` bytes through an open descriptor, line by line, and name every segment
 * finalised in them: a later snapshot of one, past the frontier, is a finished stretch and never a live one (a partial overtaken in flight by its final can land after a mark of that final).
 *
 * @param fd the open call file
 * @param hash the hash to feed
 * @param length how many bytes from the start; the caller has checked the file is at least this long
 * @returns the ids of the segments finalised before `length`, the ids of the owner's segments with any snapshot before it,
 *   the origin each of those was first seen under, whether the last `open` or `closed` line before it is `closed`, the
 *   origin the last `open` line before it carries, the turn id of every relay line before it,
 *   and how many bytes were hashed — fewer than
 *   `length` when it is not the end of a line, which no mark writes (an offset of 1 hashed
 *   nothing, matched the empty hash, and marked the line's first byte read unprinted)
 */
function readPrefix({ fd, hash, length }: { fd: number; hash: Hash; length: number }): {
  finals: readonly string[];
  seen: readonly string[];
  ended: boolean;
  origin: CallOrigin | undefined;
  seenOrigins: ReadonlyMap<string, CallOrigin | undefined>;
  relays: readonly string[];
  hashed: number;
} {
  const finals = new Set<string>();
  const seen = new Set<string>();
  const relays = new Set<string>();
  const seenOrigins = new Map<string, CallOrigin | undefined>();
  let ended = false;
  let origin: CallOrigin | undefined;
  let hashed = 0;
  forEachWholeLine({
    end: length,
    fd,
    onLine: ({ bytes }) => {
      hash.update(bytes);
      hash.update(NEWLINE_BYTES);
      hashed += bytes.length + 1;
      const { entry } = decodedLine({ bytes });
      if (entry?.kind === "open" || entry?.kind === "closed") {
        ended = entry.kind === "closed";
      }
      if (entry?.kind === "open") {
        origin = originAfterOpen({ opened: entry.origin, previous: origin });
      }
      if (entry?.kind === "segment" && entry.who === "owner" && !seen.has(entry.id)) {
        seenOrigins.set(entry.id, origin);
      }
      if (entry?.kind === "segment" && entry.who === "owner") {
        seen.add(entry.id);
      }
      if (entry?.kind === "segment" && entry.final) {
        finals.add(entry.id);
      }
      if (entry?.kind === "relay" && entry.turnId !== null) {
        relays.add(entry.turnId);
      }
    },
    start: 0,
  });
  return { ended, finals: [...finals], hashed, origin, relays: [...relays], seen: [...seen], seenOrigins };
}

/**
 * Check every byte before the frontier is what was read, saying what those lines held and handing back the hash
 * state after them. A call never read has nothing before it. A prefix this process already proved, of a file whose
 * stat has not moved since, is not read again (`./unreadPrefixCache.ts`).
 *
 * @param callId the call, for the error
 * @param fd the open call file
 * @param path the call file, keying its kept proof
 * @param frontier where the reader stands
 * @returns the prefix's facts, the hash the tail's lines go on to feed, and — only when a kept proof was trusted
 *   rather than the bytes read — the stat it was trusted on; or why the bytes before the frontier cannot be trusted
 */
export function verifiedPrefix({
  callId,
  fd,
  path,
  frontier,
}: {
  callId: string;
  fd: number;
  path: string;
  frontier: CallFrontier | undefined;
}): Result<{ facts: PrefixFacts; hash: Hash; trustedOn: PrefixStat | undefined }, UnreadError> {
  const hash = createHash("sha256");
  if (frontier === undefined) {
    const facts: PrefixFacts = {
      endedBefore: false,
      finalBefore: [],
      originBefore: undefined,
      relaysBefore: [],
      seenBefore: [],
      seenOriginBefore: new Map(),
    };
    return ok({ facts, hash, trustedOn: undefined });
  }
  // Taken BEFORE the read, so a write landing during it leaves a stat the next pass sees as moved.
  const stat = prefixStatOf({ fd });
  const cached = verifiedPrefixes.get(path);
  if (cached !== undefined && prefixStillVerified({ cached, frontier, stat })) {
    return ok({ facts: copiedFacts({ facts: cached.facts }), hash: cached.hash.copy(), trustedOn: stat });
  }
  verifiedPrefixes.delete(path);
  if (stat.size < BigInt(frontier.offset)) {
    const why = `it is ${String(stat.size)} bytes, shorter than the ${String(frontier.offset)} already read`;
    return err(UnreadErrors.callPrefixChanged({ callId, why }));
  }
  const prefix = readPrefix({ fd, hash, length: frontier.offset });
  if (prefix.hashed !== frontier.offset) {
    const why = `offset ${String(frontier.offset)} is not the end of a line, which is all a mark records`;
    return err(UnreadErrors.callPrefixChanged({ callId, why }));
  }
  if (`sha256:${hash.copy().digest("hex")}` !== frontier.prefixSha256) {
    const why = `a byte before offset ${String(frontier.offset)} is not what was read`;
    return err(UnreadErrors.callPrefixChanged({ callId, why }));
  }
  const facts: PrefixFacts = {
    endedBefore: prefix.ended,
    finalBefore: prefix.finals,
    originBefore: prefix.origin,
    relaysBefore: prefix.relays,
    seenBefore: prefix.seen,
    seenOriginBefore: prefix.seenOrigins,
  };
  verifiedPrefixes.set(path, {
    facts: copiedFacts({ facts }),
    hash: hash.copy(),
    offset: frontier.offset,
    prefixSha256: frontier.prefixSha256,
    stat,
  });
  return ok({ facts, hash, trustedOn: undefined });
}

/**
 * Whether a kept proof a pass trusted still holds once that pass has read the file's tail: the file's stat now is the
 * one the proof was trusted on. When it is not, the proof is forgotten, so reading the file again proves every byte —
 * a rewrite landing just after the first stat is otherwise accepted for that one pass.
 *
 * @param fd the open call file
 * @param path the call file, keying its kept proof
 * @param trustedOn the stat the proof was trusted on
 * @returns true when nothing moved; false, with the proof forgotten, when the file must be read again
 */
export function trustStillHolds({ fd, path, trustedOn }: { fd: number; path: string; trustedOn: PrefixStat }): boolean {
  if (statUnmoved({ after: prefixStatOf({ fd }), before: trustedOn })) {
    return true;
  }
  verifiedPrefixes.delete(path);
  return false;
}

/**
 * Prefix facts sharing nothing mutable with the ones given — no array, map, nor origin object — so a kept proof and a
 * tail handed out never alias: a caller holding an earlier tail cannot reach into a later one. The facts are decoded call lines, plain data and one Map, which `structuredClone` copies whole.
 *
 * @param facts the facts to copy
 * @returns a deep copy
 */
function copiedFacts({ facts }: { facts: PrefixFacts }): PrefixFacts {
  return structuredClone(facts);
}

/**
 * The fields of an open file's stat a prefix proof keys on, to the nanosecond.
 *
 * @param fd the open call file
 * @returns its dev, ino, size, mtime and ctime
 */
function prefixStatOf({ fd }: { fd: number }): PrefixStat {
  const stats = fstatSync(fd, { bigint: true });
  return { ctimeNs: stats.ctimeNs, dev: stats.dev, ino: stats.ino, mtimeNs: stats.mtimeNs, size: stats.size };
}
