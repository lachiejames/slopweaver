/**
 * The Knock atlas's reviewed boundary, read whole: the two OpenAPI pins by URL, byte length and digest, the
 * dashboard manifest observation, and every census number the generator refuses to regenerate past. Each is
 * compared as one complete literal, so a pin or count that moves without a reviewed diff here fails.
 */
import { describe, expect, it } from "vitest";

import {
  KNOCK_DASHBOARD_MANIFEST_PIN,
  KNOCK_ROUTE_CENSUS,
  KNOCK_SPEC_CENSUS,
  KNOCK_SPEC_PINS,
  KNOCK_SURFACE_CENSUS,
} from "../../../../../atlas/knock/generated/specLock.js";

describe("KNOCK_SPEC_PINS", () => {
  it("pins the data and management OpenAPI documents by URL, byte length and digest", () => {
    expect(KNOCK_SPEC_PINS).toEqual({
      data: {
        api: "data",
        byteLength: 308_559,
        sha256: "beb73639c6eb3a785e2074083f539cc444ea1b8b98d395e04126e4ccf09181d2",
        url: "https://api.knock.app/v1/openapi",
      },
      management: {
        api: "management",
        byteLength: 447_022,
        sha256: "9eb860894c798578d4a1af1d89adf42fcd5e7ca95194d709883df3c6fded7c1b",
        url: "https://control.knock.app/v1/openapi",
      },
    });
  });
});

describe("KNOCK_DASHBOARD_MANIFEST_PIN", () => {
  it("records the build id, byte length, landing page and digest last observed", () => {
    expect(KNOCK_DASHBOARD_MANIFEST_PIN).toEqual({
      buildId: "HyftbuwlLzQG_GZ7ebguU",
      byteLength: 21_925,
      landingUrl: "https://dashboard.knock.app/",
      sha256: "6043ed6dad136e7bf3abddc66fa76572d333350359b599359e3a58dfaae2c3a1",
    });
  });
});

describe("KNOCK_SPEC_CENSUS", () => {
  it("asserts every count each published document declared", () => {
    expect(KNOCK_SPEC_CENSUS).toEqual({
      data: {
        deprecated: 12,
        firstTags: 16,
        getOperations: 39,
        operations: 118,
        paths: 93,
        schemas: 146,
        suffixedOperationIds: 8,
        tags: 20,
      },
      management: {
        deprecated: 0,
        firstTags: 25,
        getOperations: 47,
        operations: 98,
        paths: 75,
        schemas: 218,
        suffixedOperationIds: 0,
        tags: 25,
      },
    });
  });
});

describe("KNOCK_ROUTE_CENSUS", () => {
  it("asserts the dashboard's route totals and the per-scope split", () => {
    expect(KNOCK_ROUTE_CENSUS).toEqual({
      byScope: { account: 36, auth: 12, environment: 94, integration: 8, internal: 4 },
      routes: 154,
      unbackedRoutes: 55,
      unbackedWalkPages: 19,
      walkableRoutes: 79,
      walkPages: 57,
    });
  });
});

describe("KNOCK_SURFACE_CENSUS", () => {
  it("asserts how each declared operation is disposed of and where its identifiers come from", () => {
    expect(KNOCK_SURFACE_CENSUS).toEqual({
      dispositions: { entity: 62, excluded: 137, "probe-only": 1, "shape-index": 16 },
      identifiers: { none: 59, "other-api": 16, "same-api": 104, unavailable: 37 },
    });
  });
});
