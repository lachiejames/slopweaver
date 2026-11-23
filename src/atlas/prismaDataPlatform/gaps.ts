/**
 * The Prisma Data Platform atlas's gap vocabulary and lifecycle: the questions this atlas could not answer,
 * held as a lifecycle rather than a report.
 *
 * The LIFECYCLE is the kit's ({@link reconcileGaps}) — accumulate, and close only when a gap's own
 * `(condition, scope)` pair is rechecked. What is this atlas's own is the VOCABULARY below.
 *
 * ## Four of these conditions are open BY CONSTRUCTION, and saying so is the point
 *
 * `docs-omit-declared-operation` is the biggest single fact about this platform: 70 of its 115 declared
 * operations — the whole Prisma Compute product — have no documentation page at all. Only Prisma writing
 * one closes it, and until then a reader working from `www.prisma.io/docs` has no way to learn that surface
 * exists.
 *
 * `console-origin-indiscriminate` says the browser surface CANNOT be inventoried without signing in: every
 * path on `console.prisma.io`, real or invented, answers one sign-in redirect, and the application's own
 * signed-out route manifest declares two addressable paths. Only a walk closes it.
 *
 * `spec-references-undeclared-endpoint` fires for the five authorization-server addresses the OpenAPI
 * document and the RFC 8414 metadata name and no operation declares.
 *
 * `surface-self-contradiction` fires for the one operation whose `security` block and whose own description
 * disagree, with the live service siding with the description. Recorded rather than resolved: which surface
 * wins is the owner's call (`docs/atlas-intent/04-corroboration.md`).
 *
 * ## And one is about the ORGANISATION rather than about Prisma
 *
 * `vendor-inventory-disagreement` records that this platform is in the SaaS-discovery inventory and not in
 * the managed vendor register — two internal stores that disagree about whether this vendor is being
 * tracked. It is written as a QUESTION with the commands that answer it rather than as a frozen count, for
 * the reason `docs/doctrine-rationale/rule-3.md` gives about evidence that expires: a gap asserting "absent from
 * the register" would become a confident lie the day somebody adds the row, on the only axis a reader could
 * check. `sync.ts` carries the reproduction.
 *
 * `api-credential-absent` is the last, and it is the reason this generation carries no entity at all. It is
 * a gap about ACCESS rather than about Prisma, and it names the exact remedy, because a kind that is empty
 * for want of a token and a kind that is empty because the organisation holds nothing are the same file
 * with opposite meanings.
 */
import type { Result } from "../../lib/result.js";
import { type AtlasGapRecheck, KIT_GAP_CONDITIONS, openGaps, reconcileGaps } from "../kit/gaps.js";

import { prismaDataPlatformGapId } from "./identity.js";
import type { PrismaDataPlatformAtlasKind } from "./kinds.js";
import type { PrismaDataPlatformAtlasChannel, PrismaDataPlatformGap } from "./model.js";

/**
 * Every condition a Prisma Data Platform atlas gap can carry. A closed vocabulary, so closure can match
 * exactly.
 * @internal
 */
export const PRISMA_DATA_PLATFORM_GAP_CONDITIONS = [
  "api-credential-absent",
  "browser-session-absent",
  "console-origin-indiscriminate",
  "docs-omit-declared-operation",
  "spec-references-undeclared-endpoint",
  "surface-self-contradiction",
  "vendor-inventory-disagreement",
  ...KIT_GAP_CONDITIONS,
] as const;

/**
 * One condition a Prisma Data Platform atlas gap can carry.
 * @internal
 */
export type PrismaDataPlatformGapCondition = (typeof PRISMA_DATA_PLATFORM_GAP_CONDITIONS)[number];

/**
 * A Prisma Data Platform atlas gap observed during this run.
 *
 * @param condition what is missing
 * @param scope where it is missing
 * @param kind the entity kind this gap is about, or `null` for a cross-kind gap
 * @param surfaces which channels this gap concerns; two for a disagreement, empty when channel-independent
 * @param fields which names the two surfaces disagree about, when the condition is a disagreement
 * @param reason why, in English
 * @param at this run's ISO timestamp
 * @returns the gap, open and stamped
 */
export function openPrismaGap({
  condition,
  scope,
  kind,
  surfaces,
  fields,
  reason,
  at,
}: {
  condition: PrismaDataPlatformGapCondition;
  scope: string;
  kind: PrismaDataPlatformAtlasKind | null;
  surfaces: readonly PrismaDataPlatformAtlasChannel[];
  fields: readonly string[];
  reason: string;
  at: string;
}): PrismaDataPlatformGap {
  return {
    condition,
    fields: [...fields],
    firstDetectedAt: at,
    id: prismaDataPlatformGapId({ condition, scope }),
    kind,
    lastCheckedAt: at,
    lastDetectedAt: at,
    reason,
    scope,
    status: "open",
    surfaces: [...surfaces],
  };
}

/**
 * A condition and scope that were genuinely rechecked, and what the recheck found.
 * @internal
 */
export type PrismaGapRecheck = AtlasGapRecheck;

/**
 * Fold this run's gaps and rechecks into what is already stored.
 *
 * @param stored every gap already held
 * @param observed gaps this run detected
 * @param rechecks conditions and scopes this run actually rechecked
 * @param runFailed whether the run itself failed; a failed run may not close anything
 * @param at this run's ISO timestamp
 * @returns the accumulated gap list, or the reason it cannot be merged
 */
export function reconcilePrismaGaps({
  stored,
  observed,
  rechecks,
  runFailed,
  at,
}: {
  stored: readonly PrismaDataPlatformGap[];
  observed: readonly PrismaDataPlatformGap[];
  rechecks: readonly PrismaGapRecheck[];
  runFailed: boolean;
  at: string;
}): Result<readonly PrismaDataPlatformGap[]> {
  return reconcileGaps({ at, observed, rechecks, runFailed, stored });
}

/**
 * The open gaps, which is what a reader and a ticket list both want.
 *
 * @param gaps every gap held
 * @returns only the open ones
 * @internal
 */
export function openPrismaGaps({ gaps }: { gaps: readonly PrismaDataPlatformGap[] }): readonly PrismaDataPlatformGap[] {
  return openGaps({ gaps });
}
