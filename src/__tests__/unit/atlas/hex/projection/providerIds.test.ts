/*
 * The two Hex provider-id builders: a probed noun's star method and a GraphQL operation's id.
 */
import { describe, expect, it } from "vitest";

import { hexGraphqlProviderId, hexProbeProviderId } from "../../../../../atlas/hex/projection.js";

describe("hexProbeProviderId", () => {
  it("is a star method over the api prefix and the noun", () => {
    expect(hexProbeProviderId({ noun: "noun-a" })).toBe("* /api/v1/noun-a");
  });
});

describe("hexGraphqlProviderId", () => {
  it("is GRAPHQL and the operation name", () => {
    expect(hexGraphqlProviderId({ name: "OperationA" })).toBe("GRAPHQL OperationA");
  });
});
