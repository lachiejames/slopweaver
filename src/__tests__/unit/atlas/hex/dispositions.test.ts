import { describe, expect, it } from "vitest";

import {
  hexDispositionFor,
  hexGraphqlDispositionFor,
  hexGraphqlWithholdingFor,
  hexWithholdingFor,
} from "../../../../atlas/hex/disposition.js";
import { hexExclusionFor, isHexObservational } from "../../../../atlas/hex/exclusions.js";

describe("deciding what one Hex operation may store", () => {
  it("withholds a cell's computed output and the chart drawn from it", () => {
    expect(hexDispositionFor({ path: "/v1/cells/{cellId}/output" })).toBe("withheld");
    expect(hexDispositionFor({ path: "/v1/cells/{cellId}/image" })).toBe("withheld");
  });

  it("withholds the agent thread family, because a thread's messages quote what a query returned", () => {
    expect(hexDispositionFor({ path: "/v1/threads" })).toBe("withheld");
    expect(hexDispositionFor({ path: "/v1/threads/{threadId}/messages" })).toBe("withheld");
  });

  it("shape-indexes the project run family, whose rows are identified by an instant", () => {
    expect(hexDispositionFor({ path: "/v1/projects/{projectId}/runs" })).toBe("shape-index");
    expect(hexDispositionFor({ path: "/v1/projects/{projectId}/runs/{runId}" })).toBe("shape-index");
  });

  // The two criteria overlap on exactly this path, and the stricter one has to win: grading it by volume
  // would permit a shape read of a body this atlas must never fetch.
  it("withholds a run's chart image even though it sits inside the shape-indexed run family", () => {
    expect(hexDispositionFor({ path: "/v1/projects/{projectId}/runs/{runId}/cells/{staticId}/image" })).toBe(
      "withheld",
    );
  });

  it("treats configuration somebody created as an entity", () => {
    expect(hexDispositionFor({ path: "/v1/projects" })).toBe("entity");
    expect(hexDispositionFor({ path: "/v1/collections/{collectionId}" })).toBe("entity");
    expect(hexDispositionFor({ path: "/v1/data-connections" })).toBe("entity");
    expect(hexDispositionFor({ path: "/v1/projects/{projectId}/queriedTables" })).toBe("entity");
  });

  it("carries the reason on the row rather than leaving a reader to find this file", () => {
    expect(hexWithholdingFor({ path: "/v1/cells/{cellId}/output" })).toContain("stores no customer data locally");
    expect(hexWithholdingFor({ path: "/v1/projects" })).toBe(null);
  });
});

describe("deciding what one Hex GraphQL operation may store", () => {
  it("withholds an operation whose own name says it returns a computed result", () => {
    expect(hexGraphqlDispositionFor({ name: "OutputContentById" })).toBe("withheld");
    expect(hexGraphqlDispositionFor({ name: "CalcPreview" })).toBe("withheld");
  });

  // Schema is not a result set: a column's NAME is what a query could ask for, where its values are what a
  // query returned. Getting this backwards would empty the atlas of the thing it is for.
  it("keeps schema and configuration operations as entities", () => {
    expect(hexGraphqlDispositionFor({ name: "DataSourceColumnById" })).toBe("entity");
    expect(hexGraphqlDispositionFor({ name: "OrgDetails" })).toBe("entity");
    expect(hexGraphqlWithholdingFor({ name: "OrgDetails" })).toBe(null);
  });
});

describe("deciding which Hex operations may be called at all", () => {
  it("lets a GET observe and refuses every other method", () => {
    expect(isHexObservational({ method: "GET" })).toBe(true);
    expect(isHexObservational({ method: "POST" })).toBe(false);
    expect(isHexObservational({ method: "DELETE" })).toBe(false);
    expect(isHexObservational({ method: "PATCH" })).toBe(false);
    expect(isHexObservational({ method: "PUT" })).toBe(false);
  });

  it("names the execution risk in the POST refusal rather than saying only that it writes", () => {
    expect(hexExclusionFor({ method: "POST" })).toContain("runs a notebook against the warehouse");
    expect(hexExclusionFor({ method: "GET" })).toBe(null);
  });
});
