/**
 * The Knock atlas's gap vocabulary and lifecycle: the questions this atlas could not answer, held as a
 * lifecycle rather than a report.
 *
 * The LIFECYCLE is the kit's ({@link reconcileGaps}) — accumulate, and close only when a gap's own
 * `(condition, scope)` pair is rechecked. What is this atlas's own is the VOCABULARY below.
 *
 * ## `dashboard-page-has-no-api` is the biggest single fact about this platform
 *
 * MEASURED:55 of the dashboard's 154 declared routes display something no operation this atlas
 * would call ever reads. Four of them are worth a reader's attention before any of the others, and each
 * gets its own gap rather than being folded into a count — the Agents workspace, which is the first item in
 * the product's own navigation and appears in neither published document at all; the audit log; the API
 * keys page; and the service tokens page. The last three matter more than their number suggests, because
 * they are the surfaces a security or compliance question reaches for first, and an API-only atlas would
 * answer "Knock offers no way to read that" about all four.
 *
 * Only Knock publishing an operation closes one, so they are open BY CONSTRUCTION and say so.
 *
 * ## `identifier-produced-by-neither-api` is the sharpest one, and it is arithmetic
 *
 * Nine declared GETs need an identifier NEITHER published document produces, and eight of the nine trace to
 * one fact: no operation on either API lists an account's object COLLECTIONS. So the whole `/v1/objects/…`
 * tree — a recipient model Knock's own documentation devotes a section to — is addressable only by a caller
 * who already knows the collection name, and nothing can enumerate one. Recorded as a gap rather than as an
 * exclusion, because it is a shortfall in the platform rather than a choice this atlas made.
 *
 * ## `cross-api-identifier-dependency` is a gap about Knock's DOCUMENTATION rather than its API
 *
 * Sixteen operations need an identifier only the OTHER document produces — triggering a workflow by key,
 * reading an audience's members, reading a recipient's channel data. Each works perfectly; what is missing
 * is that neither reference page says a second credential is required to discover what to call it with. It
 * is open until Knock's documentation says so, which is a thing this atlas can check rather than assume.
 *
 * ## And two are about the INSTALLATION rather than about Knock
 *
 * `api-credential-absent` is why this generation carries no entity at all, and it names the exact remedy,
 * because a kind that is empty for want of a token and a kind that is empty because the account holds
 * nothing are the same file with opposite meanings. `browser-session-absent` is its browser twin.
 */
import type { Result } from "../../lib/result.js";
import { type AtlasGapRecheck, KIT_GAP_CONDITIONS, openGaps, reconcileGaps } from "../kit/gaps.js";

import { knockGapId } from "./identity.js";
import type { KnockAtlasKind } from "./kinds.js";
import type { KnockAtlasChannel, KnockGap } from "./model.js";

/**
 * Every condition a Knock atlas gap can carry. A closed vocabulary, so closure can match exactly.
 * @internal
 */
export const KNOCK_GAP_CONDITIONS = [
  "api-credential-absent",
  "browser-session-absent",
  "cross-api-identifier-dependency",
  "dashboard-page-has-no-api",
  "identifier-produced-by-neither-api",
  "page-unreachable",
  ...KIT_GAP_CONDITIONS,
] as const;

/**
 * One condition a Knock atlas gap can carry.
 * @internal
 */
export type KnockGapCondition = (typeof KNOCK_GAP_CONDITIONS)[number];

/**
 * A Knock atlas gap observed during this run.
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
export function openKnockGap({
  condition,
  scope,
  kind,
  surfaces,
  fields,
  reason,
  at,
}: {
  condition: KnockGapCondition;
  scope: string;
  kind: KnockAtlasKind | null;
  surfaces: readonly KnockAtlasChannel[];
  fields: readonly string[];
  reason: string;
  at: string;
}): KnockGap {
  return {
    condition,
    fields: [...fields],
    firstDetectedAt: at,
    id: knockGapId({ condition, scope }),
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
export type KnockGapRecheck = AtlasGapRecheck;

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
export function reconcileKnockGaps({
  stored,
  observed,
  rechecks,
  runFailed,
  at,
}: {
  stored: readonly KnockGap[];
  observed: readonly KnockGap[];
  rechecks: readonly KnockGapRecheck[];
  runFailed: boolean;
  at: string;
}): Result<readonly KnockGap[]> {
  return reconcileGaps({ at, observed, rechecks, runFailed, stored });
}

/**
 * The open gaps, which is what a reader and a ticket list both want.
 *
 * @param gaps every gap held
 * @returns only the open ones
 * @internal
 */
export function openKnockGaps({ gaps }: { gaps: readonly KnockGap[] }): readonly KnockGap[] {
  return openGaps({ gaps });
}
