/**
 * Turning the two compiled inventories into atlas entities.
 *
 * Both projections here are OFFLINE. The API surface comes from the operation registry generated from
 * Figma's own pinned OpenAPI document, and the browser surface comes from the route inventory measured
 * without an account — so `slopweaver atlas figma sync` publishes a complete surface map with no network
 * call and no credential, exactly as `atlas airtable sync` does.
 *
 * What is NOT here is the entity projection — a file, a component, a variable, a team. Those need a token
 * this installation does not hold, and inventing a shape for them before one exists would be a contract
 * nothing has ever satisfied. `descriptor.ts` says so, and each of those kinds publishes a `not-configured`
 * coverage cell naming what would fill it.
 */
import { FIGMA_BROWSER_PAGES, type FigmaBrowserPage } from "./browserPages.js";
import { FIGMA_SPEC_PIN } from "./generated/specLock.js";
import { FIGMA_SURFACES } from "./generated/surfaces.js";
import { figmaEntityId } from "./identity.js";
import type { FigmaAtlasKind } from "./kinds.js";
import type { FigmaAtlasEntity, FigmaMethodApiDetail } from "./model.js";
import type { FigmaSurfaceRow } from "./surfaceRow.js";

/**
 * The surface name the API channel's coverage and provenance are recorded under.
 * @internal
 */
export const FIGMA_SPEC_SURFACE = "spec-declared";

/**
 * The surface name the browser channel's route inventory is recorded under.
 * @internal
 */
export const FIGMA_ROUTE_SURFACE = "browser-routes";

/** The origin every declared browser route hangs off. */
const FIGMA_WEB_ORIGIN = "https://www.figma.com";

/** The provider key a method entity is matched on across channels: the request line, byte-exactly. */
function methodProviderId({ row }: { row: FigmaSurfaceRow }): string {
  return `${row.method} ${row.path}`;
}

/** What the pinned document states about one operation, reduced to names and this atlas's decision. */
function methodDetail({ row }: { row: FigmaSurfaceRow }): FigmaMethodApiDetail {
  return {
    authMethods: [...row.authMethods],
    deprecated: row.deprecated,
    disposition: row.disposition,
    dispositionBecause: row.dispositionBecause,
    exclusionReason: row.exclusionReason,
    method: row.method,
    paging: row.paging,
    path: row.path,
    scopes: [...row.scopes],
    summary: row.summary,
    tag: row.tag,
  };
}

/**
 * Every operation in the generated registry, as a `method` entity carrying only its `api` channel.
 *
 * The deep link is the operation's own reference page, and its status is `provider-provided` rather than
 * `unverified`: Figma's REST reference renders one page per operation under a slug that IS the
 * `operationId`, which is the same string the document declares. The link is therefore derived from the
 * provider's own key rather than guessed at.
 *
 * @param at this run's ISO timestamp
 * @returns one entity per operation, in the registry's own order
 */
export function projectFigmaMethods({ at }: { at: string }): readonly FigmaAtlasEntity[] {
  return FIGMA_SURFACES.map((row): FigmaAtlasEntity => {
    const providerId = methodProviderId({ row });
    return {
      channels: {
        api: {
          channel: "api",
          detail: methodDetail({ row }),
          firstSeenAt: at,
          lastSeenAt: at,
          source: {
            artifacts: [],
            channel: "api",
            deepLink: `https://developers.figma.com/docs/rest-api/#${row.name}`,
            deepLinkStatus: "provider-provided",
            endpoint: `${FIGMA_SPEC_PIN.packageName}@${FIGMA_SPEC_PIN.packageVersion}:${FIGMA_SPEC_PIN.specPath}`,
            observedAt: at,
          },
          state: "observed",
        },
        browser: null,
      },
      id: figmaEntityId({ kind: "method", providerId }),
      kind: "method",
      providerId,
      scope: null,
    };
  });
}

/** What the signed-out probe established about one route, as a stored detail. */
function pageDetail({ page }: { page: FigmaBrowserPage }): Record<string, unknown> {
  return {
    evidence: page.evidence,
    holds: page.holds,
    screenshotWanted: page.screenshot,
  };
}

/**
 * Every declared route, as a `page` entity carrying only its `browser` channel.
 *
 * The detail is what a SIGNED-OUT probe established, and nothing more. That is a deliberate floor rather
 * than a placeholder: `docs/atlas-intent/06-holdings.md` says every page's EXISTENCE is recorded even where a
 * screenshot is not, and twenty-three of these routes have their existence CONFIRMED without a Figma
 * account existing. A walk that later signs in replaces this detail with a real observation and a
 * screenshot; until then the atlas says exactly what it knows, including for the two routes it established
 * are NOT there.
 *
 * The deep link is the route on Figma's own origin with its parameters still braced, and its status is
 * `unverified` — nothing has opened it. Recording it as `browser-discovered` would claim a walk that has
 * not happened, which is the specific dishonesty `kit/contract.ts` built the field to prevent.
 *
 * @param at this run's ISO timestamp
 * @returns one entity per declared route
 */
export function projectFigmaRoutes({ at }: { at: string }): readonly FigmaAtlasEntity[] {
  return FIGMA_BROWSER_PAGES.map((page): FigmaAtlasEntity => {
    return {
      channels: {
        api: null,
        browser: {
          channel: "browser",
          detail: pageDetail({ page }),
          firstSeenAt: at,
          lastSeenAt: at,
          source: {
            artifacts: [],
            channel: "browser",
            deepLink: null,
            deepLinkStatus: page.evidence === "absent-404" ? "unavailable" : "unverified",
            endpoint: `${FIGMA_WEB_ORIGIN}${page.route}`,
            observedAt: at,
          },
          state: "observed",
        },
      },
      id: figmaEntityId({ kind: "page", providerId: page.route }),
      kind: "page",
      providerId: page.route,
      scope: null,
    };
  });
}

/**
 * The kinds this build can currently fill, so a sync can report every OTHER kind as not-configured rather
 * than leaving a reader to infer it from an empty file.
 *
 * @returns the two surface-map kinds
 */
export function figmaFillableKinds(): readonly FigmaAtlasKind[] {
  return ["method", "page"];
}
