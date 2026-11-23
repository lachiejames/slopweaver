/**
 * The shell half of `tick close`'s steer-risk gate: one rehearsal pass of `steer-at-risk` over the live hand register,
 * the gate's hatch, and the refusal it prints.
 *
 * The owner's rule: a deliverable the owner explicitly steered that is at risk reaches the owner the minute it is
 * known. The tick opens by FIRING `steer-at-risk` (`../../../supervisor/scratch/fleetReadings.ts`); this makes a tick
 * that read a risk and left its note down a refusal rather than a quiet gap — otherwise a seat parks on a clock with
 * the owner's deadline fifty-nine minutes off and nothing tells the owner (`docs/doctrine-rationale/explicit-steer.md`). The judge is the fleet health one, by monitor id
 * (`../../../supervisor/fleetHealthGate.ts`). Two rows at risk are two notes, both up in the cascade, and each is
 * owed on its own.
 */
import { hatchFor } from "../../../hatch/lookup.js";
import { hatchOpen } from "../../../hatch/open.js";
import { hatchRefusalLines } from "../../../hatch/render.js";
import type { MonitorId } from "../../../monitor/types.js";
import {
  type EscalationRead,
  type EscalationVerdict,
  judgeMonitorEscalation,
} from "../../../supervisor/fleetHealthGate.js";
import { readEscalationLive } from "./fleetHealthRead.js";

/** The monitor this gate reads. */
const STEER_RISK_MONITOR: MonitorId = "steer-at-risk";

/** The command that posts the note, which every refusal names. */
const STEER_RISK_FIRE_COMMAND = `slopweaver monitor check --only ${STEER_RISK_MONITOR} --fire`;

/**
 * Whether the `unescalated-steer-risk` hatch is open for this invocation.
 *
 * @returns true when the ambient variable is set
 */
export function steerRiskHatchOpen(): boolean {
  return hatchOpen({ env: process.env, id: "unescalated-steer-risk", nowIso: new Date().toISOString() });
}

/**
 * Run one rehearsal pass of `steer-at-risk` over the live register.
 *
 * @param home the state home the journals and the register live under
 * @param nowIso the tick's own instant, which every steered row is judged at
 * @param noteClock the wall clock each open card's note is judged at, read once its files have been
 * @returns the pass, or why it could not run
 */
export async function readSteerRiskLive({
  home,
  nowIso,
  noteClock,
}: {
  home: string;
  nowIso: string;
  noteClock: () => string;
}): Promise<EscalationRead> {
  return readEscalationLive({ home, monitorId: STEER_RISK_MONITOR, noteClock, nowIso });
}

/**
 * The close-only steer-risk gate: a tick that read an explicitly steered deliverable at risk and left its note down
 * is refused, exactly as fleet health is; the hatch is read only when the gate would refuse.
 *
 * @param read the rehearsal pass this tick made
 * @param hatchIsOpen whether `unescalated-steer-risk` is open, asked only when the gate would refuse
 * @returns the refusal block, or nothing when no steered row is at risk or every such note is up
 */
export function steerRiskRefusal({
  read,
  hatchIsOpen,
}: {
  read: EscalationRead;
  hatchIsOpen: () => boolean;
}): readonly (readonly string[])[] {
  const verdict = judgeMonitorEscalation({ monitorId: STEER_RISK_MONITOR, read });
  if (verdict.kind === "clean" || hatchIsOpen()) {
    return [];
  }
  return [steerRiskRefusalLines({ verdict })];
}

/**
 * Render the steer-risk gate's refusal: which steered row is at risk and why, and the one command that posts it.
 *
 * @param verdict the refused or unreadable verdict
 * @returns the hatch's four lines, then one line per unposted note, then the way out
 */
function steerRiskRefusalLines({
  verdict,
}: {
  verdict: Exclude<EscalationVerdict, { kind: "clean" }>;
}): readonly string[] {
  const hatch = hatchFor({ id: "unescalated-steer-risk" });
  if (verdict.kind === "unreadable") {
    return [
      ...hatchRefusalLines({
        detail: `whether a steered deliverable is at risk could not be read — ${verdict.why}`,
        hatch,
      }),
      `Fix what that names and re-run this; \`${STEER_RISK_FIRE_COMMAND}\` prints the same reading. It refuses ` +
        "rather than passing, because a check that reports clean on an input it never saw is worse than no check.",
    ];
  }
  return [
    ...hatchRefusalLines({
      detail: `this tick read a deliverable the owner explicitly steered at risk and its floating note is not up — ${verdict.label}`,
      hatch,
    }),
    ...verdict.unposted.map((line) => `  ${line}`),
    `Run the command a line names — \`${STEER_RISK_FIRE_COMMAND} --by-session <this workspace>\` posts a note ` +
      "not yet posted — and re-run this. A refusal either prints is the defect to fix, never a reason to open the hatch.",
  ];
}
