/**
 * The three-bucket former-staff join, and the residue the three buckets do not cover.
 *
 * ## The buckets are decided by the READ STAMP, never by the wall clock
 *
 * A platform's atlas can only ever speak as of its own last successful read. So for one person who has left
 * and one platform where they still hold an account:
 *
 * - **confirmed** — their last day falls at or before that platform's read stamp. They had left, and the
 *   platform still showed them live when it was read. This is a finding, and it still wants a human confirm
 *   before anything is revoked.
 * - **unmeasured** — their last day falls AFTER the read stamp. The atlas cannot say either way, because it
 *   was read while they were still employed. A resync moves them into confirmed or into clean.
 * - **clean** — they hold no live account on any platform read.
 *
 * **Printing the unmeasured bucket is a requirement, not a courtesy.** It is staleness made visible: without
 * it, the next resync resolving twenty people looks exactly like a spike of twenty new violations, and the
 * report that caused that misreading would be this one.
 *
 * ## The fourth thing, which the buckets cannot hold
 *
 * A platform row whose address the roster does not carry at all is **unjoinable** — neither confirmed,
 * unmeasured nor clean, because there is no employment record to compare. A platform can hold seats the
 * roster has no person for, and an unjoinable row at a privileged level is the most interesting row on the
 * page. So it is counted per platform and listed under `--json`, and the three
 * buckets stay exactly as they were settled.
 */
import { parseStrictIsoInstantMs } from "#lib/date.js";

import { formerStaffOf, type Roster, type RosterPerson } from "./roster.js";
import type { AccessPlatformRows, AccessRow } from "./rows.js";

/** Which bucket one person falls in. */
export type AccessBucket = "confirmed" | "unmeasured" | "clean";

/** What one platform said about one former employee. */
export interface PlatformFinding {
  readonly platform: string;
  /** The row's levels, rendered as `label=value` pairs for the ones that are present. */
  readonly levels: readonly string[];
  /** That platform's own read stamp, which is what decided the bucket. */
  readonly readStampIso: string | null;
  readonly bucket: AccessBucket;
}

/** One former employee, and every platform that still shows them holding an account. */
export interface FormerStaffRow {
  readonly email: string;
  readonly display: string | null;
  readonly endDateIso: string | null;
  readonly bucket: AccessBucket;
  /** One entry per platform that still holds a live account for them, in table order. */
  readonly findings: readonly PlatformFinding[];
}

/** One platform's read stamp, paired with the rows it contributed. */
export interface JoinSubject {
  readonly rows: AccessPlatformRows;
  /** The kind's `lastSuccessAt`, or `null` when the manifest records no successful read. */
  readonly readStampIso: string | null;
}

/** The whole join. */
export interface FormerStaffJoin {
  readonly confirmed: readonly FormerStaffRow[];
  readonly unmeasured: readonly FormerStaffRow[];
  /** How many former staff hold no live account on any platform read. */
  readonly clean: number;
  /** Former staff carrying no end date, so no bucket could be computed — named, never counted away. */
  readonly unbucketable: readonly string[];
  /**
   * Addresses the roster holds a departed spell AND a live spell for. A naive report counts each of these as
   * a finding; this one does not, and publishes the count so the difference is visible rather than silent.
   */
  readonly rehired: readonly string[];
  /** Statuses that are neither CURRENT nor FORMER, so this report computes no bucket from them. */
  readonly nonDepartureStatuses: readonly { readonly status: string; readonly addresses: number }[];
  /** Per platform, the addresses it holds that the roster does not, sorted. */
  readonly unjoinable: readonly { readonly platform: string; readonly addresses: readonly string[] }[];
}

/** The `label=value` pairs a finding prints, dropping only the fields the record does not carry. */
function presentLevels({ row }: { row: AccessRow }): readonly string[] {
  return row.levels.filter((level) => level.value !== null).map((level) => `${level.label}=${String(level.value)}`);
}

/**
 * Which bucket one live account falls in, given when the person left and when the platform was read.
 *
 * A platform with NO read stamp is `unmeasured`: it has never reported a successful read of this kind, so it
 * cannot witness anything about anyone. An end date that does not parse is `unmeasured` for the same reason —
 * there is no instant to compare.
 *
 * @param endDateIso the person's employment end date, as the roster stores it
 * @param readStampIso the platform kind's last successful read
 * @returns `confirmed` when they had left before the read, `unmeasured` otherwise
 */
export function bucketFor({
  endDateIso,
  readStampIso,
}: {
  endDateIso: string | null;
  readStampIso: string | null;
}): "confirmed" | "unmeasured" {
  if (endDateIso === null || readStampIso === null) {
    return "unmeasured";
  }
  // Strict, so a string `Date.parse` would guess at (a bare "0", a date with no zone) is no instant at all.
  const endMs = parseStrictIsoInstantMs({ text: endDateIso });
  const readMs = parseStrictIsoInstantMs({ text: readStampIso });
  if (endMs === undefined || readMs === undefined) {
    return "unmeasured";
  }
  return endMs <= readMs ? "confirmed" : "unmeasured";
}

/** Every platform that still shows one person holding an account, in subject order. */
function findingsFor({
  person,
  subjects,
}: {
  person: RosterPerson;
  subjects: readonly JoinSubject[];
}): readonly PlatformFinding[] {
  return subjects.flatMap((subject): readonly PlatformFinding[] => {
    const row = subject.rows.rows.find((candidate) => candidate.email === person.email);
    if (row === undefined || !row.holds) {
      return [];
    }
    return [
      {
        bucket: bucketFor({ endDateIso: person.endDateIso, readStampIso: subject.readStampIso }),
        levels: presentLevels({ row }),
        platform: subject.rows.platform,
        readStampIso: subject.readStampIso,
      },
    ];
  });
}

/**
 * A person's overall bucket: the worst thing any platform says about them.
 *
 * `confirmed` on one platform is confirmed overall — one platform witnessing a live account after the person
 * left is a finding whatever the others say. With no finding at all they are `clean` here, before
 * `witnessedBucket` asks whether every platform's read came after they left.
 *
 * @param findings every platform that still shows them holding an account
 * @returns the bucket the person's row belongs in
 */
export function overallBucket({ findings }: { findings: readonly PlatformFinding[] }): AccessBucket {
  if (findings.some((finding) => finding.bucket === "confirmed")) {
    return "confirmed";
  }
  if (findings.length > 0) {
    return "unmeasured";
  }
  return "clean";
}

/**
 * The bucket once every platform's read is weighed, not only the ones holding an account.
 *
 * CLEAN needs the same witness CONFIRMED does: a read taken AFTER the person left. A platform read before
 * they left, showing no account, says nothing about the day after — one could have been created in between —
 * so a person with no finding is still `unmeasured` while any platform's read predates the departure.
 */
function witnessedBucket({
  findings,
  person,
  subjects,
}: {
  findings: readonly PlatformFinding[];
  person: RosterPerson;
  subjects: readonly JoinSubject[];
}): AccessBucket {
  const bucket = overallBucket({ findings });
  if (bucket !== "clean") {
    return bucket;
  }
  const unwitnessed = subjects.some(
    (subject) => bucketFor({ endDateIso: person.endDateIso, readStampIso: subject.readStampIso }) === "unmeasured",
  );
  if (unwitnessed) {
    return "unmeasured";
  }
  return "clean";
}

/**
 * Join the roster's former staff against every platform's rows.
 *
 * @param roster the spine
 * @param subjects one entry per platform carrying a per-user level, in the order to report them
 * @returns the three buckets, the unbucketable names and the per-platform unjoinable residue
 */
export function joinFormerStaff({
  roster,
  subjects,
}: {
  roster: Roster;
  subjects: readonly JoinSubject[];
}): FormerStaffJoin {
  const rosterAddresses = new Set(roster.people.map((person) => person.email));
  const rows = formerStaffOf({ roster }).map((person): FormerStaffRow => {
    const findings = findingsFor({ person, subjects });
    return {
      bucket: witnessedBucket({ findings, person, subjects }),
      display: person.display,
      email: person.email,
      endDateIso: person.endDateIso,
      findings,
    };
  });
  return {
    clean: rows.filter((row) => row.bucket === "clean").length,
    confirmed: rows.filter((row) => row.bucket === "confirmed"),
    nonDepartureStatuses: roster.nonDepartureStatuses,
    rehired: roster.rehired,
    unbucketable: roster.formerWithoutEndDate,
    unjoinable: subjects.map((subject) => ({
      addresses: subject.rows.rows
        .filter((row) => !rosterAddresses.has(row.email))
        .map((row) => row.email)
        .toSorted(),
      platform: subject.rows.platform,
    })),
    unmeasured: rows.filter((row) => row.bucket === "unmeasured"),
  };
}
