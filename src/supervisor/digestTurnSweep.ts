/**
 * The tick's `turn dispatch --sweep` reading as digest lines — the reconciliation of every open bot-turn dispatch,
 * run by the visible supervisor tick so a turn dispatched from a host with no same-session wake (Codex) is still
 * reconciled. The sweep relaunches nothing and resends no worker pickup (`../cli/commands/turn/dispatchSweep.ts`);
 * the chair acts on what this prints (`skills/supervisor/reference/sweep-contract.md`).
 *
 * The sweep's own text is the authority: nothing here re-parses its counts or reorders its findings. The digest
 * lifts the summary the sweep ends on to the top, so every count — `phantom`, `lease-expired`, NEVER-DISPATCHED —
 * stands above the cap even when the findings beneath it overflow into the capture file.
 *
 * Pure.
 */
import { capped, type DigestInputs, shortened } from "./digestRead.js";
import { describeChildOutcome } from "./scratch/childOutcome.js";

/** The reading's name, which is also its capture file's stem. */
export const TURN_DISPATCH_SWEEP_READING = "turn-dispatch-sweep";

/** What every line this projection prints starts with. */
const PREFIX = "turn sweep";

/** The file a capped list's overflow line points at. */
const CAPTURE_FILE = `${TURN_DISPATCH_SWEEP_READING}.txt`;

/** The counters every summary carries, in order (`../live/turn/sweepSummary.ts`'s `healthy`). */
const HEALTHY = String.raw`\d+ ready, \d+ still working, \d+ in-review, \d+ worker-failed, \d+ phantom, \d+ lease-expired`;

/** The tail every summary ends on. */
const TAIL = String.raw`\d+ checklist-update-failed, \d+ ignored`;

/**
 * The summary line the sweep always ends on, by its WHOLE shape — both of `sweepSummaryLine`'s, every counter
 * spelled out. A bare `sweep:` prefix let any diagnostic pass for one, and a loose middle
 * let a line missing its counters pass.
 */
const SUMMARY = new RegExp(
  String.raw`^sweep: (?:${HEALTHY}, \d+ never-dispatched, ${TAIL}|\d+ UNROUTED, \d+ NEVER-DISPATCHED — \d+ ask\(s\) above need routing NOW; ${HEALTHY}, ${TAIL})$`,
  "u",
);

/**
 * The tick's dispatch sweep as digest lines, or why it could not be read — never a silent zero.
 *
 * @param inputs the tick's readings
 * @returns the lines, each prefixed `turn sweep:`; an UNKNOWN line, never none, when the reading is absent or unread
 */
export function turnDispatchSweepLines({ inputs }: { inputs: DigestInputs }): readonly string[] {
  const reading = inputs.readings.get(TURN_DISPATCH_SWEEP_READING);
  if (reading === undefined) {
    // Declared on every tick (`scratch/fleetReadings.ts`), so a capture without it lost it.
    return [`${PREFIX}: NOT READ — not captured this tick; open dispatches are UNKNOWN this pass, not zero`];
  }
  if (reading.kind === "unavailable") {
    return [
      `${PREFIX}: NOT READ — ${describeChildOutcome({ outcome: reading.child })}; open dispatches are UNKNOWN this pass, not zero`,
    ];
  }
  if (reading.kind === "json") {
    return [`${PREFIX}: captured as JSON, not text — open dispatches are UNKNOWN this pass, not zero`];
  }
  // Only the blank lines framing the capture go: one INSIDE it belongs to a multiline finding (an ask's own
  // paragraph break), and dropping it would hide a printed line with no overflow pointer.
  const lines = reading.text.split("\n");
  const first = lines.findIndex((line) => line.trim() !== "");
  const last = lines.findLastIndex((line) => line.trim() !== "");
  const printed = lines.slice(first, last + 1);
  if (first === -1) {
    return [`${PREFIX}: EMPTY — the sweep printed no summary, so open dispatches are UNKNOWN this pass, not zero`];
  }
  const summary = printed.at(-1)!;
  if (!SUMMARY.test(summary)) {
    // The sweep ENDS on its summary every run (`../live/turn/sweepSummary.ts`), so text ending elsewhere is not a
    // whole sweep's output — a file read that failed after capture, say.
    return [
      `${PREFIX}: NO SUMMARY — the capture does not end on a sweep line (it opens: ${shortened({ text: printed[0]! })}), so open dispatches are UNKNOWN this pass, not zero`,
    ];
  }
  // The findings keep the sweep's own order, line for line. A finding can span lines whose text is an ask's own,
  // so no line can be classed on its own: an ask reading `still working: x` would be lifted out of its finding
  // The summary leads, so its counts stand above the cap whatever the cap hides.
  const ordered = [summary, ...printed.slice(0, -1)].map((line) => `${PREFIX}: ${line}`);
  const shown = capped({ lines: ordered, prefix: PREFIX });
  // A cut list can keep its length (nine in, eight named plus a count out), so lengths cannot say whether it was
  // cut — and neither can text, since a captured ask line may itself read `and 1 more`
  // `capped` hands back the very array it was given when nothing was cut, so identity can.
  if (shown === ordered) {
    return shown;
  }
  const named = shown.slice(0, -1);
  return [...named, `${PREFIX}: and ${String(ordered.length - named.length)} more in ${CAPTURE_FILE}`];
}
