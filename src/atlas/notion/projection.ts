/**
 * Turning what each channel saw into `method` and `page` entities.
 *
 * Pure. The two callers — `sync.ts` for the API channel and `browserSurface.ts` for the browser one — each
 * project only their own channel and leave the other slot `null`, which is what makes `merge.ts`'s
 * channel-scoped fold correct: an entity arriving with one channel filled can never blank the other.
 *
 * ## The provider id is `<METHOD> <path shape>`, byte-exact
 *
 * That exactness IS the disagreement detector. A normalising match would fold `api.notion.com/v1/search`
 * and the web client's `/api/v3/search` into one entity and manufacture an agreement that was never
 * observed — hiding precisely the undocumented surface the both-surfaces ruling is about. A path seen on one
 * channel and not the other is therefore a RECORD, never a match failure.
 */

import { absentAs } from "#lib/absent.js";
import { atlasChannelView } from "../kit/channelProjection.js";
import type { AtlasArtifactRef } from "../kit/contract.js";
import { foldObservedOperations } from "../kit/observedOperations.js";
import type { NotionPageObservation } from "./browserWalk.js";
import { notionEntityId } from "./identity.js";
import type {
  NotionAtlasChannel,
  NotionAtlasEntity,
  NotionChannelEntity,
  NotionDeepLinkStatus,
  NotionMethodApiDetail,
  NotionMethodBrowserDetail,
  NotionPageDetail,
  NotionSettingsTabDetail,
} from "./model.js";
import type { NotionSdkEndpoint } from "./sdkEndpoints.js";
import { NOTION_API_BASE_PATH, type NotionSdkSurface } from "./sdkRead.js";
import type { NotionSettingsTabObservation } from "./settingsWalk.js";

/**
 * The provider key for one method entity — what the two channels are matched on.
 *
 * @param httpMethod the verb, upper-cased here so a channel spelling it in lower case still matches
 * @param pathShape the path with every value segment already replaced
 * @returns the key, byte-exact on both channels
 */
export function methodProviderId({ httpMethod, pathShape }: { httpMethod: string; pathShape: string }): string {
  return `${httpMethod.toUpperCase()} ${pathShape}`;
}

/** The `api` channel's provider key for one SDK-declared endpoint. */
function apiProviderId({ endpoint }: { endpoint: NotionSdkEndpoint }): string {
  const path = absentAs({ value: endpoint.pathTemplate, whenAbsent: `${endpoint.module}.${endpoint.name}` });
  return methodProviderId({ httpMethod: endpoint.httpMethod, pathShape: `/${NOTION_API_BASE_PATH}/${path}` });
}

/** One channel's view, stamped with this run's instant. The mechanism is `kit/channelProjection.ts`'s. */
function channelEntity({
  channel,
  detail,
  at,
  endpoint,
  deepLink,
  deepLinkStatus,
  artifacts,
}: {
  channel: NotionAtlasChannel;
  detail: unknown;
  at: string;
  endpoint: string;
  deepLink: string | null;
  deepLinkStatus: NotionDeepLinkStatus;
  artifacts: readonly AtlasArtifactRef[];
}): NotionChannelEntity {
  return atlasChannelView({ artifacts, at, channel, deepLink, deepLinkStatus, detail, endpoint });
}

/**
 * Group the SDK's declarations by the ROUTE each addresses, so several handles for one route fold into one.
 *
 * The SDK's export list is not a list of endpoints: measured on `@notionhq/client` 5.26.0,
 * `agents.updateSession` and `agents.updateSessionStream` declare an identical `post` + `sessions` +
 * body-param set and differ only by `headers: { Accept: "text/event-stream" }`. Projecting them as two
 * entities minted the SAME entity id twice, and `merge.ts` refused the whole publish rather than
 * double-count — correctly, which is how this was found at all rather than shipped as an inflated count.
 * The atlas maps the API surface, so one route is one entity and the other handles are carried on it.
 *
 * Within a group the CANONICAL declaration is the first by `<module>.<name>`, chosen for stability rather
 * than for meaning: an arbitrary-but-fixed rule keeps a published file byte-identical across runs, whereas
 * "whichever the package happens to export first" would move whenever the vendor reordered its file.
 *
 * @param endpoints every declaration the installed client ships
 * @returns one group per route, keyed by provider id, each ordered canonical-first
 */
function endpointsByRoute({
  endpoints,
}: {
  endpoints: readonly NotionSdkEndpoint[];
}): ReadonlyMap<string, readonly NotionSdkEndpoint[]> {
  const grouped = new Map<string, NotionSdkEndpoint[]>();
  for (const endpoint of endpoints) {
    const providerId = apiProviderId({ endpoint });
    const existing = grouped.get(providerId);
    if (existing === undefined) {
      grouped.set(providerId, [endpoint]);
      continue;
    }
    existing.push(endpoint);
  }
  const ordered = new Map<string, readonly NotionSdkEndpoint[]>();
  for (const [providerId, group] of grouped) {
    ordered.set(
      providerId,
      group.toSorted((left, right) => `${left.module}.${left.name}`.localeCompare(`${right.module}.${right.name}`)),
    );
  }
  return ordered;
}

/**
 * Project the installed SDK's declared endpoints into `method` entities on the `api` channel.
 *
 * One entity per ROUTE, not per SDK export — see {@link endpointsByRoute} for the difference and why it is
 * not academic.
 *
 * @param surface what the installed client declares
 * @param at this run's ISO timestamp
 * @returns one entity per declared route, sorted by id so a published file is stable
 */
export function projectNotionApiMethods({
  surface,
  at,
}: {
  surface: NotionSdkSurface;
  at: string;
}): readonly NotionAtlasEntity[] {
  return [...endpointsByRoute({ endpoints: surface.endpoints }).entries()]
    .map(([providerId, group]): NotionAtlasEntity => {
      const endpoint = group[0]!;
      const detail: NotionMethodApiDetail = {
        alsoDeclaredAs: group.slice(1).map((other) => `${other.module}.${other.name}`),
        bodyParams: [...endpoint.bodyParams].toSorted(),
        description: endpoint.description,
        module: endpoint.module,
        name: endpoint.name,
        pathParams: [...endpoint.pathParams].toSorted(),
        queryParams: [...endpoint.queryParams].toSorted(),
      };
      return {
        channels: {
          api: channelEntity({
            artifacts: [],
            at,
            channel: "api",
            // The REST API is not a place a human opens, so there is no deep link at all — and the status
            // has to SAY that, rather than leaving an absent link indistinguishable from an unattempted one.
            deepLink: null,
            deepLinkStatus: "unavailable",
            detail,
            endpoint: providerId,
          }),
          browser: null,
        },
        id: notionEntityId({ kind: "method", providerId }),
        kind: "method",
        providerId,
      };
    })
    .toSorted((left, right) => left.id.localeCompare(right.id));
}

/**
 * Project a walk's observed operations into `method` entities on the `browser` channel.
 *
 * The fold — one accumulator per operation, with the field set WIDENED across every page that made the
 * call rather than letting the last one win — is `kit/observedOperations.ts`'s.
 *
 * @param pages every declared page's observation
 * @param at this run's ISO timestamp
 * @returns one entity per distinct operation, sorted by id so a published file is stable
 */
export function projectNotionBrowserMethods({
  pages,
  at,
}: {
  pages: readonly NotionPageObservation[];
  at: string;
}): readonly NotionAtlasEntity[] {
  const folded = foldObservedOperations({
    fieldsOf: ({ call }) => call.responseFields,
    keyOf: ({ call }) => methodProviderId({ httpMethod: call.method, pathShape: call.pathShape }),
    pages,
  });
  return [...folded.entries()]
    .map(([providerId, observed]): NotionAtlasEntity => {
      const detail: NotionMethodBrowserDetail = {
        callCount: observed.callCount,
        responseFields: [...observed.responseFields],
        seenOnPages: [...observed.seenOn],
        statusCode: observed.call.statusCode,
      };
      return {
        channels: {
          api: null,
          browser: channelEntity({
            artifacts: [],
            at,
            channel: "browser",
            deepLink: observed.deepLink.length > 0 ? observed.deepLink : null,
            deepLinkStatus: "browser-discovered",
            detail,
            endpoint: providerId,
          }),
        },
        id: notionEntityId({ kind: "method", providerId }),
        kind: "method",
        providerId,
      };
    })
    .toSorted((left, right) => left.id.localeCompare(right.id));
}

/**
 * Project a walk's page observations into `page` entities on the `browser` channel.
 *
 * @param pages every declared page's observation
 * @param at this run's ISO timestamp
 * @returns one entity per declared page, sorted by id so a published file is stable
 */
export function projectNotionPages({
  pages,
  at,
}: {
  pages: readonly NotionPageObservation[];
  at: string;
}): readonly NotionAtlasEntity[] {
  return pages
    .map((page): NotionAtlasEntity => {
      const detail: NotionPageDetail = {
        callCount: page.calls.length,
        captureComplete: page.captureComplete,
        finalUrl: page.finalUrl,
        redirected: page.redirected,
        responseAccounting: page.responseAccounting,
        statusCode: page.statusCode,
        title: page.title,
        unreachableBecause: page.unreachableBecause,
      };
      return {
        channels: {
          api: null,
          browser: channelEntity({
            artifacts: page.artifacts,
            at,
            channel: "browser",
            deepLink: page.requestedUrl.length > 0 ? page.requestedUrl : null,
            deepLinkStatus: "browser-discovered",
            detail,
            // A page that could not be addressed at all still owes a reproduction handle, and its own
            // declared surface name is the only one it has.
            endpoint: page.requestedUrl.length > 0 ? page.requestedUrl : page.surface,
          }),
        },
        id: notionEntityId({ kind: "page", providerId: page.surface }),
        kind: "page",
        providerId: page.surface,
      };
    })
    .toSorted((left, right) => left.id.localeCompare(right.id));
}

/**
 * Project a settings walk's tab observations into `page` entities on the `browser` channel.
 *
 * A tab has no address, so its deep link is `null` and its status says so (`unavailable`) rather than
 * leaving the absence unexplained; its reproduction handle is its own surface name, which
 * `slopweaver atlas notion settings --tab <id>` opens.
 *
 * @param tabs every declared tab's observation
 * @param at this run's ISO timestamp
 * @returns one entity per declared tab, sorted by id so a published file is stable
 */
export function projectNotionSettingsTabs({
  tabs,
  at,
}: {
  tabs: readonly NotionSettingsTabObservation[];
  at: string;
}): readonly NotionAtlasEntity[] {
  return tabs
    .map((tab): NotionAtlasEntity => {
      const detail: NotionSettingsTabDetail = {
        dialogOpen: tab.dialogOpen,
        group: tab.group,
        names: [...tab.names],
        notRenderedBecause: tab.notRenderedBecause,
        screenshotMissingBecause: tab.screenshotMissingBecause,
        selectionVerified: tab.selectionVerified,
        tabId: tab.tabId,
        tabMatches: tab.tabMatches,
      };
      return {
        channels: {
          api: null,
          browser: channelEntity({
            artifacts: tab.artifacts,
            at,
            channel: "browser",
            deepLink: null,
            deepLinkStatus: "unavailable",
            detail,
            endpoint: tab.surface,
          }),
        },
        id: notionEntityId({ kind: "page", providerId: tab.surface }),
        kind: "page",
        providerId: tab.surface,
      };
    })
    .toSorted((left, right) => left.id.localeCompare(right.id));
}
