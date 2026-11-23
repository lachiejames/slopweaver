/**
 * This atlas's gap vocabulary and lifecycle: the questions it could not answer, held as a lifecycle rather
 * than a report.
 *
 * The LIFECYCLE is the kit's ({@link reconcileGaps}) — accumulate, and close only when a gap's own
 * `(condition, scope)` pair is rechecked. What is this atlas's own is the VOCABULARY below.
 *
 * Three of these are open BY CONSTRUCTION rather than by neglect, and saying so is the point: a surface
 * whose invented control answers exactly what a real route answers cannot be probed at all, and an atlas
 * should be the thing that reports a gap it cannot close, not the thing that hides one it cannot fix.
 */
import type { Result } from "../../lib/result.js";
import { type AtlasGapRecheck, KIT_GAP_CONDITIONS, openGaps, reconcileGaps } from "../kit/gaps.js";

import { inngestGapId } from "./identity.js";
import type { InngestAtlasGap, InngestChannel, InngestKind } from "./model.js";

/**
 * Every condition a gap here can carry. A closed vocabulary, so closure can match exactly.
 *
 * @internal
 */
export const INNGEST_GAP_CONDITIONS = [
  /** The published REST catalogue could not be fetched at all, so this run compiled nothing from it. */
  "rest-catalogue-unreachable",
  /** The catalogue was fetched and this compiler could read no operation out of it. */
  "rest-catalogue-uncompilable",
  /**
   * This run's operation census differs from the reviewed one. A separate condition from an unreachable
   * catalogue because it is a different claim: that one says the DOCUMENT was not served, and this says what
   * THIS READER got out of it moved, which is the failure a successful fetch cannot see.
   */
  "rest-census-moved",
  /**
   * A REST route whose existence an unauthenticated request could not establish, because the invented
   * control answered exactly what a real address answered. MEASURED: the whole `/v2` surface is
   * in this state — `/v2/zzzsyntheticzzz` answers the same `401 authorization_header_missing` as `/v2/apps`
   * — while `/v1` discriminates at all three depths tested. Reproduce with `slopweaver atlas inngest sync`.
   */
  "rest-route-unprobeable",
  /** A REST route the catalogue declares and an unauthenticated request answered 404 for. */
  "rest-route-absent",
  /** The dashboard's own route table could not be read out of the bundle it ships a signed-out visitor. */
  "dashboard-route-table-unreadable",
  /**
   * A dashboard route below a layout segment, where the sign-in redirect is served to any address at all.
   * Permanently open for those depths while this atlas is unsigned-in, and closed for a route only by the
   * walk actually rendering it.
   */
  "dashboard-route-unprobeable",
  /** A dashboard route the application's own table declares and an unauthenticated request answered 404 for. */
  "dashboard-route-absent",
  /** A dashboard route that answered a server error rather than a page or a sign-in wall. */
  "dashboard-route-errors",
  "dashboard-page-not-attempted",
  "dashboard-page-unreachable",
  "dashboard-screenshot-missing",
  /** A route the dashboard actually rendered or linked that this run's compiled registry does not declare. */
  "dashboard-route-undeclared",
  /**
   * Open while no Inngest API credential is configured. It is the single thing standing between this atlas
   * and the account entities it is supposed to hold through the API, so it is a first-class row rather than
   * a line in prose.
   */
  "api-credential-absent",
  /**
   * Permanently open by construction: `api.inngest.com/gql` answers `introspection disabled`, so the GraphQL
   * surface has no published denominator and the walk's own observations are a floor rather than a census.
   */
  "graphql-introspection-disabled",
  /**
   * A machine-readable route the vendor's own client references and the vendor's own server answers 500 for.
   * MEASURED: `api-docs.inngest.com/<page>.md` and `/llms-full.txt` both answer HTTP 500 while
   * `/llms.txt` answers 200, so the API reference's markdown mirror is unreadable and the catalogue is the
   * only machine-readable source of the REST surface.
   */
  "vendor-document-errors",
  /**
   * A reviewed disposition rule that matched nothing in the compiled catalogue. A dead rule reads as
   * considered judgement and is not one, so the sync raises it rather than letting it rot unnoticed.
   */
  "disposition-rule-never-fired",
  ...KIT_GAP_CONDITIONS,
] as const;

/**
 * One condition a gap here can carry.
 *
 * @internal
 */
export type InngestGapCondition = (typeof INNGEST_GAP_CONDITIONS)[number];

/**
 * A gap observed during this run.
 *
 * @param condition what is missing
 * @param scope where it is missing
 * @param kind the entity kind this gap is about, or `null` for a cross-kind gap
 * @param surfaces which channels this gap concerns; two for a disagreement, empty when channel-independent
 * @param fields which names the surfaces disagree about, when the condition is a disagreement
 * @param reason why, in English
 * @param at this run's ISO timestamp
 * @returns the gap, open and stamped
 */
export function openInngestGap({
  condition,
  scope,
  kind,
  surfaces,
  fields,
  reason,
  at,
}: {
  condition: InngestGapCondition;
  scope: string;
  kind: InngestKind | null;
  surfaces: readonly InngestChannel[];
  fields: readonly string[];
  reason: string;
  at: string;
}): InngestAtlasGap {
  return {
    condition,
    fields: [...fields],
    firstDetectedAt: at,
    id: inngestGapId({ condition, scope }),
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
 *
 * @internal
 */
export type InngestGapRecheck = AtlasGapRecheck;

/**
 * Fold this run's observations into the stored gap list, closing only what was genuinely rechecked.
 *
 * @param stored every gap the last generation held
 * @param observed the gaps this run detected
 * @param rechecks the (condition, scope) pairs this run genuinely rechecked
 * @param runFailed whether this run failed, in which case nothing may be closed
 * @param at this run's ISO timestamp
 * @returns the reconciled gap list, or why it could not be reconciled
 */
export function reconcileInngestGaps({
  stored,
  observed,
  rechecks,
  runFailed,
  at,
}: {
  stored: readonly InngestAtlasGap[];
  observed: readonly InngestAtlasGap[];
  rechecks: readonly InngestGapRecheck[];
  runFailed: boolean;
  at: string;
}): Result<readonly InngestAtlasGap[]> {
  return reconcileGaps({ at, observed, rechecks, runFailed, stored });
}

/**
 * The open gaps, which is what a reader and a ticket list both want.
 *
 * @param gaps every gap held
 * @returns only the open ones
 *
 * @internal
 */
export function openInngestGaps({ gaps }: { gaps: readonly InngestAtlasGap[] }): readonly InngestAtlasGap[] {
  return openGaps({ gaps });
}
