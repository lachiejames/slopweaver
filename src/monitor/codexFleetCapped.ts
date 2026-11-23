/**
 * `codex-fleet-capped`: no registered Codex account can take a pass, and at least one is out for capacity.
 *
 * ## Why this exists
 *
 * Every registered Codex account can be capped at once, and the owner must hear it from a note rather than from a
 * seat screen: they want Codex working, and a cap they did not know of is a failure. Rule 9's fallback is why:
 * `codex plan-fallback` and `codex review-fallback` keep every seat working, so nothing the owner reads says Codex
 * has stopped. This is the note that says it, the pass the cap is read.
 *
 * ## A notice, because nothing waits on the owner
 *
 * The rule is to wait for the reset — no plan purchase, no money ask
 * (`../hand/purchase.ts` refuses the wording). So the card asks nothing: it floats the accounts and when the first
 * resets, and it is on no queue and in no "blocked on you" list, the shape `recipe-repairing` has for the same
 * reason.
 *
 * ## Wider than the landing gates' cap, on purpose
 *
 * `../codex/fleetCap.ts` calls the fleet capped only on a positive refusal, because that is the landing gates' cap
 * witness. Here a row at the 99% routing bar (`near-cap`) counts as capacity too — the same definition the fallback
 * verbs take through the fleet's `routingPause`: a fleet all at the bar takes no pass either, which the owner wants
 * to be told. A paused row is the owner's own decision and a
 * signed-out one has its own card (`codex-plan-signed-out`), so neither is capacity, and a fleet out only for those
 * is not capped.
 *
 * ## The first reset decides the key, and the card lapses at it
 *
 * The fleet can take a pass again when the FIRST capacity row resets, so that instant names the card and keys it,
 * rounded UP to the minute so the card never lapses before the reset it names. Past that instant the filed read
 * can no longer say the fleet is capped, so the reading is `unmeasurable` until the next Codex read files again.
 *
 * Pure: a filed read in, a reading out.
 */
import type { CodexFleetCapRead } from "../codex/fleetCapPort.js";
import type { CodexFleetCapRecord, CodexFleetRow } from "../codex/fleetCapRecord.js";
import { fitLine } from "../hand/push/notice.js";
import { UNBLOCKS_CAP } from "../hand/step.js";

import type { MonitorReading, MonitorSubject } from "./types.js";

/** The key of a card whose capacity rows name no reset at all. */
const NO_RESET_KEY = "no-reset";

/** A key naming the minute the first reset falls in, rounded up: `until-<yyyy-mm-dd>t1710`. */
const MINUTE_KEY = /^until-(\d{4}-\d{2}-\d{2})t(\d{2})(\d{2})$/;

/** Where the verb that files the record is named, for an absent one. */
const FILED_BY = "`slopweaver codex route`, `codex status` or any Codex pass";

/** The whole-minute ceiling of an instant, as epoch milliseconds. */
function minuteCeilingMs({ iso }: { iso: string }): number {
  const minuteMs = 60_000;
  return Math.ceil(Date.parse(iso) / minuteMs) * minuteMs;
}

/**
 * An instant to the minute, as the card prints it.
 *
 * @returns `<yyyy-mm-dd>T<hh:mm>Z`
 */
function minuteText({ ms }: { ms: number }): string {
  return `${new Date(ms).toISOString().slice(0, 16)}Z`;
}

/**
 * The key a capped fleet's card is posted under, from the first reset.
 *
 * @param firstResetAtIso the earliest reset among the capacity rows, or undefined when none names one
 * @returns `until-<yyyy-mm-dd>t<hhmm>` rounded up to the minute, or `no-reset`
 */
export function fleetCapKey({ firstResetAtIso }: { firstResetAtIso: string | undefined }): string {
  if (firstResetAtIso === undefined) {
    return NO_RESET_KEY;
  }
  const iso = new Date(minuteCeilingMs({ iso: firstResetAtIso })).toISOString();
  return `until-${iso.slice(0, 10)}t${iso.slice(11, 13)}${iso.slice(14, 16)}`;
}

/**
 * The instant a `codex-fleet-capped` card's key says the cap is over.
 *
 * @param key a step key as {@link fleetCapKey} wrote it
 * @returns the reset minute as ISO-8601, or `undefined` for `no-reset`, which never lapses on a clock
 */
export function fleetCapKeyLapsesAt({ key }: { key: string }): string | undefined {
  const match = MINUTE_KEY.exec(key);
  if (match === null) {
    return undefined;
  }
  return `${match[1]!}T${match[2]!}:${match[3]!}:00.000Z`;
}

/** Whether a row is out for capacity rather than for the owner's pause or a missing sign-in. */
function isCapacity({ row }: { row: CodexFleetRow }): boolean {
  return row.state === "near-cap" || row.state === "quota-refused";
}

/**
 * The earliest named reset among some rows, or undefined when none names one.
 *
 * @returns the row carrying it
 */
function firstReset({ rows }: { rows: readonly CodexFleetRow[] }): CodexFleetRow | undefined {
  let first: CodexFleetRow | undefined;
  for (const row of rows) {
    if (row.resetAtIso === undefined) {
      continue;
    }
    if (first?.resetAtIso === undefined || Date.parse(row.resetAtIso) < Date.parse(first.resetAtIso)) {
      first = row;
    }
  }
  return first;
}

/**
 * One row as the card's `unblocks` names it.
 *
 * @returns `codex-one resets <yyyy-mm-dd>T<hh:mm>Z`, `codex-ambient names no reset`, or `codex-two signed-out`
 */
function rowClause({ row }: { row: CodexFleetRow }): string {
  if (!isCapacity({ row })) {
    return `${row.alias} ${row.state}`;
  }
  if (row.resetAtIso === undefined) {
    return `${row.alias} names no reset`;
  }
  return `${row.alias} resets ${minuteText({ ms: minuteCeilingMs({ iso: row.resetAtIso }) })}`;
}

/**
 * The subject a capped fleet is carded as.
 *
 * @param record the filed read
 * @param capacity its capacity rows
 * @param first the capacity row resetting first, when one names a reset
 * @returns the one subject
 */
function cappedSubject({
  capacity,
  first,
  record,
}: {
  capacity: readonly CodexFleetRow[];
  first: CodexFleetRow | undefined;
  record: CodexFleetCapRecord;
}): MonitorSubject {
  const count = `${String(capacity.length)} of ${String(record.rows.length)} accounts`;
  const until =
    first?.resetAtIso === undefined
      ? "and none names a reset"
      : `until ${minuteText({ ms: minuteCeilingMs({ iso: first.resetAtIso }) })}`;
  return {
    id: `${count} ${until}`,
    key: fleetCapKey({ firstResetAtIso: first?.resetAtIso }),
    label: record.rows.map((row) => rowClause({ row })).join(", "),
  };
}

/**
 * Evaluate `codex-fleet-capped` over the record the last fleet read filed.
 *
 * @param read what reading the record found
 * @param nowIso the instant the pass judges at
 * @returns firing over the whole fleet, clear when a row is eligible or none is out for capacity, or unmeasurable
 */
export function evaluateCodexFleetCapped({
  nowIso,
  read,
}: {
  nowIso: string;
  read: CodexFleetCapRead;
}): MonitorReading {
  if (read.kind === "absent") {
    return {
      because: `no Codex fleet read has been filed yet — ${FILED_BY} files one`,
      monitorId: "codex-fleet-capped",
      state: "unmeasurable",
    };
  }
  if (read.kind === "malformed" || read.kind === "unreadable") {
    return {
      because: `the Codex fleet record in the store is ${read.kind}: ${read.why}`,
      monitorId: "codex-fleet-capped",
      state: "unmeasurable",
    };
  }
  if (read.kind === "unfiled") {
    // The record is an earlier read's: drawing it would clear a cap the later, unfiled read may have seen.
    return {
      because:
        `the Codex fleet read at ${read.attemptedAtIso} did not file its record (${read.why}), so the earlier one ` +
        `filed no longer describes the fleet — the next read by ${FILED_BY} decides`,
      monitorId: "codex-fleet-capped",
      state: "unmeasurable",
    };
  }
  const { record } = read;
  const capacity = record.rows.filter((row) => isCapacity({ row }));
  if (record.rows.some((row) => row.state === "eligible") || capacity.length === 0) {
    return { monitorId: "codex-fleet-capped", state: "clear" };
  }
  const first = firstReset({ rows: capacity });
  if (first?.resetAtIso !== undefined && minuteCeilingMs({ iso: first.resetAtIso }) <= Date.parse(nowIso)) {
    return {
      because:
        `the last Codex fleet read, at ${record.readAtIso}, predates ${first.alias}'s reset at ${first.resetAtIso} — ` +
        `the next read by ${FILED_BY} decides`,
      monitorId: "codex-fleet-capped",
      state: "unmeasurable",
    };
  }
  return { monitorId: "codex-fleet-capped", state: "firing", subjects: [cappedSubject({ capacity, first, record })] };
}

/**
 * What a `codex-fleet-capped` card says is waiting on the owner: nothing, and every account's state.
 *
 * @param subject the capped fleet
 * @returns the line, fitted to the register's cap
 */
export function fleetCapUnblocks({ subject }: { subject: MonitorSubject }): string {
  return fitLine({ cap: UNBLOCKS_CAP, text: `nothing — ${subject.label}` });
}
