/**
 * Deciding whether an already-taken create reservation is still live, or safe to release.
 *
 * Split out of `run.ts` to keep that file under this repo's own line ceiling — the logic itself belongs to
 * `performCreate`'s reserve step and has no other caller. The pure verdict a branch-pair listing gives, and
 * the lines that report it, live in `./reservationAbsence.ts`.
 */
import type { GithubWriteApi, WrittenPr } from "../../../corpus/github/write.js";
import { errorStatus } from "../../../lib/ingestError.js";
import {
  backfillPrIdentity,
  type PrRecord,
  type PrReservation,
  releasePrRecord,
  reservePr,
} from "../../../outbound/github/prLedger.js";
import type { PrForm } from "../../../outbound/github/types.js";
import {
  absenceReadFailedLine,
  absenceVerdictFor,
  ambiguousPairLine,
  backfilledNumberLine,
  foreignRecordedNumberLine,
  qualifiedHeadRef,
  releasedOnAbsenceLine,
  releasedOnClosedLine,
} from "./reservationAbsence.js";

/** Where a release is reported, so it is never silent. */
type OutSink = (args: { line: string }) => void;

/** The two write-API reads that decide staleness, and nothing else. */
type ReservationApi = Pick<GithubWriteApi, "getPr" | "listPrs">;

/** Whether a pull request GitHub reports still occupies its branch pair. */
function stillOpen({ pr }: { pr: WrittenPr }): boolean {
  return pr.state === "open";
}

/**
 * Release the locus and claim it again, reporting why in the same breath.
 *
 * @param home the state home the reservation lives in
 * @param line the operator-facing explanation
 * @param locus the branch locus
 * @param nowIso the instant of the fresh reservation
 * @param out where the explanation goes
 * @returns the fresh reservation
 */
function releasedAndRetaken({
  home,
  line,
  locus,
  nowIso,
  out,
}: {
  home: string;
  line: string;
  locus: string;
  nowIso: string;
  out: OutSink;
}): PrReservation {
  out({ line });
  releasePrRecord({ home, locus });
  return reservePr({ home, locus, nowIso });
}

/**
 * Settle a reservation whose record carries a NUMBER, by asking GitHub whether that pull request is still open.
 *
 * A closed pull request occupying a locus is not something GitHub itself objects to a fresh create for — the
 * REST API happily opens a second pull request on the same base/head pair once the first is no longer open.
 * The reservation is this repository's OWN bookkeeping, so once a live read positively confirms the recorded
 * number is no longer open (closed or merged, either), releasing it removes a purely local obstacle rather
 * than one GitHub itself ever had — this is the fix for a real refusal: a closed pull request GitHub refused
 * to reopen after a rebase, blocking every subsequent create for its branch pair with no governed way out.
 *
 * A failed read leaves the reservation standing. An unreadable API is not evidence of anything — bar a 404, and
 * a live read naming a pull request whose node id is not the recorded one. Both say the record was written by a
 * repository that once held this address, so the number names nothing here; neither proves the branch pair
 * free, so both go to {@link settledByBranchPair} without adopting what it finds. A record carrying a number but
 * no node id goes there BEFORE any read of that number: with nothing to compare, a live read cannot say whether
 * the pull request it returns is the one recorded or a successor's.
 *
 * @param api the write API, used for the one read that decides staleness
 * @param form the form, whose target names the repository the recorded number belongs to
 * @param record the record as read off disk, returned unchanged wherever the reservation stands
 * @param home the state home the reservation lives in
 * @param locus the branch locus — the create-guard key
 * @param nowIso the instant of the reservation attempt
 * @param number the recorded pull-request number
 * @param out where to report a release, so it is never silent
 * @returns `fresh` once the locus is safely reclaimed, or the reservation still held
 */
async function settledByRecordedNumber({
  api,
  form,
  home,
  locus,
  nowIso,
  number,
  out,
  record,
}: {
  api: ReservationApi;
  form: PrForm;
  home: string;
  locus: string;
  nowIso: string;
  number: number;
  out: OutSink;
  record: PrRecord;
}): Promise<PrReservation> {
  // A number with no node id cannot say WHICH pull request it meant, so the live read of that number proves
  // nothing about this record: only the branch pair can, and what it finds is never adopted.
  if (record.nodeId === undefined) {
    out({ line: foreignRecordedNumberLine({ found: "unbound", locus, number }) });
    return settledByBranchPair({ adopt: false, api, form, home, locus, nowIso, out, record });
  }
  const live = await api.getPr({ number, owner: form.target.owner, repo: form.target.repo });
  if (live.isErr()) {
    if (errorStatus({ error: live.error }) !== 404) {
      return { kind: "taken", record };
    }
    out({ line: foreignRecordedNumberLine({ found: "not-found", locus, number }) });
    return settledByBranchPair({ adopt: false, api, form, home, locus, nowIso, out, record });
  }
  if (live.value.nodeId !== record.nodeId) {
    out({ line: foreignRecordedNumberLine({ found: "another-pull-request", locus, number }) });
    return settledByBranchPair({ adopt: false, api, form, home, locus, nowIso, out, record });
  }
  if (stillOpen({ pr: live.value })) {
    return { kind: "taken", record };
  }
  return releasedAndRetaken({
    home,
    line: releasedOnClosedLine({ locus, number, state: live.value.state }),
    locus,
    nowIso,
    out,
  });
}

/**
 * Settle a reservation whose record carries NO number, by asking GitHub what is on the branch pair.
 *
 * This is the lost-create-response case, and without this path it is the one failure the auto-release cannot
 * reach: a create whose POST died leaves `{locus, reservedIso}` and nothing to read back, so the locus stays
 * claimed on behalf of a pull request that may never have existed. It was recovered by hand three times —
 * `rm` on a trust ledger, which is what the ledger exists to prevent.
 *
 * `listPrs` answers in any state, so all three outcomes are settled by one read. Zero releases the locus.
 * Exactly one recovers its number onto the record, which fixes the same hole from the other side and hands
 * the next attempt to {@link settledByRecordedNumber} — and where that one is already closed, releases in the
 * same invocation. Two or more, or a failed read, leaves the reservation standing and says so.
 *
 * It is also where a record naming ANOTHER repository's pull request lands, `adopt` false: a repository renamed
 * away left the record at an address its successor now holds. There the one pull request the listing finds is
 * the successor's, never the record's, so it is not backfilled onto the record: an open one keeps the locus
 * taken under its own number, a closed one releases it.
 *
 * @param adopt whether a single pull request found is written onto the record as the create it lost
 * @param api the write API, used for the one read that decides absence
 * @param form the form, whose target names the branch pair
 * @param record the numberless record as read off disk, returned unchanged wherever the reservation stands
 * @param home the state home the reservation lives in
 * @param locus the branch locus — the create-guard key
 * @param nowIso the instant of the reservation attempt
 * @param out where to report what the read decided, so no outcome here is silent
 * @returns `fresh` once the locus is safely reclaimed, or the reservation still held
 */
async function settledByBranchPair({
  adopt,
  api,
  form,
  home,
  locus,
  nowIso,
  out,
  record,
}: {
  adopt: boolean;
  api: ReservationApi;
  form: PrForm;
  home: string;
  locus: string;
  nowIso: string;
  out: OutSink;
  record: PrRecord;
}): Promise<PrReservation> {
  const listed = await api.listPrs({
    base: form.target.base,
    head: qualifiedHeadRef({ head: form.target.head, owner: form.target.owner }),
    owner: form.target.owner,
    repo: form.target.repo,
  });
  if (listed.isErr()) {
    out({ line: absenceReadFailedLine({ locus, message: listed.error.message }) });
    return { kind: "taken", record };
  }
  const verdict = absenceVerdictFor({ candidates: listed.value });
  if (verdict.kind === "ambiguous") {
    out({ line: ambiguousPairLine({ count: verdict.count, locus }) });
    return { kind: "taken", record };
  }
  if (verdict.kind === "absent") {
    return releasedAndRetaken({ home, line: releasedOnAbsenceLine({ locus }), locus, nowIso, out });
  }
  const found = verdict.pr;
  if (adopt) {
    out({ line: backfilledNumberLine({ locus, number: found.number }) });
    backfillPrIdentity({
      home,
      locus,
      nodeId: found.nodeId,
      nowIso,
      number: found.number,
      storedBody: found.body,
    });
  }
  if (stillOpen({ pr: found })) {
    return { kind: "taken", record: recoveredRecord({ found, record }) };
  }
  return releasedAndRetaken({
    home,
    line: releasedOnClosedLine({ locus, number: found.number, state: found.state }),
    locus,
    nowIso,
    out,
  });
}

/** The held record with the number GitHub just supplied, so the refusal names the pull request it means. */
function recoveredRecord({ found, record }: { found: WrittenPr; record: PrRecord }): PrRecord {
  return { ...record, nodeId: found.nodeId, number: found.number };
}

/**
 * Claim the locus, releasing a stale reservation first when GitHub confirms nothing live occupies it.
 *
 * Two disjoint paths, selected by whether the record on disk carries a pull-request NUMBER, and neither can
 * weaken the other because neither runs when the other does: {@link settledByRecordedNumber} reads that one
 * pull request, {@link settledByBranchPair} reads the branch pair. Every path that cannot positively disprove
 * the reservation leaves it standing. A release prints why, and so does every branch-pair outcome; a recorded
 * number that is still open, or whose read failed, returns `taken` and prints nothing here.
 *
 * @param api the write API, used for the one read that decides staleness
 * @param form the form, whose target names the repository and the branch pair
 * @param home the state home the reservation lives in
 * @param locus the branch locus — the create-guard key
 * @param nowIso the instant of the reservation attempt
 * @param out where to report a release, so it is never silent
 * @returns `fresh` once the locus is safely claimed, `taken` when it genuinely is not
 */
export async function resolvedReservation({
  api,
  form,
  home,
  locus,
  nowIso,
  out,
}: {
  api: ReservationApi;
  form: PrForm;
  home: string;
  locus: string;
  nowIso: string;
  out: OutSink;
}): Promise<PrReservation> {
  const initial = reservePr({ home, locus, nowIso });
  if (initial.kind === "fresh") {
    return initial;
  }
  const recorded = initial.record.number;
  if (recorded === undefined) {
    return settledByBranchPair({ adopt: true, api, form, home, locus, nowIso, out, record: initial.record });
  }
  return settledByRecordedNumber({
    api,
    form,
    home,
    locus,
    nowIso,
    number: recorded,
    out,
    record: initial.record,
  });
}
