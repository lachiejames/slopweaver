import { describe, expect, it } from "vitest";

import {
  foldFacetValues,
  isFacetPath,
  MAX_DISTINCT_VALUES,
  MAX_VALUE_CHARS,
  withoutEnvelope,
} from "../../../../datadog/detective/facets.js";

describe("isFacetPath — an envelope is stripped, a nesting is not", () => {
  it("matches a bare allowlisted path", () => {
    expect(isFacetPath({ path: "status" })).toBe(true);
  });

  it("matches the same path under the logs endpoint's envelope", () => {
    expect(isFacetPath({ path: "attributes.status" })).toBe(true);
  });

  it("matches the same path under the SDK's additionalProperties envelope", () => {
    expect(isFacetPath({ path: "additionalProperties.operation_name" })).toBe(true);
  });

  it("REFUSES custom.graphql.source, the tail match that stored a whole GraphQL document", () => {
    expect(isFacetPath({ path: "custom.graphql.source" })).toBe(false);
  });

  it("refuses a path nobody allowlisted", () => {
    expect(isFacetPath({ path: "attributes.requestId" })).toBe(false);
  });
});

describe("withoutEnvelope", () => {
  it("strips the logs envelope", () => {
    expect(withoutEnvelope({ path: "attributes.env" })).toBe("env");
  });

  it("leaves a path carrying no envelope alone", () => {
    expect(withoutEnvelope({ path: "custom.graphql.source" })).toBe("custom.graphql.source");
  });
});

describe("foldFacetValues", () => {
  it("keeps a closed vocabulary, sorted, and reports how many distinct values it saw", () => {
    const folded = foldFacetValues({
      observations: [
        { path: "status", value: "info" },
        { path: "status", value: "error" },
        { path: "status", value: "info" },
      ],
    });
    expect(folded).toEqual([{ distinct: 2, path: "status", values: ["error", "info"] }]);
  });

  it("renders a numeric facet rather than dropping it for being the wrong JSON type", () => {
    const folded = foldFacetValues({ observations: [{ path: "http.status_code", value: 503 }] });
    expect(folded[0]!.values).toEqual(["503"]);
  });

  it("drops the values but keeps the path and the real distinct count past the cap", () => {
    const observations = Array.from({ length: MAX_DISTINCT_VALUES + 5 }, (_unused, index) => ({
      path: "status",
      value: `v${String(index)}`,
    }));
    const folded = foldFacetValues({ observations });
    expect(folded[0]!.values).toBe(null);
    expect(folded[0]!.distinct).toBe(MAX_DISTINCT_VALUES + 5);
  });

  it("refuses a value longer than the cap, the defence behind the envelope rule", () => {
    const folded = foldFacetValues({
      observations: [
        { path: "status", value: "x".repeat(MAX_VALUE_CHARS + 1) },
        { path: "status", value: "ok" },
      ],
    });
    expect(folded[0]!.values).toEqual(["ok"]);
  });

  it("ignores an observation whose path is not allowlisted at all", () => {
    expect(foldFacetValues({ observations: [{ path: "usr.id", value: "abc" }] })).toEqual([]);
  });

  it("renders a null value as the string null rather than dropping the observation", () => {
    expect(foldFacetValues({ observations: [{ path: "status", value: null }] })[0]!.values).toEqual(["null"]);
  });
});

describe("foldFacetValues — an unrenderable value is refused, never stored", () => {
  it("drops an observation whose value is undefined rather than throwing on it", () => {
    const folded = foldFacetValues({
      observations: [
        { path: "http.method", value: undefined },
        { path: "http.method", value: "GET" },
      ],
    });
    expect(folded).toHaveLength(1);
    expect(folded[0]!.path).toBe("http.method");
    expect(folded[0]!.values).toEqual(["GET"]);
    expect(folded[0]!.distinct).toBe(1);
  });

  it("drops every observation when none of them can be rendered", () => {
    expect(foldFacetValues({ observations: [{ path: "status", value: undefined }] })).toEqual([]);
  });
});
