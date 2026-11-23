/**
 * The entity-shaping primitives every WorkOS projection is built from. Pure — no I/O, no clock of its own.
 *
 * These four live apart from `projection.ts` because they are the mechanism and the projections are the
 * content: filling exactly ONE channel and leaving the other `null` is what makes `merge.ts`'s
 * channel-scoped fold correct, and it is a property of the shape rather than of any one kind. Six
 * projections restating it six times is how that invariant stops being one decision.
 */
import { atlasChannelView, atlasEntityWithChannel, sortedById } from "../kit/channelProjection.js";
import type { AtlasArtifactRef } from "../kit/contract.js";

import { workosDashboardUrl } from "./dashboardPages.js";
import { workosEntityId } from "./identity.js";
import type { WorkosAtlasChannel, WorkosAtlasEntity, WorkosChannelEntity, WorkosDeepLinkStatus } from "./model.js";

/** The all-null channel map every projection starts from, so filling one cannot blank the other. */
const NO_CHANNELS: WorkosAtlasEntity["channels"] = { api: null, browser: null };

/**
 * One channel's view, stamped with this run's instant.
 *
 * A thin narrowing of `kit/channelProjection.ts`'s own constructor: the mechanism — fill one channel, stamp
 * both instants, carry the source — is the kit's and is shared with every other multi-channel atlas. What
 * stays here is only this atlas's channel and deep-link vocabularies.
 *
 * @param at this run's ISO instant, stamped on both the view and its source
 * @param endpoint what was called or opened to produce this view
 * @returns the channel view, ready to hang off an entity
 * @internal
 */
export function channelEntity({
  channel,
  detail,
  at,
  endpoint,
  deepLink,
  deepLinkStatus,
  artifacts,
}: {
  channel: WorkosAtlasChannel;
  detail: unknown;
  at: string;
  endpoint: string;
  deepLink: string | null;
  deepLinkStatus: WorkosDeepLinkStatus;
  artifacts: readonly AtlasArtifactRef[];
}): WorkosChannelEntity {
  return atlasChannelView({ artifacts, at, channel, deepLink, deepLinkStatus, detail, endpoint });
}

/**
 * An entity carrying one API-channel view and nothing on the browser channel.
 *
 * @param providerId WorkOS's own key for this thing, or this repository's own for a route or page
 * @param endpoint what was called to produce it
 * @returns the entity, keyed and stamped
 * @internal
 */
export function apiEntity({
  kind,
  providerId,
  detail,
  at,
  endpoint,
  deepLink,
  deepLinkStatus,
}: {
  kind: WorkosAtlasEntity["kind"];
  providerId: string;
  detail: unknown;
  at: string;
  endpoint: string;
  deepLink: string | null;
  deepLinkStatus: WorkosDeepLinkStatus;
}): WorkosAtlasEntity {
  return atlasEntityWithChannel({
    channel: "api",
    empty: NO_CHANNELS,
    id: workosEntityId({ kind, providerId }),
    kind,
    providerId,
    view: channelEntity({ artifacts: [], at, channel: "api", deepLink, deepLinkStatus, detail, endpoint }),
  });
}

/**
 * The dashboard link a CONTENT entity carries, and the honest status when there is none.
 *
 * A content kind deep-links to the dashboard SURFACE that shows it rather than to a page of its own, so it
 * names a declared path and `workosDashboardUrl` resolves it. A path the table no longer declares — the SSO
 * connection list is the standing case — answers `null`, and the entity says `unavailable` rather than
 * pointing at an address this atlas has stopped expecting to exist.
 *
 * @param path the declared dashboard route this kind is listed on
 * @param environmentId this install's resolved segment, or `null` before one is known
 * @returns the link and its status, spreadable straight into an `apiEntity` call
 * @internal
 */
export function surfaceLink({ path, environmentId }: { path: string; environmentId: string | null }): {
  readonly deepLink: string | null;
  readonly deepLinkStatus: WorkosDeepLinkStatus;
} {
  const url = workosDashboardUrl({ environmentId, path });
  if (url === null) {
    return { deepLink: null, deepLinkStatus: "unavailable" };
  }
  return { deepLink: url, deepLinkStatus: "unverified" };
}

/**
 * Sort by id, so a published file is byte-stable across runs that saw the same things.
 *
 * @returns the same entities, ordered by their own ids
 * @internal
 */
export function byId({ entities }: { entities: readonly WorkosAtlasEntity[] }): readonly WorkosAtlasEntity[] {
  return sortedById({ entities });
}
