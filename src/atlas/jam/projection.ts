/**
 * Turning a compiled table row and a walked page into stored entities.
 *
 * ## The projection is an ALLOWLIST, and every field it keeps is a name
 *
 * Nothing from a fetched document reaches disk except through the fields named here — a method, a path, a
 * parameter name, a response field path, a scope string, an integration slug. A field Jam adds to its
 * description next month is dropped at this boundary rather than stored because nobody thought to exclude
 * it.
 *
 * There is no sensitivity gate on the compiled channel and there does not need to be one: it calls nothing
 * and reads public documents, so "nothing here is a value at all" is a property of the INPUT rather than of
 * a filter. The day the MCP channel lands it will need one, and it will need it for the reason this platform
 * makes sharp — a jam is a recording of somebody's real working session.
 *
 * ## A walked page keeps its links out of the store
 *
 * `PageCapture.links` is the walk's denominator and is used to expand the frontier; it is deliberately not a
 * stored field. What is stored about a page is where it settled, what it was titled, how many calls it made
 * and how much of its own traffic the walk accounted for — plus the screenshot, addressed by digest.
 */
import { jamWebSectionOf } from "./browserPages.js";
import type { JamObservedCall, JamPageObservation } from "./browserWalk.js";
import { jamEntityId } from "./identity.js";
import type {
  JamAtlasEntity,
  JamIntegrationCompiledDetail,
  JamOperationBrowserDetail,
  JamOperationCompiledDetail,
  JamPageDetail,
  JamRouteDetail,
  JamScopeCompiledDetail,
} from "./model.js";
import {
  emptyJamChannels,
  JAM_INTEGRATION_KIND,
  JAM_OPERATION_KIND,
  JAM_PAGE_KIND,
  JAM_ROUTE_KIND,
  JAM_SCOPE_KIND,
} from "./model.js";
import { jamRouteVerdictBecause } from "./routeProbe.js";
import type { JamIntegrationRow, JamOperationRow, JamRouteRow, JamScopeRow } from "./surfaceRow.js";

/**
 * One entity's compiled-channel slot, built once so the four builders below cannot drift apart.
 *
 * Every field but `detail`, `endpoint` and `deepLink` is the same for every compiled entity — this channel
 * reads a committed table rather than a provider, so there is never an artifact backing it. Writing that
 * envelope out at each call site is how builders in one file end up disagreeing about what `deepLinkStatus`
 * an absent link deserves, and `kit/contract.ts` is explicit that an absent link must SAY why it is absent.
 *
 * @param at this run's ISO timestamp
 * @param detail what the compiled channel knows about this entity
 * @param endpoint the reproduction handle a reader follows back to the vendor's own document
 * @param deepLink the exact address a human opens to see it, or `null` when the vendor publishes none
 * @returns the filled channel slot
 */
function compiledChannel({
  at,
  detail,
  endpoint,
  deepLink,
}: {
  at: string;
  detail: unknown;
  endpoint: string;
  deepLink: string | null;
}): NonNullable<JamAtlasEntity["channels"]["compiled"]> {
  return {
    channel: "compiled",
    detail,
    firstSeenAt: at,
    lastSeenAt: at,
    source: {
      artifacts: [],
      channel: "compiled",
      deepLink,
      deepLinkStatus: deepLink === null ? "unavailable" : "provider-provided",
      endpoint,
      observedAt: at,
    },
    state: "observed",
  };
}

/**
 * The provider key one published operation is matched on.
 *
 * @param method the HTTP method, upper-cased
 * @param path the path template
 * @returns the key both channels use
 */
export function jamOperationProviderId({ method, path }: { method: string; path: string }): string {
  return `${method} ${path}`;
}

/**
 * Project one published operation into an entity carrying only the compiled channel.
 *
 * @param row the operation as the pinned description declares it
 * @param at this run's ISO timestamp
 * @returns the entity, with `api` and `browser` left null because neither has looked
 */
export function projectJamOperation({ row, at }: { row: JamOperationRow; at: string }): JamAtlasEntity {
  const providerId = jamOperationProviderId({ method: row.method, path: row.path });
  const detail: JamOperationCompiledDetail = {
    callable: row.callable,
    excludedBecause: row.excludedBecause,
    method: row.method,
    parameters: [...row.parameters],
    path: row.path,
    responseFields: [...row.responseFields],
    scopes: [...row.scopes],
    security: [...row.security],
    serverUrl: row.serverUrl,
    synopsis: row.synopsis,
    tag: row.tag,
  };
  return {
    channels: {
      ...emptyJamChannels(),
      compiled: compiledChannel({
        at,
        deepLink: "https://api.jam.dev/openapi.json",
        detail,
        endpoint: `${row.serverUrl}${row.path}`,
      }),
    },
    id: jamEntityId({ kind: JAM_OPERATION_KIND, providerId }),
    kind: JAM_OPERATION_KIND,
    providerId,
  };
}

/**
 * Project one declared OAuth scope.
 *
 * A scope is an entity rather than a field because all four are named by no operation at all — a flattened
 * scope column on the operation kind could not represent a scope that appears on nothing.
 *
 * @param row the scope, with who names and who claims it
 * @param at this run's ISO timestamp
 * @returns the entity
 */
export function projectJamScope({ row, at }: { row: JamScopeRow; at: string }): JamAtlasEntity {
  const detail: JamScopeCompiledDetail = {
    claimedByResources: [...row.claimedByResources],
    namedBy: [...row.namedBy],
    scope: row.scope,
  };
  return {
    channels: {
      ...emptyJamChannels(),
      compiled: compiledChannel({
        at,
        deepLink: "https://api.jam.dev/.well-known/oauth-authorization-server",
        detail,
        endpoint: "scopes_supported",
      }),
    },
    id: jamEntityId({ kind: JAM_SCOPE_KIND, providerId: row.scope }),
    kind: JAM_SCOPE_KIND,
    providerId: row.scope,
  };
}

/**
 * Project one probed route.
 *
 * The provider key carries the HOST as well as the method and path, because the same path means different
 * things on `api.jam.dev` and `mcp.jam.dev` — `/mcp` is routed-with-no-leaf on one and answers on the other,
 * which is the single sharpest row in this table.
 *
 * @param row what the probe asked and what came back
 * @param at this run's ISO timestamp
 * @returns the entity
 */
export function projectJamRoute({ row, at }: { row: JamRouteRow; at: string }): JamAtlasEntity {
  const providerId = `${row.method} ${row.host}${row.path}`;
  const detail: JamRouteDetail = {
    contentType: row.contentType,
    host: row.host,
    method: row.method,
    path: row.path,
    statusCode: row.statusCode,
    verdict: row.verdict,
    verdictBecause: jamRouteVerdictBecause({ verdict: row.verdict }),
  };
  return {
    channels: {
      ...emptyJamChannels(),
      compiled: compiledChannel({ at, deepLink: null, detail, endpoint: `${row.host}${row.path}` }),
    },
    id: jamEntityId({ kind: JAM_ROUTE_KIND, providerId }),
    kind: JAM_ROUTE_KIND,
    providerId,
  };
}

/**
 * Project one published integration page.
 *
 * @param row the integration as Jam's own sitemap declares it
 * @param at this run's ISO timestamp
 * @returns the entity, with the browser channel left null until a walk sees what the workspace can install
 */
export function projectJamIntegration({ row, at }: { row: JamIntegrationRow; at: string }): JamAtlasEntity {
  const detail: JamIntegrationCompiledDetail = { pageUrl: row.pageUrl, slug: row.slug };
  return {
    channels: {
      ...emptyJamChannels(),
      compiled: compiledChannel({ at, deepLink: row.pageUrl, detail, endpoint: row.pageUrl }),
    },
    id: jamEntityId({ kind: JAM_INTEGRATION_KIND, providerId: row.slug }),
    kind: JAM_INTEGRATION_KIND,
    providerId: row.slug,
  };
}

/**
 * Project one walked page into an entity carrying only the browser channel.
 *
 * A page the walk could not open is still an entity, because the walk ATTEMPTED a route the application's
 * own bundle declares — `unreachableBecause` is what makes that a recorded row rather than a silent absence.
 * The deep link is `browser-discovered`, which is the state only a driven browser can write.
 *
 * The address is the page's own SURFACE name rather than the URL it was asked for: under the application
 * prefix that URL carries this workspace's team identifier, which `kit/pageWalk.ts` deliberately keeps
 * inside the walk. A reader who wants to open it composes it from the root their own browser lands on.
 *
 * @param page what the walk saw at one declared page
 * @param at this run's ISO timestamp
 * @returns the entity, with `api` and `compiled` left null because neither has looked at a page
 */
export function projectJamPage({ page, at }: { page: JamPageObservation; at: string }): JamAtlasEntity {
  const detail: JamPageDetail = {
    callCount: page.calls.length,
    captureComplete: page.captureComplete,
    finalUrl: page.finalUrl,
    redirected: page.redirected,
    responseAccounting: page.responseAccounting,
    screenshotMissingBecause: page.screenshotMissingBecause,
    section: jamWebSectionOf({ surface: page.surface }),
    statusCode: page.statusCode,
    title: page.title,
    unreachableBecause: page.unreachableBecause,
  };
  return {
    channels: {
      ...emptyJamChannels(),
      browser: {
        channel: "browser",
        detail,
        firstSeenAt: at,
        lastSeenAt: at,
        source: {
          artifacts: [...page.artifacts],
          channel: "browser",
          deepLink: null,
          deepLinkStatus: "browser-discovered",
          endpoint: page.surface,
          observedAt: page.observedAt,
        },
        state: "observed",
      },
    },
    id: jamEntityId({ kind: JAM_PAGE_KIND, providerId: page.surface }),
    kind: JAM_PAGE_KIND,
    providerId: page.surface,
  };
}

/** The server URL the published description declares, so an observed call can be matched against it. */
const PUBLISHED_ORIGIN = "https://api.jam.dev";

/**
 * The key a browser-observed call is matched to a published operation on.
 *
 * A call against the DOCUMENTED origin gets the same `<METHOD> <path>` the compiled channel writes, so the
 * two channels land on one entity and the corroboration is a fact about a single row rather than a join
 * somebody has to perform. A call against any other origin carries its origin in the key, because two
 * services can share a path and calling them one endpoint would be the disagreement this atlas exists to
 * report, invented.
 *
 * @param call one first-party call the walk recorded
 * @returns the provider key
 */
export function jamObservedCallProviderId({ call }: { call: JamObservedCall }): string {
  return call.origin === PUBLISHED_ORIGIN
    ? jamOperationProviderId({ method: call.method, path: call.pathShape })
    : `${call.method} ${call.origin}${call.pathShape}`;
}

/**
 * Project one browser-observed call into an operation entity carrying only the browser channel.
 *
 * @param call one first-party call the walk recorded
 * @param at this run's ISO timestamp
 * @returns the entity, with `api` and `compiled` left null — a compiled row for the same key merges onto it
 */
export function projectJamObservedCall({ call, at }: { call: JamObservedCall; at: string }): JamAtlasEntity {
  const detail: JamOperationBrowserDetail = {
    method: call.method,
    origin: call.origin,
    pathShape: call.pathShape,
  };
  const providerId = jamObservedCallProviderId({ call });
  return {
    channels: {
      ...emptyJamChannels(),
      browser: {
        channel: "browser",
        detail,
        firstSeenAt: at,
        lastSeenAt: at,
        source: {
          artifacts: [],
          channel: "browser",
          deepLink: null,
          deepLinkStatus: "browser-discovered",
          endpoint: `${call.origin}${call.pathShape}`,
          observedAt: at,
        },
        state: "observed",
      },
    },
    id: jamEntityId({ kind: JAM_OPERATION_KIND, providerId }),
    kind: JAM_OPERATION_KIND,
    providerId,
  };
}
