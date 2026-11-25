/**
 * Which Codex plans `slopweaver fleet recover` may open a throwaway session on, best first, and why it may not open one
 * on the rest: the same fleet read, ranker and preflight a visible Codex seat takes (`../codex/seatDecision.ts`), kept
 * as the whole list rather than the one best plan, because a check that falls back has to name what it passed over.
 */
import type { ReadCodexAccountsLive } from "../codex/accountLive.js";
import type { CodexFleetCapPort } from "../codex/fleetCapPort.js";
import { readCodexFleetSnapshot } from "../codex/fleetRead.js";
import type { CodexFleetSnapshot, CodexPlanObservation, CodexRouteExclusion } from "../codex/fleetTypes.js";
import { rankCodexPlans } from "../codex/rank.js";
import { codexSeatPreflightRefusal } from "../codex/seatDecision.js";
import type { CodexSignInPort } from "../codex/signInPort.js";
import { codexLoginCommand } from "../plans/login.js";
import type { PlanRegisterPort } from "../plans/port.js";
import type { RecoveryCandidate, RecoveryEvidence, RecoveryExclusion } from "./recoveryCheck.js";

/** One plan the ranker left out, naming its sign-in only when its own store says nothing is signed in. */
function routeExclusion({ exclusion }: { exclusion: CodexRouteExclusion }): RecoveryExclusion {
  const { alias, codexHome } = exclusion.destination;
  const base = { alias, reason: `${exclusion.kind}: ${exclusion.reason}`, vendor: "codex" as const };
  if (exclusion.kind !== "signed-out") {
    return base;
  }
  return { ...base, signInCommand: codexLoginCommand({ codexHome }) };
}

/** A ranked plan as the preflight a seat takes judges it: one to try, or one to leave out and why. */
function judgeRanked({
  home,
  nowIso,
  observation,
}: {
  home: string;
  nowIso: string;
  observation: CodexPlanObservation;
}): { readonly candidate: RecoveryCandidate } | { readonly exclusion: RecoveryExclusion } {
  const { alias, codexHome } = observation.destination;
  const refusal = codexSeatPreflightRefusal({ allowRefusing: false, home, nowIso, observation });
  if (refusal !== undefined) {
    return { exclusion: { alias, reason: refusal, vendor: "codex" } };
  }
  return { candidate: { alias, codexHome, vendor: "codex" } };
}

/**
 * What one fleet read says about every Codex plan.
 *
 * @param home the state home the cached cap records live under
 * @param nowIso the instant a window reset is judged against
 * @param snapshot the fleet read
 * @returns the plans a seat could take, best first, and the ones it could not
 */
function evidenceOf({
  home,
  nowIso,
  snapshot,
}: {
  home: string;
  nowIso: string;
  snapshot: CodexFleetSnapshot;
}): RecoveryEvidence {
  const ranking = rankCodexPlans({
    nowIso: snapshot.readAtIso,
    observations: snapshot.observations,
    thresholds: snapshot.thresholds,
  });
  const judged = ranking.ranked.flatMap((destination) =>
    snapshot.observations
      .filter((observation) => observation.destination.alias === destination.alias)
      .map((observation) => judgeRanked({ home, nowIso, observation })),
  );
  return {
    candidates: judged.flatMap((verdict) => ("candidate" in verdict ? [verdict.candidate] : [])),
    excluded: [
      ...judged.flatMap((verdict) => ("exclusion" in verdict ? [verdict.exclusion] : [])),
      ...ranking.excluded.map((exclusion) => routeExclusion({ exclusion })),
    ],
    vendor: "codex",
  };
}

/**
 * Read every Codex plan once and say which a throwaway session may open on.
 *
 * @param fleetCap where the fleet read files its conclusion
 * @param home the state home holding the register and the cached quota records
 * @param nowIso the instant the read and every reset are judged against
 * @param port where the plan register is read
 * @param readLive the live account reader
 * @param signInPort where the fleet read files each store's sign-in observation
 * @returns the plans a seat could take, best first, and the ones it could not
 */
export async function readCodexRecoveryEvidence({
  fleetCap,
  home,
  nowIso,
  port,
  readLive,
  signInPort,
}: {
  fleetCap: CodexFleetCapPort;
  home: string;
  nowIso: string;
  port: PlanRegisterPort;
  readLive: ReadCodexAccountsLive;
  signInPort: CodexSignInPort;
}): Promise<RecoveryEvidence> {
  const snapshot = await readCodexFleetSnapshot({ fleetCap, home, nowIso, port, readLive, signInPort });
  if (snapshot.isErr()) {
    return { candidates: [], excluded: [], unreadable: snapshot.error.message, vendor: "codex" };
  }
  return evidenceOf({ home, nowIso, snapshot: snapshot.value });
}
