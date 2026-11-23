/**
 * The `codex-provider-unregistered` fallback ground — rule 9 on an install that registered no Codex plan.
 *
 * The owner's ruling is that a visible Claude session takes the plan and review passes when Codex cannot. The two
 * grounds that licensed that until now were both statements about Codex CAPACITY: a provider cap, or the
 * fleet held at the routing pause (`./fallbackCap.ts`). An install whose register carries no Codex row at all
 * has neither, so on a Claude-only install the fallback verbs refused and rule 9 had no route. The
 * one constraint: "no Codex plan registered" is a legitimate
 * reason to take the pass in Claude, but it is NOT evidence that Codex was capped, so it is its own ground and
 * never a {@link FallbackCapEvidence}.
 *
 * **When it applies, exactly.** Over a READABLE register whose Codex rows number zero, adopted or derived alike:
 * a Codex plan exists only once the user registers one (`plans add --provider codex`), never because a login
 * sits in `$CODEX_HOME` (the owner's rule), so an unadopted install with no Codex row really has no Codex
 * provider. An unreadable register is no evidence of anything; and a register holding a paused, signed-out or
 * unmeasured Codex row has a Codex plan — that fleet is unavailable, which is the capacity grounds' question.
 *
 * **Why the documents declare a NEW mode.** The fallback store is shared by every checkout on a machine, and an
 * older build that cannot PARSE a request counts it unreadable — which fails the landing gate closed on every
 * branch, permanently, because the store is append-only (`./fallbackDocuments.ts` § A kind this build does
 * not know). A mode an older build has no parser for is FOREIGN to it instead: counted and named, never fatal
 * install-wide. So a review request on this ground is `mode: "review-codex-provider-unregistered"` and a plan
 * request is `mode: "plan-codex-provider-unregistered"`, each carrying the evidence as `ground` in place of
 * `capEvidence`. FOREIGN still hides a verdict from that older build, so the store's reader epoch fences it off
 * (`../store/schema/codexFallback.ts` § "The reader epoch").
 *
 * Pure.
 */

import { isRecord } from "#lib/parsers.js";
import { err, ok, type Result } from "#lib/result.js";
import { type CodexError, CodexErrors } from "./errors.js";
import type { FallbackCapEvidence } from "./fallbackReview.js";

/** The review request's mode on this ground — foreign to every build that predates it. */
export const CODEX_UNREGISTERED_REVIEW_MODE = "review-codex-provider-unregistered";

/** The plan request's mode on this ground — foreign to every build that predates it. */
export const CODEX_UNREGISTERED_PLAN_MODE = "plan-codex-provider-unregistered";

/** The ground's own name — its evidence's `kind` and a ledger row's `fallbackGround`. */
export const CODEX_UNREGISTERED_GROUND = "codex-provider-unregistered";

/** What `prepare` read that grounds the fallback: a readable register with no Codex row. Never a cap. */
export interface CodexProviderUnregisteredEvidence {
  readonly kind: "codex-provider-unregistered";
  /** When the register was read — the instant the absence was observed. */
  readonly observedAtIso: string;
  /** The sentence a reader acts on, naming the register read and what it did not carry. */
  readonly why: string;
}

/** The ground a fallback request stands on when `prepare` reads the fleet: a capacity reading, or no Codex plan. */
export type FallbackFleetGround =
  | { readonly kind: "cap"; readonly evidence: FallbackCapEvidence }
  | { readonly kind: "unregistered"; readonly evidence: CodexProviderUnregisteredEvidence };

/** The sentence every unregistered ground carries, so a request and the fleet verdict can never word it two ways. */
export const CODEX_UNREGISTERED_WHY =
  "the plan register carries no Codex row, so Claude is the configured planning and review provider — " +
  "nothing here read a cap; `slopweaver plans add --provider codex` registers one";

/**
 * Whether a register read grounds the fallback on Codex's absence, and the evidence when it does.
 *
 * @param codexRows how many Codex rows the read carried, paused or signed out included
 * @param readAtIso the instant of the read
 * @returns the evidence, or `undefined` when a Codex row exists
 */
export function codexProviderUnregistered({
  codexRows,
  readAtIso,
}: {
  codexRows: number;
  readAtIso: string;
}): CodexProviderUnregisteredEvidence | undefined {
  if (codexRows > 0) {
    return undefined;
  }
  return { kind: "codex-provider-unregistered", observedAtIso: readAtIso, why: CODEX_UNREGISTERED_WHY };
}

/**
 * The ground as one clause, worded so it can never be read as a cap.
 *
 * @returns `No Codex plan is registered: <why>`
 */
export function providerUnregisteredLine({ evidence }: { evidence: CodexProviderUnregisteredEvidence }): string {
  return `No Codex plan is registered: ${evidence.why}`;
}

/**
 * Decode the evidence a request carries as its `ground` on this mode.
 *
 * @param value the `ground` field as parsed off disk
 * @returns the evidence, or why it is not complete
 */
export function parseProviderUnregisteredEvidence({
  value,
}: {
  value: unknown;
}): Result<CodexProviderUnregisteredEvidence, CodexError> {
  if (!isRecord(value)) {
    return err(CodexErrors.notAnObject({ field: "ground" }));
  }
  const { kind, observedAtIso, why } = value;
  if (kind !== "codex-provider-unregistered" || typeof observedAtIso !== "string" || typeof why !== "string") {
    return err(CodexErrors.unregisteredGroundIncomplete());
  }
  return ok({ kind, observedAtIso, why });
}
