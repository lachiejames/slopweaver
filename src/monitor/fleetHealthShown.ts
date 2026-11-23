/**
 * The fleet-health note's memory: what the last posted `fleet-unhealthy` card showed, so the next pass can say what
 * CHANGED and hold a note with nothing new (`./fleetHealthDelta.ts`).
 *
 * One small JSON file beside the hand register (`stateHomePaths().fleetHealthShownJson`). The register itself cannot
 * carry it: a card's rows are prose on the card, and parsing its own sentences back into a set is the drift this
 * repository refuses elsewhere. So the pass hands the shell the set on the subject (`MonitorSubject.fleet.shown`), and
 * the shell writes it here only after the card was really POSTED.
 *
 * ## Written only under `--fire`, and forgotten when the fleet reads clear
 *
 * `tick close`'s gate rehearses the same pass and must never move the memory, or a rehearsal would swallow the
 * news the next firing pass owes the owner. A `clear` reading removes the file, so a fleet that recovered and broke again
 * is news even when the same rows break.
 *
 * Nothing here decides; the read is total (a malformed file is reported and read as no memory, so news is never
 * swallowed) and the writes report rather than throw.
 */
import { rmSync } from "node:fs";

import { readFileIfPresent } from "../atlas/atlasFile.js";
import { errorMessage } from "../lib/errorMessage.js";
import { isRecord } from "../lib/parsers.js";
import { safeJsonParse, safeJsonStringify } from "../lib/safeJson.js";
import { writeFileAtomic } from "../lib/writeAtomic.js";
import { stateHomePaths } from "../stateHome.js";

import type { PassOutcome } from "./pass.js";
import type { PassAction } from "./passSettle.js";
import type { FleetHealthShown } from "./types.js";

/** The monitor whose memory this is. */
const FLEET_MONITOR = "fleet-unhealthy";

/**
 * A remembered note, checked — or `undefined` when the value is not one.
 *
 * @param value the parsed file
 * @returns the memory, or `undefined`
 */
export function shownOf({ value }: { value: unknown }): FleetHealthShown | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const { botDown, broken, shownIso, signals } = value;
  if (typeof shownIso !== "string" || Number.isNaN(Date.parse(shownIso)) || typeof botDown !== "boolean") {
    return undefined;
  }
  if (!isStringList(broken) || !isStringList(signals)) {
    return undefined;
  }
  const yours = shownYours({ value: value["yours"] });
  if (yours === undefined) {
    return undefined;
  }
  return { botDown, broken: broken.toSorted(), shownIso, signals, yours };
}

/**
 * The rows a remembered note said need the owner. A memory written before the note carried buttons has no such field, and
 * that note showed none — so absent is the empty list by what was on the owner's screen, while a field present and malformed
 * is no memory at all.
 */
function shownYours({ value }: { value: unknown }): readonly string[] | undefined {
  if (value === undefined) {
    return [];
  }
  if (!isStringList(value)) {
    return undefined;
  }
  return value.toSorted();
}

/** Whether a value is an array of strings. */
function isStringList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

/**
 * Read the last note's memory.
 *
 * @param home the Slopweaver home
 * @returns the memory (`undefined` when none is remembered) and, when the file would not read, why — which the
 *   reading carries as a blind spot while treating the fleet's rows as news
 */
export function readFleetHealthShown({ home }: { home: string }): {
  readonly shown: FleetHealthShown | undefined;
  readonly problem: string | undefined;
} {
  const path = stateHomePaths({ home }).fleetHealthShownJson;
  const raw = readFileIfPresent({ path });
  if (raw.isErr()) {
    return { problem: `the last note's memory ${path} would not read: ${raw.error.join("; ")}`, shown: undefined };
  }
  if (raw.value === null) {
    return { problem: undefined, shown: undefined };
  }
  let decoded: unknown;
  try {
    decoded = safeJsonParse({ label: path, text: raw.value });
  } catch (cause) {
    return {
      problem: `the last note's memory ${path} is not JSON: ${errorMessage({ error: cause })}`,
      shown: undefined,
    };
  }
  const shown = shownOf({ value: decoded });
  if (shown === undefined) {
    return { problem: `the last note's memory ${path} is not a remembered note`, shown: undefined };
  }
  return { problem: undefined, shown };
}

/**
 * After a FIRED pass, remember what a posted fleet-health card showed, or forget it when the fleet read clear.
 *
 * @param home the Slopweaver home
 * @param outcome the pass, already fired
 * @returns one row saying what was remembered or forgotten, a `refused` row when the write failed, or none
 */
export function recordFleetHealthShown({
  home,
  outcome,
}: {
  home: string;
  outcome: PassOutcome;
}): readonly PassAction[] {
  const reading = outcome.readings.find((one) => one.monitorId === FLEET_MONITOR);
  if (reading === undefined || reading.state === "unmeasurable" || reading.state === "steered") {
    return [];
  }
  const path = stateHomePaths({ home }).fleetHealthShownJson;
  if (reading.state === "clear") {
    return forget({ path });
  }
  const posted = outcome.actions.find((action) => action.monitorId === FLEET_MONITOR && action.kind === "posted");
  const shown = reading.subjects[0]?.fleet?.shown;
  if (posted === undefined || shown === undefined) {
    return [];
  }
  try {
    writeFileAtomic({ contents: `${safeJsonStringify({ label: path, value: shown })}\n`, path });
  } catch (cause) {
    return [
      {
        detail: `the note went up but its memory did not write, so the next pass may show it again: ${errorMessage({ error: cause })}`,
        kind: "refused",
        monitorId: FLEET_MONITOR,
        stepId: posted.stepId,
      },
    ];
  }
  return [
    {
      detail: `remembered ${String(shown.broken.length)} failing row(s) as shown, so the next note says what changed`,
      kind: "noted",
      monitorId: FLEET_MONITOR,
      stepId: posted.stepId,
    },
  ];
}

/** Forget the last note: the fleet read clear, so its next breakage is news. */
function forget({ path }: { path: string }): readonly PassAction[] {
  try {
    rmSync(path, { force: true });
  } catch (cause) {
    return [
      {
        detail: `the fleet read clear but the last note's memory did not clear: ${errorMessage({ error: cause })}`,
        kind: "refused",
        monitorId: FLEET_MONITOR,
        stepId: FLEET_MONITOR,
      },
    ];
  }
  return [];
}
