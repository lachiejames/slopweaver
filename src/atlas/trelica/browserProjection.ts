/**
 * What a walk saw, as the `method` and `page` entities on the `browser` channel.
 *
 * Pure. Each projection fills only the `browser` slot, through `projection.ts`'s shared entity helpers, so
 * `merge.ts`'s channel-scoped fold can never blank another channel with one of these. `browserSurface.ts` is
 * the caller.
 */
import { foldObservedOperations } from "../kit/observedOperations.js";

import type { TrelicaPageObservation } from "./browserWalk.js";
import type { TrelicaAtlasEntity, TrelicaMethodBrowserDetail, TrelicaPageDetail } from "./model.js";
import { byId, channelEntity, entityWithChannel, trelicaMethodProviderId } from "./projection.js";

/**
 * Project a walk's observed operations into `method` entities on the `browser` channel.
 *
 * The fold — one accumulator per operation, with the field set WIDENED across every page that made the
 * call rather than letting the last one win — is `kit/observedOperations.ts`'s.
 *
 * @param pages every declared page's observation
 * @param at this run's ISO timestamp
 * @returns one entity per distinct operation, sorted by id
 */
export function projectTrelicaBrowserMethods({
  pages,
  at,
}: {
  pages: readonly TrelicaPageObservation[];
  at: string;
}): readonly TrelicaAtlasEntity[] {
  const folded = foldObservedOperations({
    fieldsOf: ({ call }) => call.responseFields,
    keyOf: ({ call }) => trelicaMethodProviderId({ httpMethod: call.method, pathShape: call.pathShape }),
    pages,
  });
  const entities = [...folded.entries()].map(([providerId, observed]): TrelicaAtlasEntity => {
    const detail: TrelicaMethodBrowserDetail = {
      callCount: observed.callCount,
      responseFields: [...observed.responseFields],
      seenOnPages: [...observed.seenOn],
      statusCode: observed.call.statusCode,
    };
    return entityWithChannel({
      channel: "browser",
      kind: "method",
      providerId,
      view: channelEntity({
        artifacts: [],
        at,
        channel: "browser",
        deepLink: observed.deepLink.length > 0 ? observed.deepLink : null,
        deepLinkStatus: "browser-discovered",
        detail,
        endpoint: providerId,
      }),
    });
  });
  return byId({ entities });
}

/**
 * Project a walk's page observations into `page` entities on the `browser` channel.
 *
 * @param pages every declared page's observation
 * @param at this run's ISO timestamp
 * @returns one entity per declared page, sorted by id
 */
export function projectTrelicaPages({
  pages,
  at,
}: {
  pages: readonly TrelicaPageObservation[];
  at: string;
}): readonly TrelicaAtlasEntity[] {
  const entities = pages.map((page): TrelicaAtlasEntity => {
    const detail: TrelicaPageDetail = {
      callCount: page.calls.length,
      captureComplete: page.captureComplete,
      finalUrl: page.finalUrl,
      redirected: page.redirected,
      responseAccounting: page.responseAccounting,
      statusCode: page.statusCode,
      title: page.title,
      unreachableBecause: page.unreachableBecause,
    };
    return entityWithChannel({
      channel: "browser",
      kind: "page",
      providerId: page.surface,
      view: channelEntity({
        artifacts: page.artifacts,
        at,
        channel: "browser",
        deepLink: page.requestedUrl.length > 0 ? page.requestedUrl : null,
        deepLinkStatus: "browser-discovered",
        detail,
        // A page that could not be addressed at all still owes a reproduction handle, and its own declared
        // surface name is the only one it has.
        endpoint: page.requestedUrl.length > 0 ? page.requestedUrl : page.surface,
      }),
    });
  });
  return byId({ entities });
}
