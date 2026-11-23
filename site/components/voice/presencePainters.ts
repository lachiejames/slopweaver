/**
 * Every presence's painter, by its id: what fills the orb, whichever theme colours it.
 *
 * The orb's canvas (`StageParticles.tsx`) asks this for a fresh painter whenever the nearest `data-presence` names a
 * different presence, so one presence's state never leaks into the next. The ids and names are `site/lib/orbPresence.ts`.
 */
import type { PresenceId } from "../../lib/orbPresence";
import type { PresencePainter, PresencePainterFactory } from "./presencePainter";
import { makeEmbersPainter, makeInkPainter, makeMistPainter } from "./presenceSoftPainters";
import { makeAuroraPainter, makeDotMatrixPainter } from "./presenceStructurePainters";
import { makeSwarmPainter } from "./swarmPainter";

/** Each presence's painter maker. */
export const PRESENCE_PAINTERS: Readonly<Record<PresenceId, PresencePainterFactory>> = {
  aurora: makeAuroraPainter,
  "dot-matrix": makeDotMatrixPainter,
  embers: makeEmbersPainter,
  ink: makeInkPainter,
  mist: makeMistPainter,
  "star-cluster": makeSwarmPainter,
};

/**
 * A fresh painter for one presence, carrying nothing from any drawn before it.
 *
 * @returns the painter
 */
export function makePresencePainter({ presence }: { presence: PresenceId }): PresencePainter {
  return PRESENCE_PAINTERS[presence]();
}
