/**
 * Reading the door ledger's `status: "refused"` rows back — the half that makes the row worth writing.
 *
 * The finding this closes was not "the ledger is missing data". It was that answering "did that card ever
 * try to go out, and what stopped it" cost a CODE READ. A row nobody can query is the same cost with more
 * bytes, so the writer (`./ledger.ts`) and this reader land together.
 *
 * ## Two properties this module exists to hold
 *
 * **It is bounded by the query, not the ledger.** The rows live in the store's `door_event`
 * (`./doorLedgerPort.ts`), and the newest `limit` refusals are one indexed query, so memory is the LIMIT rather
 * than the 200,000-row trail. This module is the pure half: decoding one stored record, and rendering it.
 *
 * **It states its own bound.** Exactly one gate writes these rows today, so an empty result means "the voice
 * gate refused nothing", never "nothing stopped it". {@link preDoorRefusalCoverageLines} prints that on
 * every run including the empty one; a reader who has to already know the coverage is a reader who will
 * read the empty result as an answer.
 */
import { isRecord } from "../lib/parsers.js";
import type { PreDoorRefusalFinding } from "./ledger.js";

/** One decoded refusal row. Every field is what the writer put there; nothing is derived. */
export interface PreDoorRefusalEntry {
  readonly gate: string;
  readonly surface: string;
  /** The register id of the hatch that would have let the body through, verbatim — an older row names its variable. */
  readonly hatch: string;
  readonly runId: string;
  readonly tsIso: string;
  readonly findings: readonly PreDoorRefusalFinding[];
}

/** The findings of one record, dropping any member that is not the shape the writer emits. Pure. */
function findingsOf({ value }: { value: unknown }): readonly PreDoorRefusalFinding[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const findings: PreDoorRefusalFinding[] = [];
  for (const member of value) {
    if (!isRecord(member)) {
      continue;
    }
    const { code, message, path } = member;
    if (typeof code === "string" && typeof message === "string" && typeof path === "string") {
      findings.push({ code, message, path });
    }
  }
  return findings;
}

/**
 * Decode one stored record into a refusal row, or `undefined` when it is not one — a pass/warn/hold record, or
 * a refusal missing a field the writer always writes. The store port turns `undefined` on a row its own query
 * selected as refused into `DOOR_ROW_UNREADABLE`, so nothing is skipped silently. Pure.
 *
 * @param record one stored `door_event.record`
 * @returns the refusal row, or `undefined` when the record is not one
 */
export function preDoorRefusalOf({ record }: { record: unknown }): PreDoorRefusalEntry | undefined {
  if (!isRecord(record) || record["status"] !== "refused") {
    return undefined;
  }
  const { gate, surface, hatch, runId, tsIso } = record;
  if (
    typeof gate !== "string" ||
    typeof surface !== "string" ||
    typeof hatch !== "string" ||
    typeof runId !== "string" ||
    typeof tsIso !== "string"
  ) {
    return undefined;
  }
  return { findings: findingsOf({ value: record["findings"] }), gate, hatch, runId, surface, tsIso };
}

/**
 * The coverage bound, printed on every run of the report including an empty one.
 *
 * Its own function so the report cannot render without it. An empty refusal list reads as "nothing stopped
 * that card" unless the reader is told which gates can write a row, and today exactly one can — so the
 * silence of every other pre-door gate has to be said out loud rather than inferred.
 *
 * @returns the lines to print under the report
 */
export function preDoorRefusalCoverageLines(): readonly string[] {
  return [
    "coverage: only the above-the-fold voice gate writes a refusal row.",
    "still unrecorded, and the list is not closed: the bare-reference gate, the cited-controls gate,",
    "the no-fold payload checks, mention resolution and the unresolved-owner refusal. An empty result",
    "above does NOT mean nothing stopped a send.",
  ];
}

/**
 * Render one refusal row for a human, one line per finding under a header naming when and where.
 *
 * @param entry the decoded row
 * @returns the lines to print
 */
export function preDoorRefusalLines({ entry }: { entry: PreDoorRefusalEntry }): readonly string[] {
  return [
    `${entry.tsIso}  ${entry.gate} refused a ${entry.surface} body (hatch ${entry.hatch}, run ${entry.runId})`,
    ...entry.findings.map((finding) => `    ${finding.code} at ${finding.path}: ${finding.message}`),
  ];
}
