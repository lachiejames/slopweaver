/**
 * The gate that refuses to send a visual this machine drew, unless the caller says in one line why the real
 * surface could not be had.
 *
 * ## Why this is separate from `./realArtifactGate.ts`
 *
 * That gate is keyed on the question's SUBJECT — a monitor, an alert, a backtest — and asks whether the
 * answer carries a link or a stated reason. It is silent about what the attached pictures actually ARE, and
 * it once passed an answer whose two images were charts the session had drawn, because a chart is an
 * image. This one reads the visuals themselves, at every seam one can enter an artifact, and needs no
 * question at all: the attachment door and a PR description have none.
 *
 * The two compose rather than overlap. `realArtifactGate` catches "you never went and got the real thing";
 * this catches "what you attached instead is a drawing".
 *
 * ## `warn`, like every other gate on this path
 *
 * Block by default with a break-glass, and the door RECORDS the override — `../admit/ledger.ts` writes the
 * waived codes, so an acknowledged send is findable afterwards rather than indistinguishable from a clean
 * one. That is the shape the owner asked for in the same breath as the ban: _"but with escape hatch of
 * course"_.
 */

import { type CandidateVisual, inventedVisualsIn } from "./inventedVisual.js";
import type { DoorFinding, DoorGate } from "./types.js";

/**
 * The override token that waives this gate, recorded by the door whenever it is used.
 *
 * @internal — named here so the value has one home; the docs, the verbs and the tests quote it rather than
 * re-spelling it.
 */
export const INVENTED_VISUAL_OVERRIDE = "visual.invented:v1";

/**
 * Every invented visual among the candidates, as door findings.
 *
 * @param visuals the candidates the seam collected
 * @returns one finding per offending visual per reason; empty when every candidate is a real capture
 *
 * @internal — exported so a test can assert the findings without composing a whole door request.
 */
export function inventedVisualFindings({ visuals }: { visuals: readonly CandidateVisual[] }): readonly DoorFinding[] {
  return inventedVisualsIn({ visuals }).map((invented): DoorFinding => {
    return {
      code: `INVENTED_VISUAL_${invented.reason.toUpperCase().replaceAll("-", "_")}`,
      correction: `${invented.real} — or acknowledge this one, carrying the reason the real surface was not available`,
      override: INVENTED_VISUAL_OVERRIDE,
      severity: "warn",
      summary: `${invented.ref} is not a capture of the real thing: ${invented.why}`,
    };
  });
}

/**
 * The invented-visual gate, ready to compose into a door's gate list.
 *
 * @param visuals the candidates the seam collected — a seam supplies whatever bytes it holds, and gets
 *   exactly the checks those inputs settle
 * @returns a `DoorGate` reporting every visual that must not go out unacknowledged
 */
export function inventedVisualGate({ visuals }: { visuals: readonly CandidateVisual[] }): DoorGate {
  return () => inventedVisualFindings({ visuals });
}
