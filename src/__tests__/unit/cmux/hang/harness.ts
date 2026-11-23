/*
 * What the cmux hang judge's split test files share: a revive-journal reading, a restart start and an instant, each
 * at `HH:MM` on one fixed test day, that of the pid 5088 hang. It moved here when the judge's one test file was split by
 * behaviour.
 */
import type { CmuxProbeState, CmuxReading, CmuxReviveEvent } from "../../../../cmux/reviveJournal.js";

const START = "Sat Oct 10 08:00:00 2026";

/**
 * A reading at `HH:MM` on the fixed test day.
 *
 * @returns a schema-1 reading of that state, from pid 5088 launched at 08:00 unless the app is named
 */
export function reading({
  at,
  state,
  appPid = 5088,
  appStart = START,
}: {
  at: string;
  state: CmuxProbeState;
  appPid?: number | null;
  appStart?: string | null;
}): CmuxReading {
  return { appPid, appStart, atIso: `2026-10-10T${at}:00.000Z`, detail: "", kind: "reading", schemaVersion: 1, state };
}

/**
 * A restart start at `HH:MM` on the fixed test day.
 *
 * @returns a schema-1 `restart-started` event for pid 5088, hung since 18:52
 */
export function started({ at }: { at: string }): CmuxReviveEvent {
  return {
    appPid: 5088,
    atIso: `2026-10-10T${at}:00.000Z`,
    hungSinceIso: "2026-10-10T18:52:00.000Z",
    kind: "restart-started",
    schemaVersion: 1,
  };
}

/**
 * `HH:MM` on the fixed test day as an instant.
 *
 * @returns the ISO-8601 UTC instant at that clock time
 */
export function instant({ clock }: { clock: string }): string {
  return `2026-10-10T${clock}:00.000Z`;
}
