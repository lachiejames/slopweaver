import { describe, expect, it } from "vitest";

import { prismaDataPlatformKindFor } from "../../../../atlas/prismaDataPlatform/kinds.js";

describe("prismaDataPlatformKindFor", () => {
  it("carries the fan-out of a database listing, which returns every connection whole", () => {
    expect(prismaDataPlatformKindFor({ method: "GET", path: "/v1/databases" })).toStrictEqual({
      alsoFeeds: ["connection"],
      kind: "database",
    });
  });

  it("places an operation no fan-out names by its longest prefix, filling its own kind alone", () => {
    expect(prismaDataPlatformKindFor({ method: "GET", path: "/v1/regions" })).toStrictEqual({
      alsoFeeds: [],
      kind: "region",
    });
    expect(prismaDataPlatformKindFor({ method: "DELETE", path: "/v1/databases/{databaseId}" })).toStrictEqual({
      alsoFeeds: [],
      kind: "database",
    });
  });

  it("places an overridden log stream under event-shape, with no fan-out", () => {
    expect(prismaDataPlatformKindFor({ method: "GET", path: "/v1/builds/{buildId}/logs" })).toStrictEqual({
      alsoFeeds: [],
      kind: "event-shape",
    });
  });

  it("refuses to place a path no declared prefix covers", () => {
    expect(prismaDataPlatformKindFor({ method: "GET", path: "/v2/anything" })).toBeNull();
  });
});
