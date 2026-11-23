/**
 * What the two surfaces say about the same method, and where they differ.
 *
 * This is the card the corroboration ruling asks for, in code: real instances of API-versus-browser
 * disagreement, collected, with nothing resolved. The ruling (`docs/atlas-intent/04-corroboration.md`) reserves what a
 * disagreement MEANS for the owner and says the instances come first — because a disagreement may be
 * evidence the atlas is built wrong rather than evidence the platform is inconsistent. So every function
 * here reports and none of them picks a winner.
 *
 * ## Why a screenshot could never have produced this
 *
 * The browser has been driven over a platform in this workstream before and what it produced was pictures
 * and analysis markdown, kept BESIDE the atlas. A picture cannot disagree with an API record: there is
 * nothing in it to diff. What makes a disagreement computable is that both surfaces wrote a RECORD of the
 * same shape about the same entity, which is what `atlasProjection.ts` builds and this file reads.
 *
 * ## Absence is not disagreement, except when it is
 *
 * A method the SDK declares and the browser never called is NOT a finding — the walked session's web client had no
 * reason to call it, and reporting that as a disagreement would bury the real ones under a row for every
 * SDK method the walk never exercised. A method the browser called and the SDK does not declare IS one: it is the undocumented
 * surface the both-surfaces ruling exists to find. That asymmetry is deliberate and is the single judgement
 * this file makes.
 */

import { absentAsNumber } from "#lib/absent.js";
import { type AtlasGap, openDisagreementGap, openGap } from "../kit/gaps.js";
import {
  type SlackAtlasEntity,
  type SlackMethodApiDetail,
  type SlackMethodBrowserDetail,
  slackMethodApiDetailSchema,
  slackMethodBrowserDetailSchema,
} from "./atlasModel.js";

/** How the two surfaces stand on one method. */
type SurfaceVerdict = "both" | "api-only" | "browser-only";

/** One method, as both surfaces saw it, with every name only one of them has. */
export interface SurfaceComparison {
  readonly method: string;
  readonly verdict: SurfaceVerdict;
  /** Parameters the web client actually sent that the installed SDK does not declare. */
  readonly paramsBrowserOnly: readonly string[];
  /** Response field paths the web client got back that the SDK's declared response shape does not have. */
  readonly pathsBrowserOnly: readonly string[];
  /** Response field paths the SDK declares that this session's calls never returned. */
  readonly pathsApiOnly: readonly string[];
  /** How many times the driven session called it; `0` when only the SDK knows it. */
  readonly callCount: number;
}

/**
 * Read one channel's stored detail back through its own schema.
 *
 * Parsed rather than cast, because `detail` is `unknown` on disk by design — one entity shape serves three
 * detail shapes — and a consumer that asserted instead would read a `page` entity's detail as a method's and
 * report an empty diff rather than a type error.
 *
 * @param detail the stored channel detail
 * @returns the parsed API detail, or `null` when this channel holds something else
 */
function apiDetailOf({ detail }: { detail: unknown }): SlackMethodApiDetail | null {
  const parsed = slackMethodApiDetailSchema.safeParse(detail);
  return parsed.success ? parsed.data : null;
}

/**
 * Read one channel's stored detail back through the browser-method schema.
 *
 * @param detail the stored channel detail
 * @returns the parsed browser detail, or `null` when this channel holds something else
 */
function browserDetailOf({ detail }: { detail: unknown }): SlackMethodBrowserDetail | null {
  const parsed = slackMethodBrowserDetailSchema.safeParse(detail);
  return parsed.success ? parsed.data : null;
}

/** Every member of `left` that `right` does not have, sorted. */
function only({ left, right }: { left: readonly string[]; right: readonly string[] }): readonly string[] {
  const known = new Set(right);
  return left.filter((name) => !known.has(name)).toSorted();
}

/**
 * Compare both surfaces for every method entity.
 *
 * @param entities the atlas's `method` entities
 * @returns one comparison per method, the ones with something to say first, then by method name
 */
export function compareSurfaces({ entities }: { entities: readonly SlackAtlasEntity[] }): readonly SurfaceComparison[] {
  return entities
    .filter((entity) => entity.kind === "method")
    .map((entity): SurfaceComparison => {
      const api = entity.channels.api === null ? null : apiDetailOf({ detail: entity.channels.api.detail });
      const browser =
        entity.channels.browser === null ? null : browserDetailOf({ detail: entity.channels.browser.detail });
      const verdict = surfaceVerdict({ api, browser });
      return {
        callCount: absentAsNumber({ value: browser?.callCount, whenAbsent: 0 }),
        method: entity.providerId,
        paramsBrowserOnly:
          api === null || browser === null ? [] : only({ left: browser.paramNames, right: api.paramNames }),
        pathsApiOnly:
          api === null || browser === null ? [] : only({ left: api.responsePaths, right: browser.responsePaths }),
        pathsBrowserOnly:
          api === null || browser === null ? [] : only({ left: browser.responsePaths, right: api.responsePaths }),
        verdict,
      };
    })
    .toSorted(
      (left, right) =>
        disagreementWeight({ row: right }) - disagreementWeight({ row: left }) ||
        left.method.localeCompare(right.method),
    );
}

/**
 * Which surfaces hold this method.
 *
 * @param api the parsed API detail, or `null`
 * @param browser the parsed browser detail, or `null`
 * @returns the verdict
 */
function surfaceVerdict({
  api,
  browser,
}: {
  api: SlackMethodApiDetail | null;
  browser: SlackMethodBrowserDetail | null;
}): SurfaceVerdict {
  if (api !== null && browser !== null) {
    return "both";
  }
  return browser === null ? "api-only" : "browser-only";
}

/** How much this row has to say, so the interesting ones sort first. Ordering only — never a threshold. */
function disagreementWeight({ row }: { row: SurfaceComparison }): number {
  const browserOnly = row.verdict === "browser-only" ? 1 : 0;
  return browserOnly * 1000 + row.paramsBrowserOnly.length * 10 + row.pathsBrowserOnly.length;
}

/**
 * Only the rows that actually disagree — see this file's header on why `api-only` is not one of them.
 *
 * @param comparisons every comparison the run made
 * @returns the rows where one surface knows something the other does not
 */
export function disagreements({
  comparisons,
}: {
  comparisons: readonly SurfaceComparison[];
}): readonly SurfaceComparison[] {
  return comparisons.filter(
    (row) => row.verdict === "browser-only" || row.paramsBrowserOnly.length > 0 || row.pathsBrowserOnly.length > 0,
  );
}

/**
 * Raise one gap per disagreeing method, so the finding outlives the run that found it.
 *
 * A `browser-only` method raises the kit's own `browser-surface-unreadable` condition rather than a
 * disagreement: the two surfaces do not contradict each other about it, the API surface simply cannot be
 * asked. Where both surfaces DID answer and answered differently, that is the disagreement.
 *
 * @param comparisons every comparison this run made
 * @param at this run's ISO timestamp
 * @returns one gap per disagreeing method, sorted by id
 */
export function disagreementGaps({
  comparisons,
  at,
}: {
  comparisons: readonly SurfaceComparison[];
  at: string;
}): readonly AtlasGap[] {
  return disagreements({ comparisons })
    .map((row): AtlasGap => {
      if (row.verdict === "browser-only") {
        return openGap({
          at,
          condition: "browser-surface-unreadable",
          fields: [],
          kind: "method",
          reason: `the first-party web client called ${row.method} ${String(row.callCount)} time(s); the installed SDK does not declare it, so no ordinary token can be pointed at it through this repo's client`,
          scope: row.method,
          surfaces: ["browser"],
        });
      }
      const fields = [
        ...row.paramsBrowserOnly.map((name) => `param:${name}`),
        ...row.pathsBrowserOnly.map((path) => `response:${path}`),
      ];
      return openDisagreementGap({
        at,
        fields,
        kind: "method",
        reason: `the web client sent ${String(row.paramsBrowserOnly.length)} parameter(s) and received ${String(row.pathsBrowserOnly.length)} response field(s) that the installed SDK does not declare for ${row.method}`,
        scope: row.method,
        surfaces: ["api", "browser"],
      });
    })
    .toSorted((left, right) => left.id.localeCompare(right.id));
}

/** What one comparison run found, in the numbers a reader wants before any individual row. */
export interface DisagreementSummary {
  readonly methods: number;
  readonly both: number;
  readonly apiOnly: number;
  readonly browserOnly: number;
  readonly withUndocumentedParams: number;
  readonly withUndocumentedResponseFields: number;
}

/**
 * Count what the comparison found.
 *
 * @param comparisons every comparison this run made
 * @returns the summary
 */
export function summariseDisagreements({
  comparisons,
}: {
  comparisons: readonly SurfaceComparison[];
}): DisagreementSummary {
  return {
    apiOnly: comparisons.filter((row) => row.verdict === "api-only").length,
    both: comparisons.filter((row) => row.verdict === "both").length,
    browserOnly: comparisons.filter((row) => row.verdict === "browser-only").length,
    methods: comparisons.length,
    withUndocumentedParams: comparisons.filter((row) => row.paramsBrowserOnly.length > 0).length,
    withUndocumentedResponseFields: comparisons.filter((row) => row.pathsBrowserOnly.length > 0).length,
  };
}
