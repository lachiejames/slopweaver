/**
 * Entity fixtures for the Notion atlas's pure tests.
 *
 * Every value here is synthetic. A real Notion workspace name, page title or URL may not enter a fixture —
 * `browserPages.ts` states the rule, and the hygiene gate flags a break of it only where a committed rule
 * matches the name — so `acme` and a made-up id stand in.
 */
import type { NotionAtlasChannel, NotionAtlasEntity, NotionChannelEntity } from "../../../../atlas/notion/model.js";

/**
 * One channel's view, with every field set so a test states only what it is about.
 *
 * @param name which channel this view belongs to
 * @param over the fields this test is about
 * @returns the channel entity
 */
export function channel({
  name,
  over = {},
}: {
  name: NotionAtlasChannel;
  over?: Partial<NotionChannelEntity>;
}): NotionChannelEntity {
  return {
    channel: name,
    detail: { seen: true },
    firstSeenAt: "2026-09-01T00:00:00.000Z",
    lastSeenAt: "2026-09-01T00:00:00.000Z",
    source: {
      artifacts: [],
      channel: name,
      deepLink: null,
      deepLinkStatus: "unavailable",
      endpoint: "GET /v1/users",
      observedAt: "2026-09-01T00:00:00.000Z",
    },
    state: "observed",
    ...over,
  };
}

/**
 * One entity, with only the channels a test names filled.
 *
 * @param providerId the provider's own key, which is also the default id
 * @param api the API channel's view, or `null` when that channel has not looked
 * @param browser the browser channel's view, or `null` when that channel has not looked
 * @param id an explicit id, for a test that needs two entities to collide
 * @returns the entity
 */
export function entity({
  providerId,
  api = null,
  browser = null,
  id = providerId,
}: {
  providerId: string;
  api?: NotionChannelEntity | null;
  browser?: NotionChannelEntity | null;
  id?: string;
}): NotionAtlasEntity {
  return {
    channels: { api, browser },
    id,
    kind: "method",
    providerId,
  };
}
