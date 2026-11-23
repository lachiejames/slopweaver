/**
 * WHAT AN ASK'S REVIEW LOOKS LIKE ON DISK RIGHT NOW — the one reader every verb that weighs a reviewer
 * against a clock goes through.
 *
 * `./leaseJudgement.ts` declares the {@link ReviewPosture} shape and decides what it MEANS; this file is the
 * only thing that builds one from the files on disk. Two very different callers read it, and that is the
 * point rather than a coincidence:
 *
 * - `../../cli/commands/turn/dispatchSweep.ts` asks whether the worker's lease may end the turn.
 * - `../../cli/commands/session/closeDone.ts` asks whether a reviewer's own workspace may be CLOSED.
 *
 * It lived inside the sweep's command module until the second caller arrived — and the
 * reason it moved is the finding that brought it: `session close-done` reaped a reviewer that was
 * legitimately mid-verdict because it judged the reviewer by the PARENT ask's lease clock and never read the
 * review at all. On `C0SYN000006/1789347793.808099` the parent lease lapsed, round 2 opened
 * later on `workspace:228`, and a sweep from an unrelated seat closed it with no verdict
 * written. Two verbs judging one state from two readers is how that divergence happens, so there is one
 * reader.
 */
import type { AskIdentity } from "../ask/identity.js";
import { verdictIsSendable } from "./answerFreeze.js";
import type { ReviewPosture } from "./leaseJudgement.js";
import { readReviewRecord, readVerdictFile } from "./reviewStore.js";
import { reviewedBytesStillInHand } from "./turnJournal.js";
import { readTurnJournal } from "./turnJournalStore.js";

/**
 * Whether a reviewed answer's bytes are still waiting to be posted — false once the dispatch's first answer
 * carried exactly those bytes into the thread. Pure.
 *
 * @param postedDigest the digest of the first answer already posted, or `undefined` when none has been
 * @param reviewedDigest the digest the review record and its verdict are bound to
 * @returns whether a verdict over those bytes can still buy the lease anything
 */
export function verdictUnposted({
  postedDigest,
  reviewedDigest,
}: {
  postedDigest: string | undefined;
  reviewedDigest: string;
}): boolean {
  return postedDigest === undefined || postedDigest !== reviewedDigest;
}

/**
 * What an ask's review looks like on disk right now, for a clock judgement to weigh against.
 *
 * Reads rather than infers, and every uncertainty collapses to the posture that grants NO exemption: no
 * record, an unreadable one, a verdict that is absent, invalid, or bound to a different answer than the one
 * the record names all produce a posture the clock decides normally. A corrupt file must never buy time.
 *
 * `hasUsableVerdict` means what the lease exemption claims it means: a verdict THE DOOR WOULD ACCEPT, about
 * the bytes in hand. Three tests, and each one closed a way of holding the clock open on an answer that
 * could not actually be posted.
 *
 * - **Sendable** — `verdictIsSendable`, the door's own bar, not `outcome === "clean"` alone. A clean verdict
 *   carrying an unresolved `high`-impact claim is refused at the door (`ANSWER_CLAIM_UNRESOLVED`), and
 *   counting it usable held the lease open for a turn that had no postable answer and, worse, no cap: the
 *   usable-verdict hold in `./leaseJudgement.ts` is the one branch `MAX_REVIEW_HOLD_HOURS` does not bound.
 * - **Bound to this record's digest** — the pre-existing test, and what `ANSWER_VERDICT_STALE` checks.
 * - **Still in hand** — the turn journal's last row says whether the worker has replaced those bytes since
 *   (`./turnJournal.ts`'s `reviewedBytesStillInHand`). The record's digest does not move when the answer
 *   file does, so without this the sweep held the clock open on "a clean verdict for this exact answer is
 *   already written" straight after the rewrite that staled it.
 *
 * Everything else collapses to the posture that grants NO exemption: no record, an unreadable one, a verdict
 * absent, invalid, or superseded. A corrupt file must never buy time. A `broken` verdict is a finished
 * review with work still to do, which is exactly the case the lease is entitled to end.
 *
 * **`inFlight` and `hasUsableVerdict` are mutually exclusive by construction** — `inFlight` requires that no
 * verdict file be present at all — and `../../sessions/closeDone.ts` depends on that: a reviewer that has
 * WRITTEN its verdict is finished, so its workspace is pure cost and reaping it is correct.
 *
 * **`recordOpen` is the RECORD's own state and is deliberately wider than either.** It asks one thing —
 * whether `releasedAt` has been stamped — so it stays true across the whole review, including the window
 * where a round has returned `broken` and the next has not opened yet. That window is what
 * `./leaseJudgement.ts`'s third hold covers, and it is the ONE field here that must not be folded into
 * `inFlight`: `../../sessions/closeDone.ts` reaps on `inFlight`, and a reviewer that has written its verdict
 * is still finished, still pure cost, and still correct to reap.
 *
 * - **Not already posted** — a verdict over the bytes the dispatch's FIRST answer already carried into the
 *   thread was spent by that post. The dispatch survives a first answer (`../ask/lifecycleEvents.ts`'s
 *   `first-answered`), so without this the plan's own clean verdict held the lease open over an empty
 *   workspace and `phantom` could never fire — the blinder ({@link verdictUnposted}).
 *
 * @param askIdentity the ask being judged
 * @param home the resolved state home
 * @param postedDigest the digest of the first answer this dispatch already posted, or `undefined` when none
 * @returns the posture `./leaseJudgement.ts` reads
 */
export function reviewPostureOf({
  askIdentity,
  home,
  postedDigest,
}: {
  askIdentity: AskIdentity;
  home: string;
  postedDigest?: string | undefined;
}): ReviewPosture {
  const record = readReviewRecord({ askIdentity, home });
  if (record === undefined) {
    return { hasUsableVerdict: false, inFlight: false, recordOpen: false, spawnedAt: undefined };
  }
  const read = readVerdictFile({ record });
  const usable =
    read.kind === "present" &&
    verdictIsSendable({ verdict: read.verdict }) &&
    read.verdict.answerDigest === record.answerDigest &&
    verdictUnposted({ postedDigest, reviewedDigest: record.answerDigest }) &&
    reviewedBytesStillInHand({ reviewedDigest: record.answerDigest, rows: readTurnJournal({ askIdentity, home }) });
  return {
    hasUsableVerdict: usable,
    inFlight: record.releasedAt === undefined && read.kind !== "present",
    recordOpen: record.releasedAt === undefined,
    spawnedAt: record.spawnedAt,
  };
}
