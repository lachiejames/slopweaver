/**
 * Where this atlas's surfaces disagree — collected, never resolved.
 *
 * The owner has ruled that what a disagreement MEANS is the owner's call and that the instances come first
 * (`docs/atlas-intent/04-corroboration.md`), so this module's whole job is to make them visible. It performs no network
 * call, reads only the published generation, and picks no winner between two surfaces.
 *
 * Four kinds of disagreement live here, and the first two are the ones this platform produces without any
 * browser at all:
 *
 * - **Inside the compiled surface** — the two protected-resource documents Jam publishes claim different
 *   scope sets for different resources, and all four declared scopes are named by no published operation.
 * - **Between the description and the probe** — a host serving a bearer-protected resource that the
 *   description's own `servers` list omits.
 * - **Between the description and the browser** — endpoints the application calls that the published
 *   description never declares, which is precisely what an API-only atlas would miss.
 * - **Between the published integration pages and the application's own view of them** — nine pages Jam
 *   publishes against whatever the browser channel names, which today is nothing and SAYS so
 *   (`browserSurface.ts`'s `jamIntegrationBrowserLimit`). The comparison is still made rather than skipped,
 *   because a channel that fills later must find the join already here — and deriving one from a route
 *   segment was tried, reported four invented disagreements, and was removed.
 *
 * A comparison that CANNOT be made is reported as such rather than as agreement: with one surface unfilled
 * there is nothing to compare, and saying "no disagreements" there would be the atlas asserting a clean bill
 * of health it has not earned.
 */
import { isRecord } from "../../lib/parsers.js";

import type { JamAtlasEntity, JamAtlasGap, JamIntegrationCompiledDetail, JamOperationBrowserDetail } from "./model.js";

/** One endpoint the application calls that the published description does not declare. *
 * @internal
 */
export interface JamUndeclaredCall {
  readonly method: string;
  readonly origin: string;
  readonly pathShape: string;
}

/** What the two surfaces said differently. */
export interface JamDisagreementReport {
  /** Whether both an operation surface and a walked page surface carry rows at all. */
  readonly bothSurfacesFilled: boolean;
  /** Operations the description declares AND the application was seen to call. */
  readonly corroboratedCount: number;
  /** Operations the published description declares. */
  readonly documentedCount: number;
  /** Integrations Jam publishes a page for that no walked route named. */
  readonly integrationsPublishedOnly: readonly string[];
  /** Integrations a walked route named that Jam publishes no page for. */
  readonly integrationsWalkedOnly: readonly string[];
  /** Calls to the DOCUMENTED origin that the description does not declare. */
  readonly undeclaredApiCalls: readonly JamUndeclaredCall[];
  /** Calls to any other Jam-owned origin — a service the published description says nothing about at all. */
  readonly undocumentedOriginCalls: readonly JamUndeclaredCall[];
  /** Routes the walk could not open. */
  readonly unreachablePages: readonly string[];
  /** Landed routes carrying no picture. */
  readonly unphotographedPages: readonly string[];
  /** How many routes the walk attempted. */
  readonly walkedPageCount: number;
}

/** The origin the published description declares as its only server. */
const PUBLISHED_ORIGIN = "https://api.jam.dev";

/** Read one entity's browser-channel operation detail, or `null` when it carries none. */
function browserCallDetail({ entity }: { entity: JamAtlasEntity }): JamOperationBrowserDetail | null {
  const detail: unknown = entity.channels.browser?.detail;
  if (!isRecord(detail)) {
    return null;
  }
  const method = detail["method"];
  const origin = detail["origin"];
  const pathShape = detail["pathShape"];
  if (typeof method !== "string" || typeof origin !== "string") {
    return null;
  }
  return { method, origin, pathShape: typeof pathShape === "string" ? pathShape : "" };
}

/** Read one entity's compiled-channel integration slug, or `null` when it carries none. */
function compiledIntegrationSlug({ entity }: { entity: JamAtlasEntity }): JamIntegrationCompiledDetail["slug"] | null {
  const detail: unknown = entity.channels.compiled?.detail;
  if (!isRecord(detail)) {
    return null;
  }
  const slug = detail["slug"];
  return typeof slug === "string" ? slug : null;
}

/** Read one entity's browser-channel integration slug, or `null` when it carries none. */
function browserIntegrationSlug({ entity }: { entity: JamAtlasEntity }): string | null {
  const detail: unknown = entity.channels.browser?.detail;
  if (!isRecord(detail)) {
    return null;
  }
  const slug = detail["slug"];
  return typeof slug === "string" ? slug : null;
}

/**
 * Build the report from the stored generation.
 *
 * @param operations every entity the `operation` kind holds
 * @param integrations every entity the `integration` kind holds
 * @param pages every entity the `page` kind holds
 * @param pageGaps the `page` kind's gaps, which is where an unreachable or unphotographed route is recorded
 * @returns what the surfaces said differently, and whether there were two of them to compare
 */
export function jamDisagreementReport({
  operations,
  integrations,
  pages,
  pageGaps,
}: {
  operations: readonly JamAtlasEntity[];
  integrations: readonly JamAtlasEntity[];
  pages: readonly JamAtlasEntity[];
  pageGaps: readonly JamAtlasGap[];
}): JamDisagreementReport {
  const documented = operations.filter((entity) => entity.channels.compiled !== null);
  const corroborated = documented.filter((entity) => entity.channels.browser !== null);
  const browserOnly = operations
    .filter((entity) => entity.channels.compiled === null && entity.channels.browser !== null)
    .map((entity) => browserCallDetail({ entity }))
    .filter((detail): detail is JamOperationBrowserDetail => detail !== null)
    .toSorted((left, right) =>
      `${left.method} ${left.origin}${left.pathShape}`.localeCompare(
        `${right.method} ${right.origin}${right.pathShape}`,
      ),
    );
  const publishedSlugs = new Set(
    integrations.map((entity) => compiledIntegrationSlug({ entity })).filter((slug): slug is string => slug !== null),
  );
  const walkedSlugs = new Set(
    integrations.map((entity) => browserIntegrationSlug({ entity })).filter((slug): slug is string => slug !== null),
  );
  return {
    bothSurfacesFilled: documented.length > 0 && pages.length > 0,
    corroboratedCount: corroborated.length,
    documentedCount: documented.length,
    integrationsPublishedOnly: [...publishedSlugs].filter((slug) => !walkedSlugs.has(slug)).toSorted(),
    integrationsWalkedOnly: [...walkedSlugs].filter((slug) => !publishedSlugs.has(slug)).toSorted(),
    undeclaredApiCalls: browserOnly.filter((call) => call.origin === PUBLISHED_ORIGIN),
    undocumentedOriginCalls: browserOnly.filter((call) => call.origin !== PUBLISHED_ORIGIN),
    unphotographedPages: pageGaps
      .filter((gap) => gap.status === "open" && gap.condition === "web-screenshot-missing")
      .map((gap) => gap.scope)
      .toSorted(),
    unreachablePages: pageGaps
      .filter((gap) => gap.status === "open" && gap.condition === "web-page-unreachable")
      .map((gap) => gap.scope)
      .toSorted(),
    walkedPageCount: pages.length,
  };
}
