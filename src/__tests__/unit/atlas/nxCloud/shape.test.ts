import { describe, expect, it } from "vitest";

import { responseFieldPaths } from "../../../../atlas/kit/responseShape.js";
import { classifyNxCloudSegment, NX_CLOUD_SHAPE_DEPTH_CAP } from "../../../../atlas/nxCloud/shape.js";

describe("classifyNxCloudSegment", () => {
  it("redacts a 24-character object id", () => {
    expect(classifyNxCloudSegment({ segment: "0000000000000000000000b2" })!.placeholder).toBe("<id>");
  });

  it("redacts a ten-character mixed-case run id", () => {
    expect(classifyNxCloudSegment({ segment: "XI4wt4hiBm" })!.placeholder).toBe("<rid>");
  });

  it("leaves a ten-character camelCase field name alone, which a length rule alone would swallow", () => {
    expect(classifyNxCloudSegment({ segment: "statusCode" })).toBe(null);
  });

  it("leaves an ordinary field name alone", () => {
    expect(classifyNxCloudSegment({ segment: "deferredRunListPage" })).toBe(null);
  });

  it("leaves a short hex-looking word alone", () => {
    expect(classifyNxCloudSegment({ segment: "cacheHitRate" })).toBe(null);
  });

  it("never collapses two adjacent ids, because an Nx Cloud id is always one segment", () => {
    expect(classifyNxCloudSegment({ segment: "0000000000000000000000b2" })!.collapsesWithPrevious).toBe(false);
  });
});

describe("responseFieldPaths with this atlas's classifier", () => {
  it("records field NAMES and no value", () => {
    const paths = responseFieldPaths({
      body: { workspace: { name: "example-monorepo", orgId: "0000000000000000000000a1" } },
      classify: classifyNxCloudSegment,
      depthCap: NX_CLOUD_SHAPE_DEPTH_CAP,
    });
    expect(paths).toEqual(["workspace", "workspace.name", "workspace.orgId"]);
  });

  it("collapses an array to one path however many records it holds", () => {
    const paths = responseFieldPaths({
      body: { runs: [{ status: "a" }, { status: "b" }, { status: "c" }] },
      classify: classifyNxCloudSegment,
      depthCap: NX_CLOUD_SHAPE_DEPTH_CAP,
    });
    expect(paths).toEqual(["runs", "runs[].status"]);
  });

  it("redacts a workspace id used as an object KEY, which is where a real id hides", () => {
    const paths = responseFieldPaths({
      body: { statsByWorkspace: { "0000000000000000000000b2": { passRate: 0.9 } } },
      classify: classifyNxCloudSegment,
      depthCap: NX_CLOUD_SHAPE_DEPTH_CAP,
    });
    expect(paths).toEqual(["statsByWorkspace", "statsByWorkspace.<id>", "statsByWorkspace.<id>.passRate"]);
  });
});
