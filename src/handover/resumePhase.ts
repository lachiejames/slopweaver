/**
 * How `handover resume` names a run's phase, so a row nobody has ever started never reads as one that closed.
 *
 * {@link NO_RUN} carries `phase: "closed"` on purpose — a machine defaulting to closed never assumes a run is
 * open — but that default is a GUARD, not a fact about the row. MEASURED: the supervisor's digests offered four
 * relay rows (`talk-<id>`) as seatable, `handover resume` on each printed `phase:   closed` plus "no run is open … if the work has landed:
 * handover close", and the chair registered a defect against the seatable read. The read was right: each doc was
 * `status: ready` with no journal file at all (repro: `slopweaver handover resume talk-<id>`, then
 * `ls ~/.slopweaver/runs/talk-<id>.jsonl`). The board already separates the two through its own
 * `RunDisposition`; this is resume's half.
 */
import type { RunEvent, RunState } from "./ledger.js";

/**
 * Which of the four things a `closed` phase can mean, as resume reads the journal.
 *
 * - `start-unreadable` — a line did not decode and may be a start, so nothing below is claimed.
 * - `shipped` — a `closed` event stands anywhere in the journal, cycle or none: the row recorded that it shipped.
 * - `cycle-ended` — a cycle ended `finished`, `abandoned` or `orphaned`, with no shipment recorded.
 * - `never-started` — no cycle and no shipment.
 */
export type ClosedReading = "shipped" | "cycle-ended" | "never-started" | "start-unreadable";

/**
 * Whether a `closed` event stands anywhere in the journal.
 *
 * Read across the WHOLE journal, never the current cycle, because `handover close` writes a standalone `closed`
 * with no `started` before it, and `derivedRowState` reads it the same way. Its summary is never
 * printed on the phase line: it is free text that may span lines, so it could forge a next step;
 * the journal tail below already names the event.
 *
 * @param events the decoded journal
 * @returns true when the row recorded that it shipped
 */
function recordedShipment({ events }: { events: readonly RunEvent[] }): boolean {
  return events.some((event) => event.kind === "closed");
}

/**
 * What a run's `closed` phase really is, or `undefined` when the phase is not `closed` at all.
 *
 * `runStateOf` returns {@link NO_RUN} (zero entries) exactly when no DECODED `started` exists, and every real cycle
 * counts its own `started`. A line that did not decode might be that `started`, so zero entries beside an
 * unreadable line is `start-unreadable`: whether a run ever opened is unknown, never "it did not".
 *
 * @param run the derived run state
 * @param events the decoded journal `run` was folded from
 * @param unreadable the journal line numbers that did not decode, from that same read
 * @returns the reading, or `undefined` for an open or waiting run
 */
export function closedReading({
  run,
  events,
  unreadable,
}: {
  run: RunState;
  events: readonly RunEvent[];
  unreadable: readonly number[];
}): ClosedReading | undefined {
  if (run.phase !== "closed") {
    return undefined;
  }
  // An undecodable line may be a start the folded state never saw — ahead of the first cycle, or a re-run after a
  // shipment or an ended cycle — so no closed reading is claimed past one.
  if (unreadable.length > 0) {
    return "start-unreadable";
  }
  if (recordedShipment({ events })) {
    return "shipped";
  }
  return run.entries > 0 ? "cycle-ended" : "never-started";
}

/**
 * Whether resume may print the ownership line, whose closed-cycle form says "`handover start` opens a fresh cycle".
 *
 * Only an open run or a cycle that merely ENDED keeps it. A shipped row refuses that start, and an UNKNOWN one
 * cannot say it is safe, so their own next-step lines replace it. A never-started row has no
 * owner to name, so replacing is the only answer there too.
 *
 * @param reading the row's closed reading, `undefined` for an open or waiting run
 * @returns true when the ownership line stands
 */
export function keepsOwnershipLine({ reading }: { reading: ClosedReading | undefined }): boolean {
  return reading === undefined || reading === "cycle-ended";
}

/**
 * The words resume prints after `phase:`.
 *
 * @param run the derived run state
 * @param events the decoded journal
 * @param unreadable the journal line numbers that did not decode
 * @returns the folded phase, or what a `closed` phase really means
 */
export function resumePhaseWords({
  run,
  events,
  unreadable,
}: {
  run: RunState;
  events: readonly RunEvent[];
  unreadable: readonly number[];
}): string {
  const reading = closedReading({ events, run, unreadable });
  if (reading === "shipped") {
    return "closed (the row recorded that it shipped)";
  }
  if (reading === "never-started") {
    return "never started (no run has been opened, so this row is unstarted, not closed)";
  }
  if (reading === "start-unreadable") {
    return `UNKNOWN (${String(unreadable.length)} journal line(s) did not decode, and one may be a start)`;
  }
  return run.phase;
}

/**
 * Resume's next-step lines for a row whose phase is `closed`, split by what the journal actually shows.
 *
 * A never-started row gets the one thing to do — `start` it — and none of the close advice, which told the chair a
 * ready row might already have landed. A shipped row gets neither, since both verbs refuse a row that shipped. A
 * row whose start may be on an unreadable line gets only the journal to read.
 *
 * @param run the derived run state, whose phase is `closed`
 * @param events the decoded journal
 * @param unreadable the journal line numbers that did not decode
 * @param slug the row's id, quoted into each command
 * @param journal the journal's path, named when its lines must be read by hand
 * @returns the lines, the first being the headline
 */
export function closedNextStepLines({
  run,
  events,
  unreadable,
  slug,
  journal,
}: {
  run: RunState;
  events: readonly RunEvent[];
  unreadable: readonly number[];
  slug: string;
  journal: string;
}): readonly string[] {
  const reading = closedReading({ events, run, unreadable });
  if (reading === "shipped") {
    return [
      `handover resume: ${slug} is closed — the row recorded that it shipped, so there is nothing to start or close.`,
      "  follow-up work is a new row",
    ];
  }
  if (reading === "never-started") {
    return [
      `handover resume: ${slug} has never been started — no run was ever opened, so it is unstarted, not closed.`,
      `  to work on it: slopweaver handover start ${slug}`,
    ];
  }
  if (reading === "start-unreadable") {
    return [
      `handover resume: ${slug}'s journal has ${String(unreadable.length)} line(s) that did not decode, and one ` +
        "may be a start, so its phase is UNKNOWN.",
      `  read ${journal} before starting or closing it`,
    ];
  }
  return [
    `handover finish: no run is open for ${slug}, so there is nothing to close.`,
    `  if the work has landed: slopweaver handover close ${slug} --summary "<what shipped>"`,
    `  if you meant to work on it, \`slopweaver handover start ${slug}\` first`,
  ];
}
