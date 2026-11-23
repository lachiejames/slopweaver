import { describe, expect, it } from "vitest";

import {
  foldHiveChannel,
  mergeHiveChannel,
  mergeHivePartialChannel,
  staleHiveChannel,
} from "../../../../atlas/graphqlHive/merge.js";
import { unwrap } from "../../../../lib/result.js";

import { AT, channel, entity } from "./hiveFixtures.js";

const LATER = "2026-09-06T00:00:00.000Z";

describe("foldHiveChannel", () => {
  it("replaces only the refreshed channel and leaves the other exactly as it stood", () => {
    const stored = entity({ api: channel({ name: "api" }), browser: channel({ name: "browser" }), providerId: "x" });
    const observed = entity({ api: channel({ name: "api", detail: { fresh: true } }), providerId: "x" });
    const folded = foldHiveChannel({ channel: "api", observed, stored });
    expect(folded.channels.browser!.detail).toBeNull();
  });

  it("carries the stored first-seen stamp forward, so an old row does not claim to be new", () => {
    const stored = entity({ api: channel({ name: "api" }), providerId: "x" });
    const observed = entity({ api: { ...channel({ name: "api" }), firstSeenAt: LATER }, providerId: "x" });
    expect(foldHiveChannel({ channel: "api", observed, stored }).channels.api!.firstSeenAt).toBe(AT);
  });

  it("keeps the stored view when this run's entity carries nothing for the refreshed channel", () => {
    const stored = entity({ api: channel({ name: "api", detail: { kept: true } }), providerId: "x" });
    const observed = entity({ browser: channel({ name: "browser" }), providerId: "x" });
    expect(foldHiveChannel({ channel: "api", observed, stored }).channels.api!.detail).toStrictEqual({ kept: true });
  });
});

describe("staleHiveChannel", () => {
  it("stales a channel this run refreshed and did not see", () => {
    const stored = entity({ api: channel({ name: "api" }), providerId: "x" });
    expect(staleHiveChannel({ channel: "api", stored })!.channels.api!.state).toBe("stale");
  });

  it("leaves an already-stale row untouched, so a repeated run does not rewrite the file", () => {
    const stored = entity({ api: { ...channel({ name: "api" }), state: "stale" }, providerId: "x" });
    expect(staleHiveChannel({ channel: "api", stored })).toBeNull();
  });

  it("leaves a row alone when the refreshed channel never held anything", () => {
    const stored = entity({ browser: channel({ name: "browser" }), providerId: "x" });
    expect(staleHiveChannel({ channel: "api", stored })).toBeNull();
  });
});

describe("mergeHiveChannel", () => {
  it("stales a stored row this run did not see, because a full observation knows what is gone", () => {
    const stored = [entity({ api: channel({ name: "api" }), providerId: "gone" })];
    const merged = unwrap(mergeHiveChannel({ at: LATER, channel: "api", observed: [], stored }));
    expect(merged[0]!.channels.api!.state).toBe("stale");
  });

  it("keeps the row rather than deleting it — accumulate, never replace", () => {
    const stored = [entity({ api: channel({ name: "api" }), providerId: "gone" })];
    expect(unwrap(mergeHiveChannel({ at: LATER, channel: "api", observed: [], stored })).length).toBe(1);
  });
});

describe("mergeHivePartialChannel", () => {
  it("leaves an unobserved row current, because a partial run never asked about it", () => {
    const stored = [entity({ api: channel({ name: "api" }), providerId: "unasked" })];
    const merged = unwrap(mergeHivePartialChannel({ at: LATER, channel: "api", observed: [], stored }));
    expect(merged[0]!.channels.api!.state).toBe("observed");
  });

  it("still folds the rows it DID observe", () => {
    const stored = [entity({ api: channel({ name: "api" }), providerId: "seen" })];
    const observed = [entity({ api: channel({ name: "api", detail: { fresh: true } }), providerId: "seen" })];
    const merged = unwrap(mergeHivePartialChannel({ at: LATER, channel: "api", observed, stored }));
    expect(merged[0]!.channels.api!.detail).toStrictEqual({ fresh: true });
  });
});
