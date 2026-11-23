import { describe, expect, it } from "vitest";

import {
  FALCON_SEGMENTS,
  falconParamNames,
  falconPathShape,
  reduceConsoleCalls,
} from "../../../../atlas/crowdstrike/consoleReduction.js";

const ORIGIN = "https://falcon.example-cloud.test";

describe("FALCON_SEGMENTS", () => {
  it("recognises a 32-hex Falcon id, which Slack's own pattern matches none of", () => {
    expect(FALCON_SEGMENTS({ segment: "0000000000000000000000000000c001" })).toEqual({
      collapsesWithPrevious: false,
      placeholder: "<aid>",
    });
  });

  it("recognises a composite alert id as one value", () => {
    const composite = `${"a".repeat(32)}_${"b".repeat(32)}`;
    expect(FALCON_SEGMENTS({ segment: composite })?.placeholder).toBe("<aid>");
  });

  it("recognises a trace uuid", () => {
    expect(FALCON_SEGMENTS({ segment: "2c067302-be33-4fff-9d33-2f0d47ecd364" })?.placeholder).toBe("<uuid>");
  });

  it("leaves a genuine field name alone", () => {
    expect(FALCON_SEGMENTS({ segment: "resources" })).toBe(null);
  });
});

describe("falconPathShape", () => {
  it("collapses a device id in the path so one endpoint is one row", () => {
    expect(
      falconPathShape({ url: `${ORIGIN}/api2/devices/entities/devices/v2/0000000000000000000000000000c001` }),
    ).toBe("/api2/devices/entities/devices/v2/<aid>");
  });

  it("drops the query entirely, because its values are the thing not to keep", () => {
    expect(falconPathShape({ url: `${ORIGIN}/api2/devices/queries/devices/v2?filter=hostname%3A%27X%27` })).toBe(
      "/api2/devices/queries/devices/v2",
    );
  });

  it("returns null for something that is not a URL", () => {
    expect(falconPathShape({ url: "not a url" })).toBe(null);
  });
});

describe("falconParamNames", () => {
  it("keeps the names an endpoint accepts and drops the console's own telemetry", () => {
    expect(falconParamNames({ url: `${ORIGIN}/api2/x?limit=20&offset=0&_cid=abc&token=secret` })).toEqual([
      "limit",
      "offset",
    ]);
  });
});

describe("reduceConsoleCalls", () => {
  it("records field NAMES and never a value", () => {
    const reduced = reduceConsoleCalls({
      calls: [
        {
          body: { meta: { pagination: { total: 161 } }, resources: [{ hostname: "EXAMPLE-LAPTOP-1", id: "x" }] },
          method: "GET",
          onPage: "/host-management/hosts",
          statusCode: 200,
          url: `${ORIGIN}/api2/devices/queries/devices/v2`,
        },
      ],
    });
    expect(reduced).toHaveLength(1);
    expect(reduced[0]!.responseFieldPaths).toEqual([
      "meta",
      "meta.pagination",
      "meta.pagination.total",
      "resources",
      "resources[].hostname",
      "resources[].id",
    ]);
    expect(JSON.stringify(reduced)).not.toContain("EXAMPLE-LAPTOP-1");
    expect(JSON.stringify(reduced)).not.toContain("161");
  });

  it("redacts a real agent id used as a map KEY", () => {
    const aid = "0000000000000000000000000000c001";
    const reduced = reduceConsoleCalls({
      calls: [
        {
          body: { states: { [aid]: { online: true } } },
          method: "GET",
          onPage: "/a",
          statusCode: 200,
          url: `${ORIGIN}/api2/devices/entities/online-state/v1`,
        },
      ],
    });
    expect(JSON.stringify(reduced)).not.toContain(aid);
    expect(reduced[0]!.responseFieldPaths).toContain("states.<aid>");
  });

  it("folds one endpoint called from two pages into one row", () => {
    const reduced = reduceConsoleCalls({
      calls: [
        { body: { a: 1 }, method: "GET", onPage: "/b", statusCode: 200, url: `${ORIGIN}/api2/x?limit=1` },
        { body: { b: 2 }, method: "GET", onPage: "/a", statusCode: 500, url: `${ORIGIN}/api2/x?offset=1` },
      ],
    });
    expect(reduced).toHaveLength(1);
    expect(reduced[0]!.observedOnPages).toEqual(["/a", "/b"]);
    expect(reduced[0]!.paramNames).toEqual(["limit", "offset"]);
    expect(reduced[0]!.statusCodes).toEqual([200, 500]);
  });

  it("keeps two methods on one path apart", () => {
    const reduced = reduceConsoleCalls({
      calls: [
        { body: {}, method: "GET", onPage: "/a", statusCode: 200, url: `${ORIGIN}/api2/x` },
        { body: {}, method: "POST", onPage: "/a", statusCode: 200, url: `${ORIGIN}/api2/x` },
      ],
    });
    expect(reduced.map((row) => row.method)).toEqual(["GET", "POST"]);
  });

  it("drops a call whose URL cannot be parsed rather than storing a bad shape", () => {
    expect(
      reduceConsoleCalls({ calls: [{ body: {}, method: "GET", onPage: "/a", statusCode: 200, url: "::" }] }),
    ).toEqual([]);
  });
});
