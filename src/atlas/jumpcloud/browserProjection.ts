/**
 * What a console walk saw, as the `page` and `method` entities the console generation stores.
 *
 * Pure: `browserSurface.ts` merges these onto what the store holds and publishes. A page's settled address is
 * stored REDACTED (`redactedConsoleAddress`), and an operation carries field NAMES only, with the count the
 * denial boundary withheld beside them.
 */
import { atlasChannelView, atlasEntityWithChannel, sortedById } from "../kit/channelProjection.js";
import { stableEntityId } from "../kit/identity.js";
import { foldObservedOperations } from "../kit/observedOperations.js";

import { type JumpcloudObservedCall, jumpcloudCallKey } from "./browserReduction.js";
import { type JumpcloudPageObservation, redactedConsoleAddress } from "./browserWalk.js";
import type {
  JumpcloudConsoleEntity,
  JumpcloudConsoleKind,
  JumpcloudConsoleMethodDetail,
  JumpcloudConsolePageDetail,
} from "./consoleModel.js";

/**
 * The surface name a console walk's coverage and gaps are reported under — the descriptor's own.
 *
 * @internal
 */
export const JUMPCLOUD_CONSOLE_SURFACE = "admin-console";

/**
 * The channel every console entity's view sits in.
 *
 * @internal
 */
export const JUMPCLOUD_CONSOLE_CHANNEL = "admin-console";

/** Every slot empty — a projection fills exactly one. */
const EMPTY_CHANNELS = { "admin-console": null, "directory-api": null } as const;

/**
 * The stable identity of one console entity.
 *
 * Namespaced `jumpcloud:console:<kind>` rather than the API generation's `jumpcloud:<kind>`, so a console
 * page and an API kind of the same name can never share an id.
 *
 * @param kind the console kind
 * @param providerId the entity's own key — a page's surface name, an operation's `<METHOD> <host><path>`
 * @returns the id
 * @internal
 */
export function jumpcloudConsoleEntityId({
  kind,
  providerId,
}: {
  kind: JumpcloudConsoleKind;
  providerId: string;
}): string {
  return stableEntityId({ components: { providerId }, namespace: `jumpcloud:console:${kind}` });
}

/** A page's detail, as stored. */
function pageDetail({ page }: { page: JumpcloudPageObservation }): JumpcloudConsolePageDetail {
  return {
    callCount: page.calls.length,
    captureComplete: page.captureComplete,
    finalUrl: redactedConsoleAddress({ finalUrl: page.finalUrl }),
    redirected: page.redirected,
    responseAccounting: page.responseAccounting,
    screenshotMissingBecause: page.screenshotMissingBecause,
    statusCode: page.statusCode,
    title: page.title,
    unreachableBecause: page.unreachableBecause,
  };
}

/**
 * Project a walk's page observations into `page` entities on the `admin-console` channel.
 *
 * @param pages every declared page's observation
 * @param at this run's ISO timestamp
 * @returns one entity per declared page, sorted by id so a published file is stable
 */
export function projectJumpcloudConsolePages({
  pages,
  at,
}: {
  pages: readonly JumpcloudPageObservation[];
  at: string;
}): readonly JumpcloudConsoleEntity[] {
  const entities = pages.map((page): JumpcloudConsoleEntity =>
    atlasEntityWithChannel({
      channel: JUMPCLOUD_CONSOLE_CHANNEL,
      empty: EMPTY_CHANNELS,
      id: jumpcloudConsoleEntityId({ kind: "page", providerId: page.surface }),
      kind: "page",
      providerId: page.surface,
      view: atlasChannelView({
        artifacts: page.artifacts,
        at,
        channel: JUMPCLOUD_CONSOLE_CHANNEL,
        deepLink: page.requestedUrl.length > 0 ? page.requestedUrl : null,
        deepLinkStatus: page.requestedUrl.length > 0 ? "browser-discovered" : "unavailable",
        detail: pageDetail({ page }),
        endpoint: page.requestedUrl.length > 0 ? page.requestedUrl : page.surface,
      }),
    }),
  );
  return sortedById({ entities });
}

/**
 * Project a walk's observed calls into `method` entities on the `admin-console` channel.
 *
 * @param pages every declared page's observation
 * @param at this run's ISO timestamp
 * @returns one entity per distinct operation, sorted by id so a published file is stable
 */
export function projectJumpcloudConsoleMethods({
  pages,
  at,
}: {
  pages: readonly JumpcloudPageObservation[];
  at: string;
}): readonly JumpcloudConsoleEntity[] {
  const denied = new Map<string, number>();
  for (const page of pages) {
    for (const call of page.calls) {
      const key = jumpcloudCallKey({ call });
      const held = denied.get(key);
      denied.set(key, held === undefined ? call.deniedFieldCount : held + call.deniedFieldCount);
    }
  }
  const folded = foldObservedOperations<JumpcloudObservedCall>({
    fieldsOf: ({ call }) => call.responseFields,
    keyOf: ({ call }) => jumpcloudCallKey({ call }),
    pages,
  });
  const entities = [...folded.entries()].map(([providerId, seen]): JumpcloudConsoleEntity => {
    const detail: JumpcloudConsoleMethodDetail = {
      callCount: seen.callCount,
      deniedFieldCount: denied.get(providerId)!,
      responseFields: [...seen.responseFields],
      seenOnPages: [...seen.seenOn],
      statusCode: seen.call.statusCode,
    };
    return atlasEntityWithChannel({
      channel: JUMPCLOUD_CONSOLE_CHANNEL,
      empty: EMPTY_CHANNELS,
      id: jumpcloudConsoleEntityId({ kind: "method", providerId }),
      kind: "method",
      providerId,
      view: atlasChannelView({
        artifacts: [],
        at,
        channel: JUMPCLOUD_CONSOLE_CHANNEL,
        deepLink: seen.deepLink.length > 0 ? seen.deepLink : null,
        deepLinkStatus: seen.deepLink.length > 0 ? "browser-discovered" : "unavailable",
        detail,
        endpoint: providerId,
      }),
    });
  });
  return sortedById({ entities });
}
