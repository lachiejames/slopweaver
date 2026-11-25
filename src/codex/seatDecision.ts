/**
 * Which registered Codex account a piece of work may spend, and whether it may at all — ONE decision, shared by
 * every consumer that spends a Codex account on the owner's behalf: a visible `cmux spawn --driver codex` seat
 * (`../cli/commands/cmux/codexSeat.ts`), the chair's Codex successor
 * (`../cli/commands/supervisor/chairSuccessorReads.ts`) and the console voice (`talk offer`). One
 * plan of either provider runs all of Slopweaver, and a usage limit the owner sets is respected even if it means
 * taking the fleet down — so the voice asks the same question a seat asks, of the same live fleet read, rather
 * than riding whatever login the ambient `$CODEX_HOME` holds.
 *
 * It lives here rather than in the cmux command because neither the voice nor the chair is a spawn: the flags
 * (`--plan`, `--force`) are translated by the caller, and this module takes only what the decision needs.
 */

import { err, ok, type Result } from "#lib/result.js";

import { type CodexSeatRoute, routeCodexSeat } from "../cmux/seatRoute.js";
import type { PlanRegisterPort } from "../plans/port.js";
import type { ReadCodexAccountsLive } from "./accountLive.js";
import type { CodexDestination } from "./destinations.js";
import type { CodexFleetCapPort } from "./fleetCapPort.js";
import { readCodexFleetSnapshot } from "./fleetRead.js";
import type { CodexFleetSnapshot, CodexPlanObservation } from "./fleetTypes.js";
import { currentCodexQuotaDecision } from "./quotaNow.js";
import { codexUsagePolicyExclusion, rankCodexPlans } from "./rank.js";
import { type CodexSeatError, CodexSeatErrors } from "./seatDecisionErrors.js";
import type { CodexSignInPort } from "./signInPort.js";

/**
 * The routed row's whole observation from THIS fleet read, never a second batch: one app-server per store per
 * decision, and the register row and its gauge already paired, so the usage policy and the quota read judge it.
 *
 * Undefined only when the read did not carry the routed destination — which the router, ranking that same read,
 * cannot produce — and the caller then REFUSES: without the row its usage limit cannot be checked, and a limit
 * that disappears when it cannot be read is no ceiling.
 */
function routedObservation({
  destination,
  snapshot,
}: {
  destination: CodexDestination;
  snapshot: CodexFleetSnapshot;
}): CodexPlanObservation | undefined {
  return snapshot.observations.find((observation) => observation.destination.alias === destination.alias);
}

/**
 * Whether the routed account may be spent now, judged in an order that is the point.
 *
 * The owner's own usage policy comes FIRST and `allowRefusing` never reaches it: a `monthly-spend` row is NOT
 * MEASURED and a week at its usage limit is the owner's ceiling (`./rank.ts`'s `codexUsagePolicyExclusion`). Only then may
 * `allowRefusing` (a spawn's `--force`) bypass the PROVIDER quota decision, which is the one thing that flag has
 * ever meant.
 *
 * @param observation the routed destination's register row, gauge and live answer, already paired
 * @param allowRefusing whether the caller may spend past the provider quota decision, once
 * @param home the state home the cached cap records live under
 * @param nowIso the instant a window reset is judged against
 * @returns the refusal reason, or undefined when the account may be spent
 */
export function codexSeatPreflightRefusal({
  allowRefusing,
  home,
  nowIso,
  observation,
}: {
  allowRefusing: boolean;
  home: string | undefined;
  nowIso: string;
  observation: CodexPlanObservation;
}): string | undefined {
  const policy = codexUsagePolicyExclusion({ nowIso, observation });
  if (policy !== undefined) {
    return `${policy.destination.alias} is excluded (${policy.kind}): ${policy.reason}`;
  }
  if (allowRefusing) {
    return undefined;
  }
  const decision = currentCodexQuotaDecision({
    alias: observation.destination.alias,
    codexHome: observation.destination.codexHome,
    home,
    live: observation.live,
    nowIso,
  });
  return decision.refuse ? decision.reason : undefined;
}

/**
 * The whole Codex seat decision, printing nothing.
 *
 * Reads the register and every registered destination's own evidence once (`./fleetRead.ts`), ranks it with the
 * SAME ranker a Codex pass uses (`./rank.ts`), lets `../cmux/seatRoute.ts` — pure — pick, and then asks the owner's
 * usage policy and the cap cache whether the picked account may be spent at all.
 *
 * An unreadable register is its own typed error and never an empty fleet: "no destinations" and "the register
 * would not decode" are opposite answers, and a router that confused them would boot on the ambient home exactly
 * when the register it was meant to obey had broken.
 *
 * @param allowRefusing whether the caller may spend past a refusing provider quota (a spawn's `--force`); the
 *   owner's pause, usage limit and monthly-spend setting are never crossed by it
 * @param deadlineAtMs the instant the fleet read must answer by, when a parent kills the caller then (the console's
 *   `codex quota show --routed` poll): the read then bounds its live batch, skips the rollout scan and files no
 *   fleet-cap record, exactly as `codex route` under `talk verb` does; absent, it takes as long as its bounded parts do
 * @param fleetCap where the fleet read files its conclusion, so the monitor lane reads what this decision saw
 * @param home the state home holding the register and the cached quota records
 * @param nowIso the instant the read and every reset are judged against
 * @param port where the plan register is read
 * @param readLive the live account reader — `readCodexAccountsLive` in production, a plain fake in a test
 * @param requestedAlias the alias the caller named (a spawn's `--plan`), or undefined to take the ranked best
 * @param signInPort where the fleet read files each store's sign-in observation
 * @returns the routed account, or why none may be spent
 */
export async function decideCodexSeat({
  allowRefusing,
  deadlineAtMs,
  fleetCap,
  home,
  nowIso,
  port,
  readLive,
  requestedAlias,
  signInPort,
}: {
  allowRefusing: boolean;
  deadlineAtMs?: number;
  fleetCap: CodexFleetCapPort;
  home: string;
  nowIso: string;
  port: PlanRegisterPort;
  readLive: ReadCodexAccountsLive;
  requestedAlias: string | undefined;
  signInPort: CodexSignInPort;
}): Promise<Result<CodexSeatRoute, CodexSeatError>> {
  const deadlineArg = deadlineAtMs === undefined ? {} : { deadlineAtMs };
  const snapshot = await readCodexFleetSnapshot({ ...deadlineArg, fleetCap, home, nowIso, port, readLive, signInPort });
  if (snapshot.isErr()) {
    return err(CodexSeatErrors.registerUnreadable({ detail: snapshot.error.message }));
  }
  return routedOverSnapshot({ allowRefusing, home, nowIso, requestedAlias, snapshot: snapshot.value });
}

/**
 * Whether the plan a continuing session opened on may take the seat again, judged over the SAME fleet read the spawn
 * would route on, and never by ranking first: the session's transcript lives under that one `$CODEX_HOME`, so the
 * question is whether THAT home may be spent, not which home is emptiest.
 *
 * It may not when no registered row carries it any more, when the owner paused it, when its store is signed out or
 * gone, or when the shared preflight ({@link codexSeatPreflightRefusal}: the owner's usage limit and monthly-spend
 * setting, then the provider quota unless `allowRefusing`) refuses it. The near-cap routing bar is NOT a reason: it
 * steers new work away from a plan, and a refusing quota is already caught by the preflight.
 *
 * @param allowRefusing whether the caller may spend past a refusing provider quota (a spawn's `--force`)
 * @param codexHome the `$CODEX_HOME` the app's recovery journal recorded the session opening on
 * @param home the state home the cached cap records live under
 * @param nowIso the instant a window reset is judged against
 * @param snapshot the one fleet read this decision and any fresh routing share
 * @returns the route onto the recorded home, or why it cannot be resumed on
 */
function assessRecordedCodexHome({
  allowRefusing,
  codexHome,
  home,
  nowIso,
  snapshot,
}: {
  allowRefusing: boolean;
  codexHome: string;
  home: string | undefined;
  nowIso: string;
  snapshot: CodexFleetSnapshot;
}):
  | { readonly kind: "resume"; readonly destination: CodexDestination }
  | { readonly kind: "fresh"; readonly reason: string } {
  const observation = snapshot.observations.find((candidate) => candidate.destination.codexHome === codexHome);
  if (observation === undefined) {
    return { kind: "fresh", reason: "no registered Codex plan carries that home any more" };
  }
  const { alias } = observation.destination;
  const { paused } = observation.plan;
  if (paused !== undefined) {
    return { kind: "fresh", reason: `${alias} is paused: ${paused.reason}` };
  }
  const { live } = observation;
  if (live.kind === "signed-out" || live.kind === "store-missing") {
    const state = live.kind === "signed-out" ? "nothing is signed in there" : "its store directory does not exist";
    return { kind: "fresh", reason: `${alias} cannot be spent: ${state}` };
  }
  const refusal = codexSeatPreflightRefusal({ allowRefusing, home, nowIso, observation });
  if (refusal !== undefined) {
    return { kind: "fresh", reason: refusal };
  }
  return { destination: observation.destination, kind: "resume" };
}

/** What a continuing Codex seat boots on: its recorded plan, or a newly routed one and why the recorded one is not. */
export type CodexContinuationDecision =
  | { readonly kind: "resume"; readonly route: CodexSeatRoute }
  | { readonly kind: "fresh"; readonly reason: string; readonly route: CodexSeatRoute };

/**
 * The Codex seat decision for a spawn continuing an app session, over ONE fleet read: the recorded `$CODEX_HOME` when
 * {@link assessRecordedCodexHome} admits it, else ordinary routing — exactly {@link decideCodexSeat}'s — for a FRESH
 * session, carrying why.
 *
 * An explicit `requestedAlias` naming a plan other than the admissible recorded one is REFUSED rather than ignored:
 * honouring it would open the resume on a different login, which the app refuses, and dropping it silently would
 * boot a plan the operator did not name. On the fresh branch it routes as `--plan` always does.
 *
 * @param allowRefusing whether the caller may spend past a refusing provider quota (a spawn's `--force`)
 * @param continuing the session being continued: the app's id for it and the home its recovery journal recorded
 * @param fleetCap where the fleet read files its conclusion
 * @param home the state home holding the register and the cached quota records
 * @param nowIso the instant the read and every reset are judged against
 * @param port where the plan register is read
 * @param readLive the live account reader — `readCodexAccountsLive` in production, a plain fake in a test
 * @param requestedAlias the alias the caller named (a spawn's `--plan`), or undefined
 * @param signInPort where the fleet read files each store's sign-in observation
 * @returns the resume onto the recorded plan, the fresh route and why, or why no seat may open at all
 */
export async function decideContinuingCodexSeat({
  allowRefusing,
  continuing,
  fleetCap,
  home,
  nowIso,
  port,
  readLive,
  requestedAlias,
  signInPort,
}: {
  allowRefusing: boolean;
  continuing: { readonly sessionId: string; readonly codexHome: string };
  fleetCap: CodexFleetCapPort;
  home: string;
  nowIso: string;
  port: PlanRegisterPort;
  readLive: ReadCodexAccountsLive;
  requestedAlias: string | undefined;
  signInPort: CodexSignInPort;
}): Promise<Result<CodexContinuationDecision, CodexSeatError>> {
  const snapshot = await readCodexFleetSnapshot({ fleetCap, home, nowIso, port, readLive, signInPort });
  if (snapshot.isErr()) {
    return err(CodexSeatErrors.registerUnreadable({ detail: snapshot.error.message }));
  }
  const assessed = assessRecordedCodexHome({
    allowRefusing,
    codexHome: continuing.codexHome,
    home,
    nowIso,
    snapshot: snapshot.value,
  });
  if (assessed.kind === "resume") {
    const { alias } = assessed.destination;
    if (requestedAlias !== undefined && requestedAlias !== alias) {
      return err(
        CodexSeatErrors.seatRefused({
          refusal:
            `--plan ${requestedAlias} conflicts with app session ${continuing.sessionId}, which opened on ${alias} ` +
            `(CODEX_HOME=${continuing.codexHome}) and resumes only there — drop --plan, or name ${alias}`,
        }),
      );
    }
    const why = `app session ${continuing.sessionId} resumes on the plan it was opened on`;
    return ok({ kind: "resume", route: { destination: assessed.destination, why } });
  }
  const routed = routedOverSnapshot({ allowRefusing, home, nowIso, requestedAlias, snapshot: snapshot.value });
  return routed.map((route): CodexContinuationDecision => ({ kind: "fresh", reason: assessed.reason, route }));
}

/**
 * Rank one fleet read, let the pure router pick, and ask the usage policy and the cap cache whether the pick may be
 * spent — {@link decideCodexSeat}'s whole decision once its read has answered.
 */
function routedOverSnapshot({
  allowRefusing,
  home,
  nowIso,
  requestedAlias,
  snapshot,
}: {
  allowRefusing: boolean;
  home: string;
  nowIso: string;
  requestedAlias: string | undefined;
  snapshot: CodexFleetSnapshot;
}): Result<CodexSeatRoute, CodexSeatError> {
  const routed = routeCodexSeat({
    allowRefusing,
    ranking: rankCodexPlans({
      nowIso: snapshot.readAtIso,
      observations: snapshot.observations,
      thresholds: snapshot.thresholds,
    }),
    requestedAlias,
  });
  if (routed.isErr()) {
    return err(CodexSeatErrors.unrouted({ route: routed.error }));
  }
  const observation = routedObservation({ destination: routed.value.destination, snapshot });
  if (observation === undefined) {
    return err(
      CodexSeatErrors.seatRefused({
        refusal: `${routed.value.destination.alias} was not in this fleet read, so its usage limit cannot be checked`,
      }),
    );
  }
  const refusal = codexSeatPreflightRefusal({
    allowRefusing,
    home,
    nowIso,
    observation,
  });
  if (refusal !== undefined) {
    return err(CodexSeatErrors.seatRefused({ refusal }));
  }
  return ok(routed.value);
}
