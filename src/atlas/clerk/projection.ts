/**
 * Turning what a channel saw into a stored entity — the one boundary anything crosses to reach disk.
 *
 * ## The projection is an ALLOWLIST, and every field it keeps is a name
 *
 * Nothing reaches disk except through the fields named here — an HTTP method, a wire path with its
 * parameters as placeholders, parameter names, response FIELD names, Clerk's own operation id, tags,
 * security scheme names and the disposition this repository decided. A field Clerk adds to a document next
 * month is dropped at this boundary rather than stored because nobody thought to exclude it.
 *
 * On the browser side the same rule does more work: a captured response body has already been reduced to
 * field-name paths by `browserReduction.ts`, and this module never sees a value at all. That ordering is
 * deliberate — the reduction is the redaction, so a projection bug cannot leak what the reduction already
 * threw away.
 *
 * ## The deep link is per PAGE, and an operation borrows one only when a page claims it
 *
 * Clerk publishes no dashboard address for an endpoint, so a per-operation link would have to be
 * constructed — inventing a link rather than knowing one. Instead each declared page names the wire-path
 * PREFIX it is the face of (`browserPages.ts`'s `showsPathPrefix`), and an operation takes the link of the
 * page with the longest matching prefix. An operation no page claims gets a null link with
 * `deepLinkStatus: "unavailable"`, which is the kit contract's whole point: "the provider offers none" and
 * "nobody has looked" must not read the same.
 *
 * A page's own link is `browser-discovered` rather than `provider-provided`, because it is where a driven
 * browser actually settled — and that is the distinction the kit's contract exists to make measurable.
 */
import type { AtlasArtifactRef } from "../kit/contract.js";
import type { ObservedOperation } from "../kit/observedOperations.js";
import type { PageObservation } from "../kit/pageWalk.js";

import { CLERK_BROWSER_PAGES } from "./browserPages.js";
import type { ClerkObservedCall } from "./browserReduction.js";
import { CLERK_DASHBOARD_ORIGIN, type ClerkBrowserPage } from "./dashboardAddress.js";
import { clerkEntityId } from "./identity.js";
import {
  CLERK_OPERATION_KIND,
  CLERK_PAGE_KIND,
  CLERK_WEBHOOK_EVENT_KIND,
  type ClerkAtlasEntity,
  type ClerkOperationBrowserDetail,
  type ClerkOperationCompiledDetail,
  type ClerkPageDetail,
  type ClerkWebhookEventDetail,
} from "./model.js";
import type { ClerkOperationRow, ClerkWebhookEventRow } from "./specRead.js";
import { clerkProviderId } from "./surfaceNaming.js";

/**
 * The dashboard page that is the human face of one wire path, by longest declared prefix.
 *
 * Longest rather than first, because `/v1/billing` and `/v1/billing/plans` are both declared and the more
 * specific page is the one a reader wants. A prefix nobody declared answers `null`, which becomes an
 * `unavailable` deep link rather than a guess.
 *
 * @param wirePath the operation's own wire path
 * @returns the page, or `null` when no declared page claims this prefix
 *
 * @internal
 */
export function clerkPageForWirePath({ wirePath }: { wirePath: string }): ClerkBrowserPage | null {
  let best: ClerkBrowserPage | null = null;
  // The length of `best`'s own prefix, held beside it so it is never re-read off a page that may declare none.
  // Below every real length, so the first claiming page wins even with an empty prefix.
  let bestLength = -1;
  for (const page of CLERK_BROWSER_PAGES) {
    const prefix = page.showsPathPrefix;
    if (prefix === null || !wirePath.startsWith(prefix)) {
      continue;
    }
    if (prefix.length > bestLength) {
      best = page;
      bestLength = prefix.length;
    }
  }
  return best;
}

/**
 * Project one compiled operation row into an entity carrying only the `compiled` channel.
 *
 * The endpoint recorded is the wire path rather than a full URL, deliberately: the Frontend API's host is
 * per application, so a URL here would either be a template nobody can open or one organisation's own host.
 *
 * @param row the operation as a pinned document declares it
 * @param at this run's ISO timestamp
 * @returns the entity, with `api` and `browser` left null because neither has looked
 */
export function projectClerkCompiledOperation({ row, at }: { row: ClerkOperationRow; at: string }): ClerkAtlasEntity {
  const detail: ClerkOperationCompiledDetail = {
    api: row.api,
    disposition: row.disposition,
    dispositionReason: row.dispositionReason,
    document: row.document,
    method: row.method,
    operationId: row.operationId,
    pagination: row.pagination,
    pathParams: [...row.pathParams],
    queryParams: [...row.queryParams],
    responseFields: [...row.responseFields],
    responseSchema: row.responseSchema,
    security: [...row.security],
    summary: row.summary,
    tags: [...row.tags],
    wirePath: row.wirePath,
  };
  return {
    channels: {
      api: null,
      browser: null,
      compiled: {
        channel: "compiled",
        detail,
        firstSeenAt: at,
        lastSeenAt: at,
        source: {
          artifacts: [],
          channel: "compiled",
          deepLink: null,
          // A dashboard page that SHOWS this family is not a link to the operation, and saying otherwise
          // would put a constructed address in a field whose whole job is to be checkable. The page is
          // recorded on the page kind, where a human can actually open it.
          deepLinkStatus: "unavailable",
          endpoint: `${row.method} ${row.api}:${row.wirePath}`,
          observedAt: at,
        },
        state: "observed",
      },
    },
    id: clerkEntityId({ kind: CLERK_OPERATION_KIND, providerId: row.providerId }),
    kind: CLERK_OPERATION_KIND,
    providerId: row.providerId,
  };
}

/**
 * Project every compiled operation row.
 *
 * @param rows the operations the pinned documents declare
 * @param at this run's ISO timestamp
 * @returns the entities, in the order the rows arrived
 */
export function projectClerkCompiledOperations({
  rows,
  at,
}: {
  rows: readonly ClerkOperationRow[];
  at: string;
}): readonly ClerkAtlasEntity[] {
  return rows.map((row) => projectClerkCompiledOperation({ at, row }));
}

/**
 * Project one webhook-event row into an entity carrying only the `compiled` channel.
 *
 * @param row the event as the pinned webhooks document declares it
 * @param at this run's ISO timestamp
 * @returns the entity
 */
export function projectClerkWebhookEvent({ row, at }: { row: ClerkWebhookEventRow; at: string }): ClerkAtlasEntity {
  const detail: ClerkWebhookEventDetail = {
    description: row.description,
    event: row.event,
    payloadFields: [...row.payloadFields],
    payloadSchema: row.payloadSchema,
  };
  return {
    channels: {
      api: null,
      browser: null,
      compiled: {
        channel: "compiled",
        detail,
        firstSeenAt: at,
        lastSeenAt: at,
        source: {
          artifacts: [],
          channel: "compiled",
          deepLink: null,
          deepLinkStatus: "unavailable",
          endpoint: `webhook ${row.event}`,
          observedAt: at,
        },
        state: "observed",
      },
    },
    id: clerkEntityId({ kind: CLERK_WEBHOOK_EVENT_KIND, providerId: row.event }),
    kind: CLERK_WEBHOOK_EVENT_KIND,
    providerId: row.event,
  };
}

/**
 * Project every webhook-event row.
 *
 * @param rows the events the pinned webhooks document declares
 * @param at this run's ISO timestamp
 * @returns the entities, in the order the rows arrived
 */
export function projectClerkWebhookEvents({
  rows,
  at,
}: {
  rows: readonly ClerkWebhookEventRow[];
  at: string;
}): readonly ClerkAtlasEntity[] {
  return rows.map((row) => projectClerkWebhookEvent({ at, row }));
}

/**
 * Project one operation the walk observed into an entity carrying only the `browser` channel.
 *
 * The deep link is the declared page's own address rather than the URL the call went to: a request URL
 * carries the application and instance identifiers, and the page address is what a human opens to see the
 * same thing.
 *
 * @param observed one operation, folded across every page that called it
 * @param at this run's ISO timestamp
 * @returns the entity, with `compiled` and `api` left null so a merge fills them from what is stored
 */
export function projectClerkObservedOperation({
  observed,
  at,
}: {
  observed: ObservedOperation<ClerkObservedCall>;
  at: string;
}): ClerkAtlasEntity {
  const call = observed.call;
  const detail: ClerkOperationBrowserDetail = {
    api: call.api,
    callCount: observed.callCount,
    host: call.host,
    method: call.method,
    responseFields: [...observed.responseFields],
    seenOn: [...observed.seenOn],
    statusCode: call.statusCode,
    wirePath: call.wirePath,
  };
  const providerId = clerkProviderId({ api: call.api, method: call.method, wirePath: call.wirePath });
  const page = clerkPageForWirePath({ wirePath: call.wirePath });
  const deepLink = page?.root === "account" ? `${CLERK_DASHBOARD_ORIGIN}/${page.path}` : null;
  return {
    channels: {
      api: null,
      browser: {
        channel: "browser",
        detail,
        firstSeenAt: at,
        lastSeenAt: at,
        source: {
          artifacts: [],
          channel: "browser",
          deepLink,
          deepLinkStatus: deepLink === null ? "unavailable" : "browser-discovered",
          endpoint: `${call.method} ${call.host}${call.wirePath}`,
          observedAt: at,
        },
        state: "observed",
      },
      compiled: null,
    },
    id: clerkEntityId({ kind: CLERK_OPERATION_KIND, providerId }),
    kind: CLERK_OPERATION_KIND,
    providerId,
  };
}

/**
 * Project every operation the walk observed.
 *
 * @param operations one entry per distinct operation, folded across pages
 * @param at this run's ISO timestamp
 * @returns the entities, sorted by provider id so a published file is stable
 */
export function projectClerkObservedOperations({
  operations,
  at,
}: {
  operations: readonly ObservedOperation<ClerkObservedCall>[];
  at: string;
}): readonly ClerkAtlasEntity[] {
  return operations
    .map((observed) => projectClerkObservedOperation({ at, observed }))
    .toSorted((left, right) => left.providerId.localeCompare(right.providerId));
}

/**
 * Project one walked page into an entity carrying only the `browser` channel.
 *
 * A page the walk never reached is still projected, carrying `unreachableBecause`: the whole reason the
 * denominator is declared is that a page nobody could open is a fact the atlas can NAME.
 *
 * The `deepLink` is deliberately null for an instance page and the ENDPOINT carries the declared path
 * rather than the settled URL, for the reason `browserPages.ts` gives: a settled dashboard URL carries the
 * application and instance identifiers, which may not be stored.
 *
 * @param page the declared page
 * @param observation what the walk saw it be
 * @param at this run's ISO timestamp
 * @returns the entity
 */
export function projectClerkPage({
  page,
  observation,
  at,
}: {
  page: ClerkBrowserPage;
  observation: PageObservation<ClerkObservedCall>;
  at: string;
}): ClerkAtlasEntity {
  const detail: ClerkPageDetail = {
    callCount: observation.calls.length,
    captureComplete: observation.captureComplete,
    finalUrl: observation.finalUrl,
    redirected: observation.redirected,
    responseAccounting: { ...observation.responseAccounting },
    statusCode: observation.statusCode,
    title: observation.title,
    unreachableBecause: observation.unreachableBecause,
  };
  const deepLink = page.root === "account" ? `${CLERK_DASHBOARD_ORIGIN}/${page.path}` : null;
  const artifacts: readonly AtlasArtifactRef[] = observation.artifacts;
  return {
    channels: {
      api: null,
      browser: {
        channel: "browser",
        detail,
        firstSeenAt: at,
        lastSeenAt: at,
        source: {
          artifacts: [...artifacts],
          channel: "browser",
          deepLink,
          // An instance page's own address is not storable, so it is `unverified` rather than
          // `browser-discovered`: the walk DID discover it, and this atlas may not write it down.
          deepLinkStatus: deepLink === null ? "unverified" : "browser-discovered",
          endpoint: page.root === "account" ? `/${page.path}` : `<instance>/${page.path}`,
          observedAt: observation.observedAt === "" ? at : observation.observedAt,
        },
        state: "observed",
      },
      compiled: null,
    },
    id: clerkEntityId({ kind: CLERK_PAGE_KIND, providerId: page.surface }),
    kind: CLERK_PAGE_KIND,
    providerId: page.surface,
  };
}

/**
 * Project every declared page the walk visited.
 *
 * @param observations every declared page's observation, in declaration order
 * @param at this run's ISO timestamp
 * @returns the entities, in declaration order
 */
export function projectClerkPages({
  observations,
  at,
}: {
  observations: readonly PageObservation<ClerkObservedCall>[];
  at: string;
}): readonly ClerkAtlasEntity[] {
  return observations.flatMap((observation): readonly ClerkAtlasEntity[] => {
    const page = CLERK_BROWSER_PAGES.find((declared) => declared.surface === observation.surface);
    if (page === undefined) {
      return [];
    }
    return [projectClerkPage({ at, observation, page })];
  });
}
