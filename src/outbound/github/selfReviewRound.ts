/**
 * One confirmed self-review round: its record, how it decodes, and whose it is.
 *
 * Split out of `./selfReviewLedger.ts`, which owns the files, the lock and every read and write, along the seam
 * between the ledger's storage and the record it stores: nothing here touches the filesystem.
 */
import { isRecord } from "../../lib/parsers.js";

/**
 * One confirmed self-review round, as decoded from disk.
 *
 * `pullRequestId` is the pull request's GraphQL node id, and it is what binds the round to ONE pull request.
 * The locus is an ADDRESS, and an address outlives what it names: a repository renamed away leaves its old
 * `owner/repo` free for a fresh repository, whose `#4` is a different pull request with the same locus. A
 * round recorded before rounds were bound carries no id at all, which is a real state rather than a corrupt
 * one — it simply grants no ownership.
 */
export interface SelfReviewRoundRecord {
  readonly locus: string;
  readonly pullRequestId?: string | undefined;
  readonly headSha: string;
  readonly formHash: string;
  readonly threadIds: readonly string[];
  readonly confirmedIso: string;
}

/** A round bound to the pull request it was posted on — the only shape a confirmation writes. */
export type BoundSelfReviewRoundRecord = SelfReviewRoundRecord & { readonly pullRequestId: string };

/** A round recorded at this address that is not this pull request's, so none of its threads are ours. */
export interface SelfReviewRoundSetAside {
  readonly kind: "set-aside";
  readonly locus: string;
  readonly confirmedIso: string;
}

/** What the ledger holds for one pull request: nothing, its own round, or a round set aside as another's. */
export type SelfReviewRoundRead =
  | { readonly kind: "absent" }
  | { readonly kind: "owned"; readonly record: BoundSelfReviewRoundRecord }
  | SelfReviewRoundSetAside;

/**
 * The thread ids a new round may resolve: an owned round's, and none from an absent or set-aside one.
 *
 * @param read what the ledger held for this pull request
 * @returns the thread ids this pull request's last round owns
 */
export function ownedThreadIds({ read }: { read: SelfReviewRoundRead }): readonly string[] {
  return read.kind === "owned" ? read.record.threadIds : [];
}

/**
 * The set-aside round a read found, so the caller can report it, or undefined when there was none.
 *
 * @param read what the ledger held for this pull request
 * @returns the set-aside round, or undefined
 */
export function setAsideRound({ read }: { read: SelfReviewRoundRead }): SelfReviewRoundSetAside | undefined {
  return read.kind === "set-aside" ? read : undefined;
}

/** Parse a non-empty array of opaque GitHub node ids. */
function threadIdsOf({ value }: { value: unknown }): readonly string[] | undefined {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((item) => typeof item !== "string" || item.length === 0)
  ) {
    return undefined;
  }
  const threadIds = value;
  return new Set(threadIds).size === threadIds.length ? threadIds : undefined;
}

/**
 * Decode a confirmed round. Unreadable state grants no ownership.
 *
 * @param raw the candidate JSON bytes
 * @returns the record, or undefined when any ownership field is invalid
 */
export function parseSelfReviewRound({ raw }: { raw: string }): SelfReviewRoundRecord | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) {
      return undefined;
    }
    const threadIds = threadIdsOf({ value: parsed["threadIds"] });
    const pullRequestId = parsed["pullRequestId"];
    const boundOrUnbound = pullRequestId === undefined || (typeof pullRequestId === "string" && pullRequestId !== "");
    if (
      typeof parsed["locus"] !== "string" ||
      typeof parsed["headSha"] !== "string" ||
      typeof parsed["formHash"] !== "string" ||
      typeof parsed["confirmedIso"] !== "string" ||
      threadIds === undefined ||
      !boundOrUnbound
    ) {
      return undefined;
    }
    return {
      confirmedIso: parsed["confirmedIso"],
      formHash: parsed["formHash"],
      headSha: parsed["headSha"],
      locus: parsed["locus"],
      ...(typeof pullRequestId === "string" ? { pullRequestId } : {}),
      threadIds,
    };
  } catch {
    return undefined;
  }
}
