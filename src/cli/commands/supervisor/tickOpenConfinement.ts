/**
 * How `supervisor tick open` holds itself to a confined home: which readings it runs and under what environment, the
 * one act it never takes outside a reading, and the lines its output opens on. The decisions are
 * `../../../supervisor/scratch/tickConfinement.ts`; this is the open's wiring of them.
 */
import { quietLauncherEnv } from "#lib/launcherEnv.js";

import {
  CONFINED_SEATING_LINE,
  type ConfinedReadingPlan,
  confinedChildEnv,
  confinementLines,
  readingsForConfinement,
  type TickConfinement,
  tickConfinement,
} from "../../../supervisor/scratch/tickConfinement.js";
import type { TickSeat } from "../../../supervisor/tickSeat.js";
import { tickOpenReadings } from "./tickBumpDrive.js";
import type { StoppedSeatOutcome } from "./tickOpenStoppedRecipes.js";

/** What a tick open runs, decided once from its `--home`. */
export interface ConfinedOpen {
  readonly confinement: TickConfinement;
  /** The readings to capture, the withheld ones already left out. */
  readonly plan: ConfinedReadingPlan;
  /** The bump-drive selection's own lines, printed after the digest. */
  readonly drivenLines: readonly string[];
  /** The children's environment, absent for an ambient open, whose children inherit this process's. */
  readonly env: NodeJS.ProcessEnv | undefined;
}

/**
 * Decide a tick open's readings and their environment: a `--home` other than the ambient one confines the whole open
 * to it, so every child runs under it, a reading that would act on the world is withheld, and a monitor runs
 * without `--fire`.
 *
 * @param deps the ambient state home this process resolves from its environment, and the clock
 * @param home the `--home` the open was given, when it was given one
 * @returns the confinement, the readings to run under it, and their environment
 */
export function confinedOpen({
  deps,
  home,
  seat,
}: {
  deps: { defaultHome: () => string; scratch: { now: () => string } };
  home: string | undefined;
  seat: Pick<TickSeat, "landingRepos" | "loopSessionKey">;
}): ConfinedOpen {
  const confinement = tickConfinement({ ambientHome: deps.defaultHome(), home });
  const driven = tickOpenReadings({ home: confinement.home, nowIso: deps.scratch.now(), seat });
  return {
    confinement,
    drivenLines: driven.lines,
    env: confinedChildEnv({ base: quietLauncherEnv(), confinement }),
    plan: readingsForConfinement({ confinement, readings: driven.readings }),
  };
}

/**
 * Seat the stopped recipes, unless the open is confined: seating registers a board row and runs a real `cmux spawn`,
 * so a confined open never seats, and says so.
 *
 * @param seat the seating an ambient open performs
 * @returns what seating did, or the one line saying a confined open withheld it
 */
export async function seatUnlessConfined({
  confinement,
  seat,
}: {
  confinement: TickConfinement;
  seat: () => Promise<StoppedSeatOutcome>;
}): Promise<StoppedSeatOutcome> {
  if (confinement.kind === "confined") {
    return { actions: [], lines: [CONFINED_SEATING_LINE] };
  }
  return seat();
}

/**
 * The lines an open prints, indented: the confinement lines lead and are never folded into the delta, so a confined
 * open says it is one on every tick, not only its first.
 *
 * @param rest the digest's, the bump drive's and the seating's lines, in that order
 * @returns every line the open prints
 */
export function openOutputLines({ open, rest }: { open: ConfinedOpen; rest: readonly string[] }): readonly string[] {
  return [...confinementLines({ confinement: open.confinement, plan: open.plan }), ...rest].map((line) => `  ${line}`);
}
