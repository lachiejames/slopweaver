/**
 * The one refusal this atlas makes that the kit cannot.
 *
 * A generation whose entities claim `connect-api` or `web-app` is a generation asserting reach this build
 * does not have. It cannot happen through `sync.ts` today, which is exactly why the gate is at the FILE
 * boundary rather than inside the sync: "this function happens not to fill a live channel" is one refactor
 * from being false, and a filled channel is what a reader trusts most.
 */
import { describe, expect, it } from "vitest";

import {
  type CanvaAtlasEntity,
  type CanvaChannelEntity,
  emptyCanvaChannels,
  emptyCanvaKindFile,
} from "../../../../atlas/canva/model.js";
import { canvaObservations } from "../../../../atlas/canva/readAdapter.js";
import { refuseUnearnedLiveChannels } from "../../../../atlas/canva/store.js";
import { unwrapErr } from "../../../../lib/result.js";

const AT = "2026-09-06T00:00:00.000Z";

/** One channel record, filled the way a live channel would fill it. */
function channelRecord(): CanvaChannelEntity {
  return {
    detail: { namedBy: [], scope: "folder:read" },
    firstSeenAt: AT,
    lastSeenAt: AT,
    source: {
      artifacts: [],
      channel: "web-app",
      deepLink: null,
      deepLinkStatus: "unavailable",
      endpoint: "/settings",
      observedAt: AT,
    },
    state: "observed",
  };
}

/** One entity with only the compiled channel filled — what a real sync produces. */
function compiledEntity(): CanvaAtlasEntity {
  return {
    channels: {
      ...emptyCanvaChannels(),
      "published-api": { ...channelRecord(), source: { ...channelRecord().source, channel: "published-api" } },
    },
    family: "scope",
    id: "abc",
    kind: "folder",
    providerId: "scope:folder:read",
  };
}

describe("refuseUnearnedLiveChannels", () => {
  it("passes a generation that fills only the compiled channel", () => {
    const file = { ...emptyCanvaKindFile({ kind: "folder", updatedAt: AT }), entities: [compiledEntity()] };
    const result = refuseUnearnedLiveChannels({ files: { folder: file } });
    expect(result.isOk()).toBe(true);
  });

  it("refuses the WHOLE generation when one entity claims the browser channel", () => {
    const entity: CanvaAtlasEntity = {
      ...compiledEntity(),
      channels: { ...emptyCanvaChannels(), "web-app": channelRecord() },
    };
    const file = { ...emptyCanvaKindFile({ kind: "folder", updatedAt: AT }), entities: [entity] };
    const result = refuseUnearnedLiveChannels({ files: { folder: file } });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()[0]).toContain("folder carries 1 entit(ies) claiming a live channel");
  });

  it("refuses on the connect-api channel too, not only the browser one", () => {
    const entity: CanvaAtlasEntity = {
      ...compiledEntity(),
      channels: {
        ...emptyCanvaChannels(),
        "connect-api": { ...channelRecord(), source: { ...channelRecord().source, channel: "connect-api" } },
      },
    };
    const file = { ...emptyCanvaKindFile({ kind: "design", updatedAt: AT }), entities: [entity] };
    const result = refuseUnearnedLiveChannels({ files: { design: file } });
    expect(unwrapErr(result)).toEqual([
      "design carries 1 entit(ies) claiming a live channel, and this build fills neither — no Canva credential " +
        "is configured and no web-app walk exists, so a filled connect-api or web-app record could only come " +
        "from a defect or a hand-edited file",
    ]);
  });

  it("passes an empty generation, so a reset cannot be refused by its own gate", () => {
    expect(
      refuseUnearnedLiveChannels({ files: { folder: emptyCanvaKindFile({ kind: "folder", updatedAt: AT }) } }).isOk(),
    ).toBe(true);
  });
});

describe("canvaObservations", () => {
  it("projects one observation per channel that actually looked, and none for the two that did not", () => {
    const observations = canvaObservations({ entity: compiledEntity() });
    expect(observations.length).toBe(1);
    expect(observations[0]!.surface).toBe("published-api");
  });

  it("projects nothing at all for an entity no channel has filled", () => {
    const entity: CanvaAtlasEntity = { ...compiledEntity(), channels: emptyCanvaChannels() };
    expect(canvaObservations({ entity })).toStrictEqual([]);
  });
});
