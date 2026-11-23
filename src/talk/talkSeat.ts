/**
 * The register row a Talk call spends, decided once for both readers that need it: `talk offer`, which launches
 * the call on it, and `codex quota show --routed`, which the call widget's "Plan left" row polls. Two copies of
 * the decision would let the widget report one plan's quota while the call spent another's — the defect of a row still read from the ambient store after the call had moved to a row.
 *
 * `allowRefusing` is `false` and no alias is requested: the voice has no `--force` and no `--plan`, so a pause, a
 * usage limit and a monthly-spend row all hold (`./planRoute.ts`).
 *
 * The routed home leaves here ABSOLUTE. A weekly-only register may still carry a relative `storeDir`
 * (`../plans/register.ts`), which routing resolves from this process's directory — while the call child
 * launches from a fresh temporary one (`site/lib/talkPlanLaunch.ts`), so the same relative string would name a
 * different store there, and the row admitted would not be the row that pays.
 */

import { isAbsolute, resolve } from "node:path";

import type { CodexSeatRoute } from "../cmux/seatRoute.js";
import { readCodexAccountsLive } from "../codex/accountLive.js";
import { codexFleetCapPort } from "../codex/fleetCapPort.js";
import { decideCodexSeat } from "../codex/seatDecision.js";
import type { CodexSeatError } from "../codex/seatDecisionErrors.js";
import { codexSignInPort } from "../codex/signInPort.js";
import type { Result } from "../lib/result.js";
import { planRegisterPort } from "../plans/port.js";

/**
 * A routed seat with its home made absolute against the directory routing resolved it from, so it names the
 * same store across a process boundary that changes directory. An absolute home is returned unchanged.
 *
 * @param route the seat as routed
 * @param cwd the directory a relative home was resolved from while routing
 * @returns the seat, its `codexHome` absolute
 */
export function absoluteTalkSeat({ cwd, route }: { cwd: string; route: CodexSeatRoute }): CodexSeatRoute {
  if (isAbsolute(route.destination.codexHome)) {
    return route;
  }
  return { ...route, destination: { ...route.destination, codexHome: resolve(cwd, route.destination.codexHome) } };
}

/**
 * Route a Talk call through the production ports, exactly as a Codex seat with no `--plan` and no `--force` is.
 *
 * @param home the state home whose plan register is read
 * @param nowIso the instant usage windows are judged at
 * @param deadlineAtMs the instant the route's fleet read must answer by, when a parent kills the caller then —
 *   the console's `codex quota show --routed` poll. The read is then
 *   the bounded one `codex route` takes under `talk verb`: live batch shortened to fit, rollout scan skipped, no
 *   fleet-cap record filed. Absent, as for `talk offer`, it takes as long as its bounded parts do
 * @returns the routed row, its home absolute, and why; or why no row may pay
 */
export async function decideTalkSeat({
  deadlineAtMs,
  home,
  nowIso,
}: {
  deadlineAtMs?: number;
  home: string;
  nowIso: string;
}): Promise<Result<CodexSeatRoute, CodexSeatError>> {
  const deadlineArg = deadlineAtMs === undefined ? {} : { deadlineAtMs };
  const routed = await decideCodexSeat({
    ...deadlineArg,
    allowRefusing: false,
    fleetCap: codexFleetCapPort(),
    home,
    nowIso,
    port: planRegisterPort(),
    readLive: readCodexAccountsLive,
    requestedAlias: undefined,
    signInPort: codexSignInPort(),
  });
  return routed.map((route) => absoluteTalkSeat({ cwd: process.cwd(), route }));
}
