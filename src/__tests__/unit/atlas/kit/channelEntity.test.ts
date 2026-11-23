/**
 * The channel views a two-channel atlas assembles, and the two decisions each one carries: where its deep
 * link came from, and what its reproduction handle is.
 */
import { describe, expect, it } from "vitest";

import {
  browserObservationView,
  channelView,
  compiledOperationView,
  pinnedDocumentView,
} from "../../../../atlas/kit/channelEntity.js";
import type { AtlasArtifactRef } from "../../../../atlas/kit/contract.js";

const AT = "2026-10-01T09:00:00.000Z";

describe("channelView", () => {
  it("stamps both seen times and the source's observedAt with this run's instant", () => {
    expect(
      channelView({
        artifacts: [],
        at: AT,
        channel: "api",
        deepLink: null,
        deepLinkStatus: "unverified",
        detail: { a: 1 },
        endpoint: "GET /a",
      }),
    ).toEqual({
      channel: "api",
      detail: { a: 1 },
      firstSeenAt: AT,
      lastSeenAt: AT,
      source: {
        artifacts: [],
        channel: "api",
        deepLink: null,
        deepLinkStatus: "unverified",
        endpoint: "GET /a",
        observedAt: AT,
      },
      state: "observed",
    });
  });

  it("holds a fresh copy of the artifacts rather than the caller's array", () => {
    const artifacts: readonly AtlasArtifactRef[] = [];
    const view = channelView({
      artifacts,
      at: AT,
      channel: "api",
      deepLink: null,
      deepLinkStatus: "unavailable",
      detail: null,
      endpoint: "GET /a",
    });

    expect(view.source.artifacts).not.toBe(artifacts);
  });
});

describe("pinnedDocumentView", () => {
  it("uses the pinned URL as both the endpoint and a provider-provided deep link, with no artifacts", () => {
    const view = pinnedDocumentView({
      at: AT,
      channel: "spec",
      detail: { title: "API" },
      url: "https://example.test/openapi.json",
    });

    expect(view.source).toEqual({
      artifacts: [],
      channel: "spec",
      deepLink: "https://example.test/openapi.json",
      deepLinkStatus: "provider-provided",
      endpoint: "https://example.test/openapi.json",
      observedAt: AT,
    });
  });
});

describe("compiledOperationView", () => {
  it("cites the declaring document as a provider-provided link and keys the endpoint on the provider id", () => {
    const view = compiledOperationView({
      at: AT,
      channel: "spec",
      citeUrl: "https://example.test/openapi.json",
      detail: null,
      providerId: "GET /users",
    });

    expect([view.source.deepLink, view.source.deepLinkStatus, view.source.endpoint]).toEqual([
      "https://example.test/openapi.json",
      "provider-provided",
      "GET /users",
    ]);
  });

  it("says unavailable, not unverified, when no document can be cited", () => {
    const view = compiledOperationView({
      at: AT,
      channel: "spec",
      citeUrl: null,
      detail: null,
      providerId: "GET /users",
    });

    expect([view.source.deepLink, view.source.deepLinkStatus, view.source.endpoint]).toEqual([
      null,
      "unavailable",
      "GET /users",
    ]);
  });
});

describe("browserObservationView", () => {
  it("records where the browser settled as a browser-discovered link on the browser channel", () => {
    const view = browserObservationView({
      artifacts: [],
      at: AT,
      deepLink: "https://example.test/settings",
      detail: { title: "Settings" },
      endpoint: "/settings",
    });

    expect([view.channel, view.source.deepLink, view.source.deepLinkStatus, view.source.endpoint]).toEqual([
      "browser",
      "https://example.test/settings",
      "browser-discovered",
      "/settings",
    ]);
  });

  it("reads a null or an empty link as settling nowhere: no link, and unavailable", () => {
    const fromNull = browserObservationView({ artifacts: [], at: AT, deepLink: null, detail: null, endpoint: "/a" });
    const fromEmpty = browserObservationView({ artifacts: [], at: AT, deepLink: "", detail: null, endpoint: "/a" });

    expect([fromNull.source.deepLink, fromNull.source.deepLinkStatus]).toEqual([null, "unavailable"]);
    expect([fromEmpty.source.deepLink, fromEmpty.source.deepLinkStatus]).toEqual([null, "unavailable"]);
  });
});
