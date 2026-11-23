/**
 * `hand mute list` — every mute, every hold until worse, every record that would not read and every press a store
 * would not take, each named with the remove that reverses it. The verb's other actions live in `./mute.ts`.
 */
import { kindAnswerLabel, readKindAnswerMarkers } from "../../../hand/kindAnswers.js";
import { type EscalationHold, readEscalationHolds } from "../../../monitor/escalationHolds.js";
import { type NoteMute, readNoteMutes } from "../../../monitor/noteMutes.js";
import { stateHomePaths } from "../../../stateHome.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";

import type { HandDeps } from "./deps.js";

/**
 * Name every mute and every escalation hold, every record that would not read, and every press a store would not take
 * — each still keeps a note down, so each is named with the remove that reverses it.
 *
 * @param json print one JSON line instead of the sentences
 * @param pressProblems how many presses this run could not honour — each already diagnosed, each a failure here
 * @returns 0, or 1 while a record will not read, a press waits unrecorded, or a press could not be honoured
 */
export function listMutes({
  deps,
  home,
  json,
  pressProblems,
}: {
  deps: HandDeps;
  home: string;
  json: boolean;
  pressProblems: number;
}): number {
  const mutes = readNoteMutes({ home });
  const holds = readEscalationHolds({ home });
  const pending = readKindAnswerMarkers({ markerDir: stateHomePaths({ home }).handNoteDismiss });
  if (pending.isErr()) {
    deps.writeDiagnostic(`hand mute: ${pending.error.message}`);
    return EXIT_ERROR;
  }
  const presses = pending.value;
  const problems = [...mutes.problems, ...holds.problems];
  problems.forEach((problem) => {
    deps.writeDiagnostic(`hand mute: ${problem.message}`);
  });
  const failed = problems.length > 0 || presses.length > 0 || pressProblems > 0;
  const code = failed ? EXIT_ERROR : EXIT_OK;
  if (json) {
    deps.writeOut(
      JSON.stringify({
        holds: holds.records,
        mutes: mutes.records,
        pendingPresses: presses.map((marker) => ({ answer: marker.answer, stepId: marker.id })),
        unreadable: { holds: holds.unreadable, mutes: mutes.unreadable },
      }),
    );
    return code;
  }
  const lines = [
    ...mutes.records.map((mute) => muteLine({ mute })),
    ...mutes.unreadable.map((key) => `muted (record unreadable): ${key} — \`slopweaver hand mute remove ${key}\``),
    ...holds.records.map((hold) => holdLine({ hold })),
    ...holds.unreadable.map(
      (key) => `held until worse (record unreadable): ${key} — \`slopweaver hand mute remove ${key}\``,
    ),
    ...presses.map(
      (marker) =>
        `pressed, not recorded: ${kindAnswerLabel({ answer: marker.answer })} on ${marker.id} keeps its note down — the next pass records it once the store writes, \`slopweaver hand mute remove ${marker.id}\` discards it`,
    ),
  ];
  // A store that would not list, or a press that would not read, may hide a mute, so "none" needs every read whole.
  if (lines.length === 0 && !failed) {
    deps.writeOut("hand mute: no kind is muted and no note is held until it gets worse");
    return code;
  }
  lines.forEach((line) => {
    deps.writeOut(`hand mute: ${line}`);
  });
  return code;
}

/**
 * One mute's line.
 *
 * @param mute the mute
 * @returns the line
 */
function muteLine({ mute }: { mute: NoteMute }): string {
  const from = mute.from.kind === "note" ? `pressed on ${mute.from.stepId}` : "set with hand mute add";
  return `muted: ${mute.monitorId} since ${mute.mutedIso} (${from}) — \`slopweaver hand mute remove ${mute.monitorId}\``;
}

/**
 * One escalation hold's line.
 *
 * @param hold the hold
 * @returns the line
 */
function holdLine({ hold }: { hold: EscalationHold }): string {
  const against =
    hold.state.kind === "pending" ? "waiting for its first reading" : `against ${String(hold.state.baseline)}`;
  return `held until worse: ${hold.base} (${hold.monitorId}, ${against}) — \`slopweaver hand show ${hold.stepId}\` draws it now, \`slopweaver hand mute remove ${hold.base}\` releases it`;
}
