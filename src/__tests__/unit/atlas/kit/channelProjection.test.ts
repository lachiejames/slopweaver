/**
 * The three pieces of a multi-channel projection: a stamped channel view, an entity with exactly one channel
 * filled, and a deterministic order.
 */
import { describe, expect, it } from "vitest";

import { atlasChannelView, atlasEntityWithChannel, sortedById } from "../../../../atlas/kit/channelProjection.js";
import type { AtlasArtifactRef } from "../../../../atlas/kit/contract.js";

const AT = "2026-10-01T09:00:00.000Z";

describe("atlasChannelView", () => {
  it("stamps both seen times and the source's observedAt with this run's instant, as an observed view", () => {
    const view = atlasChannelView({
      artifacts: [],
      at: AT,
      channel: "api",
      deepLink: "https://example.test/x",
      deepLinkStatus: "provider-provided",
      detail: { name: "x" },
      endpoint: "GET /x",
    });

    expect(view).toEqual({
      channel: "api",
      detail: { name: "x" },
      firstSeenAt: AT,
      lastSeenAt: AT,
      source: {
        artifacts: [],
        channel: "api",
        deepLink: "https://example.test/x",
        deepLinkStatus: "provider-provided",
        endpoint: "GET /x",
        observedAt: AT,
      },
      state: "observed",
    });
  });

  it("holds a fresh copy of the artifacts rather than the caller's array", () => {
    const artifacts: readonly AtlasArtifactRef[] = [];
    const view = atlasChannelView({
      artifacts,
      at: AT,
      channel: "browser",
      deepLink: null,
      deepLinkStatus: "unavailable",
      detail: null,
      endpoint: "page:x",
    });

    expect(view.source!.artifacts).toEqual(artifacts);
    expect(view.source!.artifacts).not.toBe(artifacts);
  });
});

describe("atlasEntityWithChannel", () => {
  it("fills only the named channel and leaves the empty map it was given untouched", () => {
    const empty = { api: null, browser: null };
    const entity = atlasEntityWithChannel({
      channel: "browser",
      empty,
      id: "id-1",
      kind: "page",
      providerId: "/settings",
      view: { seen: true },
    });

    expect(entity).toEqual({
      channels: { api: null, browser: { seen: true } },
      id: "id-1",
      kind: "page",
      providerId: "/settings",
    });
    expect(empty).toEqual({ api: null, browser: null });
  });
});

describe("sortedById", () => {
  it("orders by id without reordering the caller's array", () => {
    const entities = [{ id: "c" }, { id: "a" }, { id: "b" }];

    expect(sortedById({ entities })).toEqual([{ id: "a" }, { id: "b" }, { id: "c" }]);
    expect(entities).toEqual([{ id: "c" }, { id: "a" }, { id: "b" }]);
  });
});
