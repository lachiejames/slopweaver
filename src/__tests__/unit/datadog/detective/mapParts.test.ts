import { describe, expect, it } from "vitest";

import { leafTypeOf } from "../../../../datadog/detective/attributes.js";
import { foldMetricNamespaces, metricNamespace } from "../../../../datadog/detective/map.js";

describe("metricNamespace / foldMetricNamespaces", () => {
  it("takes everything before the first dot, which is what a namespace is", () => {
    expect(metricNamespace({ name: "trace.http.server.request.hits" })).toBe("trace");
  });

  it("answers the whole name for a metric carrying no dot at all", () => {
    expect(metricNamespace({ name: "heartbeat" })).toBe("heartbeat");
  });

  it("folds names into one entry per namespace, largest first", () => {
    expect(
      foldMetricNamespaces({
        names: ["trace.a", "trace.b", "gcp.x", "trace.c", "booking.create.route"],
      }),
    ).toEqual([
      { names: 3, namespace: "trace" },
      { names: 1, namespace: "booking" },
      { names: 1, namespace: "gcp" },
    ]);
  });
});

describe("leafTypeOf — null is its own type, which is the most useful thing a shape row says", () => {
  it("separates null from object", () => {
    expect(leafTypeOf({ value: null })).toBe("null");
    expect(leafTypeOf({ value: {} })).toBe("object");
  });

  it("names the primitives", () => {
    expect(leafTypeOf({ value: "x" })).toBe("string");
    expect(leafTypeOf({ value: 1 })).toBe("number");
    expect(leafTypeOf({ value: true })).toBe("boolean");
  });

  it("answers unknown for a value with no JSON type at all", () => {
    expect(leafTypeOf({ value: undefined })).toBe("unknown");
  });
});
