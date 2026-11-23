import { describe, expect, it } from "vitest";

import { foldNotionChannel, mergeNotionChannel, staleNotionChannel } from "../../../../atlas/notion/merge.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

import { channel, entity } from "./notionEntityFixtures.js";

const AT = "2026-09-05T00:00:00.000Z";

describe("foldNotionChannel", () => {
  it("keeps the other channel's view untouched when one channel is refreshed", () => {
    const stored = entity({ api: channel({ name: "api" }), browser: channel({ name: "browser" }), providerId: "x" });
    const observed = entity({ api: channel({ name: "api", over: { lastSeenAt: AT } }), providerId: "x" });
    const folded = foldNotionChannel({ channel: "api", observed, stored });
    expect(folded.channels.browser!.lastSeenAt).toBe("2026-09-01T00:00:00.000Z");
  });

  it("replaces the refreshed channel's view", () => {
    const stored = entity({ api: channel({ name: "api" }), providerId: "x" });
    const observed = entity({ api: channel({ name: "api", over: { lastSeenAt: AT } }), providerId: "x" });
    expect(foldNotionChannel({ channel: "api", observed, stored }).channels.api!.lastSeenAt).toBe(AT);
  });

  it("carries the stored first-seen stamp forward, so an old entity does not claim to be new", () => {
    const stored = entity({
      api: channel({ name: "api", over: { firstSeenAt: "2026-01-01T00:00:00.000Z" } }),
      providerId: "x",
    });
    const observed = entity({ api: channel({ name: "api", over: { firstSeenAt: AT } }), providerId: "x" });
    expect(foldNotionChannel({ channel: "api", observed, stored }).channels.api!.firstSeenAt).toBe(
      "2026-01-01T00:00:00.000Z",
    );
  });

  it("takes the observed first-seen stamp for an entity nothing had seen before", () => {
    const observed = entity({ api: channel({ name: "api", over: { firstSeenAt: AT } }), providerId: "x" });
    expect(foldNotionChannel({ channel: "api", observed, stored: undefined }).channels.api!.firstSeenAt).toBe(AT);
  });

  it("takes the observed first-seen stamp when a stored entity is first seen on the refreshed channel", () => {
    const stored = entity({ browser: channel({ name: "browser" }), providerId: "x" });
    const observed = entity({ api: channel({ name: "api", over: { firstSeenAt: AT } }), providerId: "x" });
    expect(foldNotionChannel({ channel: "api", observed, stored }).channels.api!.firstSeenAt).toBe(AT);
  });

  it("leaves a new entity's refreshed channel empty when this run carries nothing for it", () => {
    const observed = entity({ browser: channel({ name: "browser" }), providerId: "x" });
    expect(foldNotionChannel({ channel: "api", observed, stored: undefined }).channels.api).toBeNull();
  });

  it("keeps the stored view when this run's entity carries nothing for the refreshed channel", () => {
    const stored = entity({ api: channel({ name: "api" }), providerId: "x" });
    const observed = entity({ providerId: "x" });
    expect(foldNotionChannel({ channel: "api", observed, stored }).channels.api!.state).toBe("observed");
  });
});

describe("staleNotionChannel", () => {
  it("marks the refreshed channel stale on an entity this run did not see", () => {
    const stored = entity({ api: channel({ name: "api" }), providerId: "x" });
    expect(staleNotionChannel({ channel: "api", stored })!.channels.api!.state).toBe("stale");
  });

  it("leaves the other channel exactly as it was", () => {
    const stored = entity({ api: channel({ name: "api" }), browser: channel({ name: "browser" }), providerId: "x" });
    expect(staleNotionChannel({ channel: "api", stored })!.channels.browser!.state).toBe("observed");
  });

  it("leaves an entity alone when the refreshed channel never held it", () => {
    const stored = entity({ browser: channel({ name: "browser" }), providerId: "x" });
    expect(staleNotionChannel({ channel: "api", stored })).toBeNull();
  });

  it("leaves an already-stale channel alone rather than restamping it", () => {
    const stored = entity({ api: channel({ name: "api", over: { state: "stale" } }), providerId: "x" });
    expect(staleNotionChannel({ channel: "api", stored })).toBeNull();
  });
});

describe("mergeNotionChannel", () => {
  it("does not stale a browser-only row when the api channel is refreshed", () => {
    const stored = [entity({ browser: channel({ name: "browser" }), providerId: "POST /api/v3/getSpaces" })];
    const merged = unwrap(
      mergeNotionChannel({
        at: AT,
        channel: "api",
        observed: [entity({ api: channel({ name: "api" }), providerId: "GET /v1/users" })],
        stored,
      }),
    );
    expect(merged.find((row) => row.providerId === "POST /api/v3/getSpaces")!.channels.browser!.state).toBe("observed");
  });

  it("keeps a row this run did not see rather than dropping it", () => {
    const stored = [entity({ api: channel({ name: "api" }), providerId: "GET /v1/users" })];
    const merged = unwrap(mergeNotionChannel({ at: AT, channel: "api", observed: [], stored }));
    expect(merged.length).toBe(1);
  });

  it("stales a row of its OWN channel that this run did not see", () => {
    const stored = [entity({ api: channel({ name: "api" }), providerId: "GET /v1/users" })];
    const merged = unwrap(mergeNotionChannel({ at: AT, channel: "api", observed: [], stored }));
    expect(merged[0]!.channels.api!.state).toBe("stale");
  });

  it("adds a row neither channel had seen", () => {
    const merged = unwrap(
      mergeNotionChannel({
        at: AT,
        channel: "browser",
        observed: [entity({ browser: channel({ name: "browser" }), providerId: "POST /api/v3/getSpaces" })],
        stored: [],
      }),
    );
    expect(merged.map((row) => row.providerId)).toEqual(["POST /api/v3/getSpaces"]);
  });

  it("refuses a run that produced the same entity id twice", () => {
    const twice = entity({ api: channel({ name: "api" }), id: "same", providerId: "GET /v1/users" });
    const merged = mergeNotionChannel({ at: AT, channel: "api", observed: [twice, twice], stored: [] });
    expect(unwrapErr(merged)).toEqual([
      "this run produced the same entity id twice: same",
      "refusing to merge — one read producing two records for one thing is how a count double-counts",
    ]);
  });
});
