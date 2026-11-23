/**
 * The ONE renderer for a door refusal. Every verb that reports "the door did not admit this" calls this and
 * nothing else, which is what makes ruling 1 — *print the override token, always* — structural rather than
 * a habit.
 *
 * ## What it replaced, measured
 *
 * Before this renderer, 29 sites in `src/` rendered `decision.findings` to a caller and **0** of them printed the
 * finding's `override`. The token was on the object the whole time; every site rendered `summary`, some
 * added `correction`, and all of them dropped the one field that says how to proceed. The only place in the
 * tree that ever printed it was `slopweaver dev door`, the demonstration verb. Reproduce on any commit:
 *
 * ```bash
 * grep -rn 'decision\.findings' src --include='*.ts' | grep -v __tests__ | wc -l          # sites
 * grep -rn 'decision\.findings' src --include='*.ts' | grep -v __tests__ | grep -c override  # printers
 * ```
 *
 * `src/devLint/escapeHatch.ts` now refuses a site that reads `.summary` off a door finding outside this
 * module, so the two numbers cannot diverge again.
 *
 * ## A `hold` names its absence rather than going quiet
 *
 * A `hold` is the irreversible-harm arm and is deliberately NOT waivable by a per-action token — the door's
 * own type says so. Silence about that reads identically to a forgotten hatch, so a hold prints the reason
 * it has none and the correction that is the way through instead. A refusal must always
 * say what to do next; "there is no hatch, here is the route" satisfies it and a blank line does not.
 */
import { ESCAPE_HATCHES } from "../hatch/registry.js";
import { exceptionClause, JUDGEMENT_NOTE } from "../hatch/render.js";
import { type EscapeHatch, hatchIncantation } from "../hatch/types.js";
import type { ThroughDoorResult } from "./effects.js";
import type { DoorDecision, DoorFinding } from "./types.js";

/** The register row for a door token, or `undefined` when the token is not declared (which the gate refuses). */
function hatchForToken({ token }: { token: string }): EscapeHatch | undefined {
  return ESCAPE_HATCHES.find((hatch) => hatch.key.kind === "door-token" && hatch.key.token === token);
}

/**
 * One finding, in the owner's required block shape.
 *
 * @param finding the door finding being reported
 * @param command what the caller was trying to do, as the owner would type it
 * @returns the finding's lines, in order, always ending in the judgement note
 */
export function doorFindingLines({ finding, command }: { finding: DoorFinding; command: string }): readonly string[] {
  const head = `${command} blocked because ${finding.summary} [${finding.code}].`;
  if (finding.severity === "hold") {
    return [
      head,
      `There is no escape hatch for this one: a hold is the irreversible-harm arm of the door and no per-action token waives it.`,
      `The way through is to satisfy it: ${finding.correction}`,
      JUDGEMENT_NOTE,
    ];
  }
  const hatch = hatchForToken({ token: finding.override });
  const exceptions =
    hatch === undefined
      ? "a case the register has not yet described — add a row to src/hatch/registry.ts"
      : exceptionClause({ exceptions: hatch.exceptions });
  const incantation =
    hatch === undefined ? `SLOPWEAVER_DOOR_OVERRIDE=${finding.override}` : hatchIncantation({ hatch });
  return [
    head,
    `To satisfy it instead: ${finding.correction}`,
    `Legitimate exceptions may include ${exceptions}.`,
    `To override use the designated escape hatch ${incantation} ${command}.`,
    JUDGEMENT_NOTE,
  ];
}

/**
 * The whole refusal: the door's verdict, then every finding in the required shape.
 *
 * @param decision the door's decision, whose `findings` are the surviving ones
 * @param command what the caller was trying to do, as the owner would type it
 * @returns the lines to print, in order
 */
export function doorRefusalLines({
  decision,
  command,
}: {
  decision: DoorDecision;
  command: string;
}): readonly string[] {
  return [
    `the door did not admit this (${decision.status}). Nothing was changed.`,
    ...decision.findings.flatMap((finding) => doorFindingLines({ command, finding })),
  ];
}

/**
 * Why a `throughDoor` call performed nothing, whichever of the two reasons it was: the door's POLICY refusal, in
 * {@link doorRefusalLines}' shape, or the audit trail's STORE refusal, which is no finding at all — the decision
 * could not be recorded, so nothing was performed even if the door passed. One renderer for both, so no caller
 * prints an empty findings list under "the door did not admit this" when the door in fact admitted it.
 *
 * @param through the outcome that did not perform
 * @param command what the caller was trying to do, as the owner would type it
 * @returns the lines to print
 */
export function notPerformedLines({ through, command }: { through: NotPerformed; command: string }): readonly string[] {
  if (through.kind === "recording-refused") {
    return [`${command} not performed: ${through.error.message}`];
  }
  return doorRefusalLines({ command, decision: through.decision });
}

/** A `throughDoor` outcome that performed nothing — the two arms {@link notPerformedLines} renders. */
export type NotPerformed = Exclude<ThroughDoorResult<unknown>, { readonly performed: true }>;
