/**
 * Durable ownership for inline self-review rounds.
 *
 * A confirmed record answers exactly which GitHub thread ids Slopweaver may resolve on the next update. The
 * per-pull-request reservation directory is created exclusively before a mutation and removed only after the
 * new thread ids have been read back and persisted. A lost response therefore leaves the slot held: future
 * runs refuse instead of posting a duplicate review or guessing which human-authored threads they own.
 */
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readdirSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { writeFileAtomic } from "#lib/writeAtomic.js";

import { readFileIfPresent } from "../../atlas/atlasFile.js";
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { stateHomePaths } from "../../stateHome.js";
import type { SelfReviewForm } from "./selfReview.js";
import { type BoundSelfReviewRoundRecord, parseSelfReviewRound, type SelfReviewRoundRead } from "./selfReviewRound.js";

/** One mutation intent, persisted before any GitHub write. */
export interface SelfReviewReservationRecord {
  readonly locus: string;
  readonly headSha: string;
  readonly formHash: string;
  readonly reservedIso: string;
}

/**
 * A fresh reservation carries what the ledger held for this pull request, read under the lock: only an
 * `owned` round's threads may be resolved by this write. An unreadable one names why a record cannot be
 * trusted: the previous round, whose reservation this call took and has already released since nothing was
 * attempted, or a hold already there, which this call never took.
 */
export type SelfReviewReservation =
  | { readonly kind: "fresh"; readonly previous: SelfReviewRoundRead }
  // `previous` rides a lost race too, so a round set aside before the lock was refused is still reported.
  | {
      readonly kind: "taken";
      readonly pending: SelfReviewReservationRecord | null;
      readonly previous: SelfReviewRoundRead;
    }
  | { readonly kind: "unreadable"; readonly reason: string };

/** Whether local confirmation completed after GitHub's readback. */
export type SelfReviewConfirmation =
  { readonly kind: "confirmed" } | { readonly kind: "failed"; readonly reason: string };

/**
 * Build a stable pull-request address used only for local ownership, never GitHub authorisation.
 *
 * It names where a round's record lives and which lock a send takes, never WHICH pull request owns the round:
 * that is the record's `pullRequestId`, because a renamed repository's address is reused by its successor.
 *
 * @param owner the repository owner
 * @param repo the repository name
 * @param number the pull-request number
 * @returns the normalised local ownership locus
 */
export function selfReviewLocus({ owner, repo, number }: { owner: string; repo: string; number: number }): string {
  return `${owner.toLowerCase()}/${repo.toLowerCase()}#${String(number)}`;
}

/**
 * Digest the validated form so a held reservation can name the attempt without storing prose.
 *
 * @param form the complete validated self-review round
 * @returns a bounded stable digest
 */
export function selfReviewFormHash({ form }: { form: SelfReviewForm }): string {
  return createHash("sha256").update(JSON.stringify(form), "utf8").digest("hex").slice(0, 32);
}

/** Filesystem-safe name for a pull-request locus. */
function filename({ locus }: { locus: string }): string {
  return createHash("sha256").update(locus, "utf8").digest("hex").slice(0, 32);
}

function ledgerDir({ home }: { home: string }): string {
  return join(stateHomePaths({ home }).ledgers, "github-self-reviews");
}

function roundPath({ home, locus }: { home: string; locus: string }): string {
  return join(ledgerDir({ home }), `${filename({ locus })}.json`);
}

function reservationDir({ home, locus }: { home: string; locus: string }): string {
  return join(ledgerDir({ home }), `${filename({ locus })}.lock`);
}

function reservationPath({ home, locus }: { home: string; locus: string }): string {
  return join(reservationDir({ home, locus }), "reservation.json");
}

function ensureLedgerDir({ home }: { home: string }): void {
  mkdirSync(ledgerDir({ home }), { recursive: true });
}

/**
 * Decode an unresolved mutation intent.
 *
 * @param raw the candidate JSON bytes
 * @returns the reservation, or undefined when any intent field is invalid
 */
function parseSelfReviewReservation({ raw }: { raw: string }): SelfReviewReservationRecord | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      !isRecord(parsed) ||
      typeof parsed["locus"] !== "string" ||
      typeof parsed["headSha"] !== "string" ||
      typeof parsed["formHash"] !== "string" ||
      typeof parsed["reservedIso"] !== "string"
    ) {
      return undefined;
    }
    return {
      formHash: parsed["formHash"],
      headSha: parsed["headSha"],
      locus: parsed["locus"],
      reservedIso: parsed["reservedIso"],
    };
  } catch {
    return undefined;
  }
}

/**
 * Read the last confirmed Slopweaver-owned round for one pull request.
 *
 * A record that is there but unreadable, malformed or for another locus is refused, never read as no round:
 * read as none, the next round posted beside the old walkthrough instead of retiring it.
 *
 * A well-formed record at this locus that is not bound to `pullRequestId` — bound to another pull request, or
 * written before rounds were bound — is SET ASIDE: it grants no thread to resolve, and the caller says so. That
 * is the case of a repository renamed away and a fresh one taking its address: resolving the old round's
 * thread ids would close threads on the archived pull request while reporting them as this one's.
 *
 * @param home the state home holding the ledger
 * @param locus the normalised pull-request locus
 * @param pullRequestId the live pull request's GraphQL node id, which alone decides ownership
 * @returns the owned round, `absent`, a set-aside round, or why the record on disk cannot be trusted
 */
export function readSelfReviewRound({
  home,
  locus,
  pullRequestId,
}: {
  home: string;
  locus: string;
  pullRequestId: string;
}): Result<SelfReviewRoundRead> {
  const path = roundPath({ home, locus });
  const untrusted = ({ detail }: { detail: string }): Result<never> =>
    err([
      `the self-review round record for ${locus} at ${path} is there but cannot be trusted (${detail}) — delete ` +
        "it and retire the previous walkthrough on GitHub by hand, since this round cannot know which one it was",
    ]);
  const text = readFileIfPresent({ path });
  if (text.isErr()) {
    return untrusted({ detail: text.error.join("; ") });
  }
  if (text.value === null) {
    return ok({ kind: "absent" });
  }
  const record = parseSelfReviewRound({ raw: text.value });
  if (record === undefined || record.locus !== locus) {
    return untrusted({ detail: "it is not a confirmed round for this pull request" });
  }
  if (record.pullRequestId !== pullRequestId) {
    return ok({ confirmedIso: record.confirmedIso, kind: "set-aside", locus });
  }
  return ok({ kind: "owned", record: { ...record, pullRequestId } });
}

/**
 * Read a held reservation: `null` when no lock records one, a refusal when the record there cannot be trusted.
 *
 * Exported for the callers allowed to inspect a hold without acting on it: `self-review release` peeks here
 * first, so it can refuse a `--head` mismatch instead of releasing a DIFFERENT concurrent reservation, and a
 * send checks here before its door call, so a corrupt hold is refused before anything is attempted.
 *
 * @param home the state home holding the ledger
 * @param locus the normalised pull-request locus
 * @returns the held reservation, `null` when none is recorded, or why the record on disk cannot be trusted
 */
export function readSelfReviewReservation({
  home,
  locus,
}: {
  home: string;
  locus: string;
}): Result<SelfReviewReservationRecord | null> {
  const path = reservationPath({ home, locus });
  const text = readFileIfPresent({ path });
  if (text.isOk() && text.value === null) {
    return ok(null);
  }
  let detail = "it is not a reservation for this pull request";
  if (text.isErr()) {
    detail = text.error.join("; ");
  } else if (text.value !== null) {
    const record = parseSelfReviewReservation({ raw: text.value });
    if (record?.locus === locus) {
      return ok(record);
    }
  }
  return err([
    `the self-review reservation for ${locus} at ${path} is there but cannot be trusted (${detail}) — read the ` +
      "pull request back on GitHub to see whether that round landed, then delete it",
  ]);
}

/**
 * Exclusively reserve one pull request before its composite GraphQL mutation.
 *
 * @param home the state home
 * @param intent the exact round being attempted
 * @param pullRequestId the live pull request's GraphQL node id, passed beside the intent so the lock record's
 *   bytes stay what `self-review release` and `doctor` already read
 * @returns what the ledger held for this pull request, the held intent that blocks another send, or why the
 *   prior round's record cannot be trusted
 */
export function reserveSelfReviewRound({
  home,
  intent,
  pullRequestId,
}: {
  home: string;
  intent: SelfReviewReservationRecord;
  pullRequestId: string;
}): SelfReviewReservation {
  // A round record already corrupt is refused before the ledger is touched. The read under the lock below
  // still decides, since a concurrent confirm may land between the two.
  const before = readSelfReviewRound({ home, locus: intent.locus, pullRequestId });
  if (before.isErr()) {
    return { kind: "unreadable", reason: before.error.join("; ") };
  }
  ensureLedgerDir({ home });
  try {
    mkdirSync(reservationDir({ home, locus: intent.locus }));
    writeFileSync(reservationPath({ home, locus: intent.locus }), JSON.stringify(intent), { flag: "wx" });
  } catch {
    const held = readSelfReviewReservation({ home, locus: intent.locus });
    if (held.isErr()) {
      return { kind: "unreadable", reason: held.error.join("; ") };
    }
    return { kind: "taken", pending: held.value, previous: before.value };
  }
  const previous = readSelfReviewRound({ home, locus: intent.locus, pullRequestId });
  if (previous.isErr()) {
    releaseSelfReviewReservation({ home, locus: intent.locus });
    return { kind: "unreadable", reason: previous.error.join("; ") };
  }
  return { kind: "fresh", previous: previous.value };
}

/**
 * Whether the reservation lock itself stands, record or no record. A lock holding no record is still a hold —
 * {@link reserveSelfReviewRound} cannot take it — so a caller checking before the door asks this, not only
 * whether a record reads back.
 *
 * @returns true when anything stands at the lock's path, a dangling link included
 */
export function selfReviewLockHeld({ home, locus }: { home: string; locus: string }): boolean {
  try {
    lstatSync(reservationDir({ home, locus }));
    return true;
  } catch {
    return false;
  }
}

/**
 * Release a held reservation unconditionally, for the one caller allowed to do so without proof the write
 * never happened: the deliberate operator-recovery verb `self-review release`.
 *
 * The automated round lifecycle in `selfReviewRun.ts` never calls this except immediately after a pre-write
 * refusal it issued itself (no GitHub mutation attempted, so nothing to lose by releasing). Every other
 * failure — a submitted-but-unconfirmed round — must stay held until a human or agent has read the pull
 * request back and confirmed what actually landed; this function does not make that judgement.
 *
 * @param home the state home holding the ledger
 * @param locus the normalised pull-request locus
 * @returns the released reservation, or undefined when none was held or the one held cannot be
 *   trusted — that one is left in place for `self-review release` to name
 */
export function releaseSelfReviewReservation({
  home,
  locus,
}: {
  home: string;
  locus: string;
}): SelfReviewReservationRecord | undefined {
  const held = readSelfReviewReservation({ home, locus });
  if (held.isErr() || held.value === null) {
    return undefined;
  }
  const record = held.value;
  try {
    unlinkSync(reservationPath({ home, locus }));
  } catch {
    // already gone
  }
  try {
    rmdirSync(reservationDir({ home, locus }));
  } catch {
    // not empty, or already gone
  }
  return record;
}

/** One held reservation older than a caller-supplied threshold, surfaced for `doctor`. */
export interface SelfReviewPendingReservation {
  readonly locus: string;
  readonly headSha: string;
  readonly reservedIso: string;
  readonly ageMs: number;
}

/**
 * Every held self-review reservation older than `olderThanMs`, oldest first.
 *
 * Local-only and read-only: no GitHub call, so it stays free for `doctor` to run on every session start.
 * An unreadable ledger directory or a malformed reservation is skipped rather than treated as an error —
 * `doctor` reports the environment, it does not diagnose its own ledger's JSON.
 *
 * @param home the state home holding the ledger
 * @param nowMs the current wall-clock instant, in epoch milliseconds
 * @param olderThanMs the minimum age, in milliseconds, for a held reservation to be reported
 * @returns every stale reservation found, oldest first
 */
export function pendingSelfReviewReservations({
  home,
  nowMs,
  olderThanMs,
}: {
  home: string;
  nowMs: number;
  olderThanMs: number;
}): readonly SelfReviewPendingReservation[] {
  let entries: readonly string[];
  try {
    entries = readdirSync(ledgerDir({ home }));
  } catch {
    return [];
  }
  const stale: SelfReviewPendingReservation[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".lock")) {
      continue;
    }
    let raw: string;
    try {
      raw = readFileSync(join(ledgerDir({ home }), entry, "reservation.json"), "utf8");
    } catch {
      continue;
    }
    const record = parseSelfReviewReservation({ raw });
    if (record === undefined) {
      continue;
    }
    const reservedMs = Date.parse(record.reservedIso);
    const ageMs = Number.isNaN(reservedMs) ? Number.POSITIVE_INFINITY : nowMs - reservedMs;
    if (ageMs >= olderThanMs) {
      stale.push({ ageMs, headSha: record.headSha, locus: record.locus, reservedIso: record.reservedIso });
    }
  }
  return stale.toSorted((a, b) => b.ageMs - a.ageMs);
}

/**
 * Persist the new owned thread ids, then release the reservation.
 *
 * The record is always bound to the pull request it was posted on, and replacing the file retires whatever
 * round a previous occupant of this address left there.
 *
 * @param home the state home
 * @param record the exactly confirmed round
 * @returns whether both persistence and reservation cleanup completed
 */
export function confirmSelfReviewRound({
  home,
  record,
}: {
  home: string;
  record: BoundSelfReviewRoundRecord;
}): SelfReviewConfirmation {
  try {
    writeFileAtomic({ contents: JSON.stringify(record), path: roundPath({ home, locus: record.locus }) });
    unlinkSync(reservationPath({ home, locus: record.locus }));
    rmdirSync(reservationDir({ home, locus: record.locus }));
    return { kind: "confirmed" };
  } catch (error: unknown) {
    return { kind: "failed", reason: error instanceof Error ? error.message : String(error) };
  }
}
