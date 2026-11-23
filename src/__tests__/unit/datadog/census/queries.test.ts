import { describe, expect, it } from "vitest";

import { patternShape } from "../../../../datadog/census/logs.js";
import { spanShapeQuery } from "../../../../datadog/census/spans.js";

describe("patternShape — the query a log pattern row reproduces itself with", () => {
  it("names the service and the fingerprint facet, with NO @ sigil on a reserved field", () => {
    const shape = patternShape({ pattern: { count: 861_782, fingerprint: "96dedf596944" }, service: "jobs-api" });
    expect(shape.query).toBe('service:"jobs-api" __dd.log_identity.raw_msg_fingerprint:96dedf596944');
    expect(shape.count).toBe(861_782);
  });

  it("labels a pattern by its fingerprint until an exemplar supplies a template", () => {
    expect(patternShape({ pattern: { count: 1, fingerprint: "abc" }, service: "x" }).label).toBe("pattern abc");
  });

  it("selects the events carrying no service through the absent clause", () => {
    expect(patternShape({ pattern: { count: 1, fingerprint: "abc" }, service: "(none)" }).query).toBe(
      "-service:* __dd.log_identity.raw_msg_fingerprint:abc",
    );
  });
});

describe("spanShapeQuery", () => {
  it("names the service, the operation and the kind, quoting each", () => {
    expect(
      spanShapeQuery({ shape: { count: 9, kind: "client", operation: "postgresql.query", service: "core-api" } }),
    ).toBe('service:"core-api" operation_name:"postgresql.query" @span.kind:"client"');
  });

  it("omits the kind clause for a span that declared none, rather than matching a literal (none)", () => {
    expect(spanShapeQuery({ shape: { count: 9, kind: "(none)", operation: "Internal", service: "core-api" } })).toBe(
      'service:"core-api" operation_name:"Internal"',
    );
  });
});
