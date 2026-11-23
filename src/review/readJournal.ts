/**
 * The landing-read cursor: when the fleet landing read last completed, per selection — and the pure gate that
 * decides whether THIS tick is the one that reads. Where the cursor lives is `./readJournalPort.ts`: the
 * `landing_read_cursor` table in the store.
 *
 * ## Why a register and not a sentence
 *
 * `github landing` is rationed by the GitHub rate limit, and a limit enforced by PROSE in skill files rations
 * nothing — it only stops the read happening. A chair's whole shift could go by without one, a pull request
 * dropped from the merge queue would sit conflicted for days, and nothing would notice.
 *
 * So the ration is a MECHANISM: the sweep runs `github landing --if-due` on EVERY tick, this register
 * answers whether the cadence has elapsed, and a tick that is not due makes zero GitHub requests. The
 * rate-limit concern is answered by construction rather than by a rule somebody has to remember.
 *
 * ## Time, not ticks
 *
 * A tick count is state this verb cannot see, and a tick is not a unit: the sweep re-arms at ~300s while the
 * queue is non-empty and 1200s otherwise. The wall clock is the only thing both halves agree on.
 *
 * ## One row per selection, not a stream — which the press register deliberately is
 *
 * Only the LATEST read per selection decides anything here, so the store holds exactly that: one row per
 * selection, changed by compare-and-set. The press register is a stream for the opposite reason: which pull
 * request was pressed at which head is history, and losing an older row loses a fact.
 *
 * ## Which way each unknown falls
 *
 * A VALID absence resolves toward READING, because the measured failure is a read that never happened and the
 * cost of an extra one is a handful of points out of an hourly 5,000. So a selection with no row, and a row
 * dated in the FUTURE, both answer `due` — the latter because a clock that moved backwards must not wedge the
 * read shut forever.
 *
 * Failed KNOWLEDGE is not absence. A store that cannot be read, or a row that does not decode, never reaches
 * {@link readDue}: `github landing` refuses before any GitHub request, and says why.
 */

import { parseStrictIsoInstantMs } from "#lib/date.js";
import { err, ok, type Result } from "#lib/result.js";

import { isRecord } from "../lib/parsers.js";
import { type ReadDecodeError, ReadDecodeErrors } from "./readJournalErrors.js";

/** Milliseconds in a minute, so the arithmetic below reads as the unit it is in. */
const MS_PER_MINUTE = 60_000;

/**
 * The largest instant `new Date(ms).toISOString()` can render, from the ECMAScript time-value range.
 *
 * Named rather than inlined because {@link readDue} tests it to keep an un-renderable next-due from throwing
 * out of a pure function: past this, `toISOString` raises `RangeError: Invalid time value`.
 */
const MAX_INSTANT_MS = 8_640_000_000_000_000;

/** One completed fleet read. */
export interface ReadRecord {
  /** When the read COMPLETED. A read that failed records nothing, so the cadence stays due. */
  readonly atIso: string;
  /** The selection it covered, as {@link selectionKey} spells one. */
  readonly selection: string;
  /** How many open pull requests it judged. */
  readonly rows: number;
  /** How many of them the supervisor may dispatch a session for. */
  readonly dispatchable: number;
}

/**
 * The key one selection's read is filed under.
 *
 * Lower-cased and SORTED, so `--repo a/x,a/y` and `--repo a/y,a/x` are one selection rather than two that
 * each read every tick while believing the other's read was somebody else's.
 *
 * A drafts-only read (`github landing --drafts-only`) is filed under the same key plus {@link DRAFTS_ONLY_SUFFIX},
 * so it keeps a ration of its own rather than sharing — and skipping, or being skipped by — the press read's.
 *
 * @param repos the repositories the invocation reads
 * @param author the author filter, or undefined for every author
 * @param draftsOnly whether the read selects only drafts
 * @returns the canonical key
 */
export function selectionKey({
  repos,
  author,
  draftsOnly = false,
}: {
  repos: readonly string[];
  author: string | undefined;
  draftsOnly?: boolean;
}): string {
  const slugs = repos.map((slug) => slug.toLowerCase()).toSorted();
  const base = `${slugs.join(",")}@${author === undefined ? "*" : author.toLowerCase()}`;
  return draftsOnly ? `${base}${DRAFTS_ONLY_SUFFIX}` : base;
}

/** What a drafts-only selection's key ends in. `#` appears in no slug and in no GitHub login. */
const DRAFTS_ONLY_SUFFIX = "#drafts";

/** One `owner/name` slug: two non-empty halves, no whitespace, comma or further slash. */
const SLUG = /^[^\s,/@]+\/[^\s,/@]+$/u;

/**
 * Whether a key is exactly what {@link selectionKey} spells for some invocation. A stored key that is not — a
 * trailing space, an upper-case letter, an unsorted list — would never be looked up, so it would read as a
 * selection nobody has read: corrupt, and refused rather than filed beside the canonical one.
 *
 * @param selection the key a read is filed under
 * @returns true only for a canonical key
 */
function isCanonicalSelection({ selection }: { selection: string }): boolean {
  // The FIRST `@`: a slug never carries one, and an author filter can — `--author @me` files under `…@@me`.
  const at = selection.indexOf("@");
  if (at < 0 || /\s/u.test(selection)) {
    return false;
  }
  const draftsOnly = selection.endsWith(DRAFTS_ONLY_SUFFIX);
  const body = draftsOnly ? selection.slice(0, -DRAFTS_ONLY_SUFFIX.length) : selection;
  const repoPart = body.slice(0, at);
  const authorPart = body.slice(at + 1);
  const repos = repoPart === "" ? [] : repoPart.split(",");
  if (authorPart === "" || authorPart.includes("#") || !repos.every((slug) => SLUG.test(slug))) {
    return false;
  }
  const author = authorPart === "*" ? undefined : authorPart;
  return selectionKey({ author, draftsOnly, repos }) === selection;
}

/**
 * Decode one read, strictly: every field present and well-formed, or the sentence saying which is not.
 *
 * Used for an entry of the old file and for a stored row alike, so the two cannot disagree about what a read is.
 *
 * @param selection the key the read is filed under
 * @param entry the entry's fields
 * @returns the record, or why it is not one
 */
export function decodeReadRecord({
  selection,
  entry,
}: {
  selection: string;
  entry: unknown;
}): Result<ReadRecord, ReadDecodeError> {
  if (selection === "") {
    return err(ReadDecodeErrors.selectionEmpty());
  }
  if (!isCanonicalSelection({ selection })) {
    return err(ReadDecodeErrors.selectionNotCanonical());
  }
  if (!isRecord(entry)) {
    return err(ReadDecodeErrors.notAnObject());
  }
  const { atIso, rows, dispatchable } = entry;
  // Strict, never `Date.parse`: that rolls an impossible day over into the next month, so a corrupt instant would make a read due.
  if (typeof atIso !== "string" || parseStrictIsoInstantMs({ text: atIso }) === undefined) {
    return err(ReadDecodeErrors.fieldInvalid({ field: "atIso", qualifier: "parseable" }));
  }
  if (typeof rows !== "number" || !Number.isInteger(rows) || rows < 0) {
    return err(ReadDecodeErrors.fieldInvalid({ field: "rows", qualifier: "non-negative integer" }));
  }
  if (typeof dispatchable !== "number" || !Number.isInteger(dispatchable) || dispatchable < 0) {
    return err(ReadDecodeErrors.fieldInvalid({ field: "dispatchable", qualifier: "non-negative integer" }));
  }
  if (dispatchable > rows) {
    return err(ReadDecodeErrors.countsInconsistent());
  }
  return ok({ atIso, dispatchable, rows, selection });
}

/**
 * Decode the old `landing-reads.json` document strictly: one bad entry refuses the whole document.
 *
 * @param value whatever the file parsed to
 * @returns one record per selection, or every problem in it
 */
export function decodeReadDocument({ value }: { value: unknown }): Result<readonly ReadRecord[]> {
  if (!isRecord(value)) {
    return err([ReadDecodeErrors.documentNotAnObject().message]);
  }
  const records: ReadRecord[] = [];
  const problems: string[] = [];
  for (const [selection, entry] of Object.entries(value)) {
    const decoded = decodeReadRecord({ entry, selection });
    if (decoded.isErr()) {
      problems.push(`${JSON.stringify(selection)} ${decoded.error.message}`);
    } else {
      records.push(decoded.value);
    }
  }
  if (problems.length > 0) {
    return err(problems);
  }
  return ok(records);
}

/** Whether this tick reads, and the sentence behind either answer. */
export type ReadCadence =
  | { readonly kind: "due"; readonly why: string; readonly lastReadAtIso: string | undefined }
  | {
      readonly kind: "skip";
      readonly why: string;
      readonly lastReadAtIso: string;
      readonly nextDueAtIso: string;
    };

/**
 * Whether the fleet read is due for one selection.
 *
 * Pure: no clock of its own, no store. Every VALID unknown answers `due`, because the failure this gate exists
 * to prevent is a read that never happens.
 *
 * @param reads the latest read per selection, as the cursor port returns them
 * @param selection the key this invocation reads under
 * @param cadenceMinutes how long one read holds
 * @param now the instant to judge against
 * @returns the verdict, with the sentence a reader sees
 */
export function readDue({
  reads,
  selection,
  cadenceMinutes,
  now,
}: {
  reads: ReadonlyMap<string, ReadRecord>;
  selection: string;
  cadenceMinutes: number;
  now: Date;
}): ReadCadence {
  const last = reads.get(selection);
  if (last === undefined) {
    return { kind: "due", lastReadAtIso: undefined, why: `no fleet read is recorded for ${selection}` };
  }
  const lastMs = Date.parse(last.atIso);
  const nowMs = now.getTime();
  if (lastMs > nowMs) {
    return {
      kind: "due",
      lastReadAtIso: last.atIso,
      why:
        `the newest recorded read for ${selection} is dated ${last.atIso}, which is in the future — a clock ` +
        "that moved backwards must not hold the read shut",
    };
  }
  const nextDueMs = lastMs + cadenceMinutes * MS_PER_MINUTE;
  if (!Number.isFinite(nextDueMs) || Math.abs(nextDueMs) > MAX_INSTANT_MS) {
    return {
      kind: "due",
      lastReadAtIso: last.atIso,
      why:
        `a cadence of ${String(cadenceMinutes)} minute(s) puts the next read for ${selection} outside the ` +
        "range a date can express, and an unnameable next read must not hold this one shut",
    };
  }
  if (nowMs >= nextDueMs) {
    return {
      kind: "due",
      lastReadAtIso: last.atIso,
      why: `${String(minutesSince({ fromMs: lastMs, toMs: nowMs }))} minute(s) since the last read of ${selection}`,
    };
  }
  return {
    kind: "skip",
    lastReadAtIso: last.atIso,
    nextDueAtIso: new Date(nextDueMs).toISOString(),
    why:
      `${selection} was read ${String(minutesSince({ fromMs: lastMs, toMs: nowMs }))} minute(s) ago and the ` +
      `cadence is ${String(cadenceMinutes)} minute(s), so this tick makes no GitHub request`,
  };
}

/** Whole minutes between two instants, floored, so a verdict never claims a precision it has not got. */
function minutesSince({ fromMs, toMs }: { fromMs: number; toMs: number }): number {
  return Math.floor((toMs - fromMs) / MS_PER_MINUTE);
}
