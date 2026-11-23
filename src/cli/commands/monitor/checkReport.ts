/**
 * How `slopweaver monitor check` prints one pass — every reading, including the clear ones, then each action. Its own
 * module because printing decides nothing: `./check.ts` runs the pass and hands the outcome here.
 */
import {
  CORPUS_CARD_SUMMARY_ID,
  isClosedByOwnerSteerId,
  REPAIR_TAKEN_SUMMARY_ID,
  SUPERVISOR_HELD_SUMMARY_ID,
} from "../../../monitor/evaluateStopped.js";
import type { PassOutcome } from "../../../monitor/pass.js";
import type { SteeredSummary } from "../../../monitor/types.js";

/**
 * One steer's line under a reading: how many stopped rows it answers, and what happens instead of a card.
 *
 * @param steer one summary off the reading
 * @returns the line, unindented
 */
function steeredLine({ steer }: { steer: SteeredSummary }): string {
  if (steer.steerId === REPAIR_TAKEN_SUMMARY_ID) {
    return `${String(steer.count)} stopped, each taken by a seat — ${steer.instead}`;
  }
  if (steer.steerId === CORPUS_CARD_SUMMARY_ID) {
    return `${String(steer.count)} stopped, each a corpus resync — ${steer.instead}`;
  }
  if (steer.steerId === SUPERVISOR_HELD_SUMMARY_ID) {
    return `${String(steer.count)} stopped, each held by the supervisor — ${steer.instead}`;
  }
  if (isClosedByOwnerSteerId({ steerId: steer.steerId })) {
    return `${String(steer.count)} stopped, closed by the owner — ${steer.instead}`;
  }
  return `${String(steer.count)} stopped, restarting on the owner's ${steer.steerId} steer — ${steer.instead}`;
}

/**
 * Print one pass.
 *
 * Every reading is printed, including the clear ones, because a monitor that answered `clear` and a monitor
 * that was never consulted look identical in a report that only lists what fired — and that is exactly the
 * conflation `../../../monitor/types.ts` declares four states to prevent.
 *
 * @param outcome what the pass saw and did
 * @param json whether to print the one machine document instead of the human lines
 * @param writeOut where each line goes
 */
export function reportPass({
  outcome,
  json,
  writeOut,
}: {
  outcome: PassOutcome;
  json: boolean;
  writeOut: (line: string) => void;
}): void {
  if (json) {
    writeOut(JSON.stringify({ actions: outcome.actions, readings: outcome.readings }));
    return;
  }
  outcome.readings.forEach((reading) => {
    if (reading.state === "firing") {
      writeOut(`${reading.monitorId}  FIRING over ${String(reading.subjects.length)}`);
      reading.subjects.forEach((subject) => {
        writeOut(`    ${subject.id} — ${subject.label}`);
        // Every line, uncut — the note keeps only their head behind its disclosure row, and its `+N more` line points here.
        let lines = subject.details;
        if (subject.detailsInFull !== undefined) {
          lines = subject.detailsInFull;
        }
        lines?.forEach((line) => {
          writeOut(`      ${line}`);
        });
      });
      if (reading.steers !== undefined) {
        reading.steers.forEach((steer) => {
          writeOut(`    ${steeredLine({ steer })}`);
        });
      }
      return;
    }
    if (reading.state === "unmeasurable") {
      writeOut(`${reading.monitorId}  UNMEASURABLE — ${reading.because}`);
      return;
    }
    if (reading.state === "steered") {
      writeOut(`${reading.monitorId}  STEERED — nothing to ask the owner`);
      reading.steers.forEach((steer) => {
        writeOut(`    ${steeredLine({ steer })}`);
      });
      return;
    }
    writeOut(`${reading.monitorId}  clear`);
    reading.evidence?.forEach((line) => {
      writeOut(`      ${line}`);
    });
  });
  if (outcome.actions.length === 0) {
    writeOut("monitor check: nothing arrived and nothing cleared");
    return;
  }
  outcome.actions.forEach((action) => {
    writeOut(`  ${action.kind} ${action.stepId}: ${action.detail}`);
  });
}
