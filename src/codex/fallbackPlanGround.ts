/**
 * What grounded a Claude fallback PLAN: a capacity reading (`mode: "plan"`, `capEvidence`), or no Codex plan
 * registered at all (`mode: "plan-codex-provider-unregistered"`, `ground`).
 *
 * Split from `./fallbackPlan.ts`, which owns the request/receipt documents, because the ground is the one part
 * of a plan request that varies by arm. The plan request's `mode` was its KIND discriminator before it was a
 * ground one, so the unregistered arm declares a mode of its own rather than a new field beside `mode: "plan"`:
 * a build that predates it then reads the document as FOREIGN, never as an unreadable plan that fails the
 * landing gate closed install-wide (`./providerUnregistered.ts`, `./fallbackDocuments.ts`).
 *
 * Pure.
 */

import { isRecord } from "#lib/parsers.js";
import type { Result } from "#lib/result.js";
import type { CodexError } from "./errors.js";
import { type FallbackCapEvidence, fallbackCapLine } from "./fallbackReview.js";
import { parseFallbackCapEvidence } from "./fallbackReviewParse.js";
import type { FallbackGroundKind } from "./ledger.js";
import {
  CODEX_UNREGISTERED_GROUND,
  CODEX_UNREGISTERED_PLAN_MODE,
  type CodexProviderUnregisteredEvidence,
  type FallbackFleetGround,
  parseProviderUnregisteredEvidence,
  providerUnregisteredLine,
} from "./providerUnregistered.js";

/** The two arms a plan request's ground takes, discriminated by its `mode`. */
export type FallbackPlanGround =
  | { readonly mode: "plan"; readonly capEvidence: FallbackCapEvidence }
  | { readonly mode: typeof CODEX_UNREGISTERED_PLAN_MODE; readonly ground: CodexProviderUnregisteredEvidence };

/**
 * Whether a parsed request document is a PLAN request, on either ground, so the store knows which parser to
 * hand it.
 *
 * @param value the parsed JSON of a request
 * @returns true only when the document declares `mode: "plan"` or the unregistered plan mode
 */
export function isFallbackPlanDocument({ value }: { value: unknown }): boolean {
  return isRecord(value) && (value["mode"] === "plan" || value["mode"] === CODEX_UNREGISTERED_PLAN_MODE);
}

/**
 * The ground a plan request records, from what `prepare` read off the fleet.
 *
 * @param fleetGround the tagged ground `cli/commands/codex/fallbackCapRead.ts` returned
 * @returns the request's `mode` and its evidence field
 */
export function planGroundFor({ fleetGround }: { fleetGround: FallbackFleetGround }): FallbackPlanGround {
  if (fleetGround.kind === "unregistered") {
    return { ground: fleetGround.evidence, mode: CODEX_UNREGISTERED_PLAN_MODE };
  }
  return { capEvidence: fleetGround.evidence, mode: "plan" };
}

/**
 * The ground as one clause — the cap's sentence, or the unregistered one.
 *
 * @returns the clause a ledger row and `prepare`'s output both print
 */
export function planGroundLine({ request }: { request: FallbackPlanGround }): string {
  if (request.mode === CODEX_UNREGISTERED_PLAN_MODE) {
    return providerUnregisteredLine({ evidence: request.ground });
  }
  return fallbackCapLine({ evidence: request.capEvidence });
}

/**
 * Which ground a plan request stood on, as the ledger row names it.
 *
 * @returns `codex-provider-unregistered` on that arm, `cap` otherwise
 */
export function planFallbackGround({ request }: { request: FallbackPlanGround }): FallbackGroundKind {
  if (request.mode === CODEX_UNREGISTERED_PLAN_MODE) {
    return CODEX_UNREGISTERED_GROUND;
  }
  return "cap";
}

/**
 * Decode a plan request's ground off disk, by its declared mode.
 *
 * @param value the parsed request, already known to be a record
 * @returns the ground, or why it is not one
 */
export function parsePlanGround({ value }: { value: Record<string, unknown> }): Result<FallbackPlanGround, CodexError> {
  if (value["mode"] === CODEX_UNREGISTERED_PLAN_MODE) {
    return parseProviderUnregisteredEvidence({ value: value["ground"] }).map((ground): FallbackPlanGround => ({
      ground,
      mode: CODEX_UNREGISTERED_PLAN_MODE,
    }));
  }
  return parseFallbackCapEvidence({ value: value["capEvidence"] }).map((capEvidence): FallbackPlanGround => ({
    capEvidence,
    mode: "plan",
  }));
}
