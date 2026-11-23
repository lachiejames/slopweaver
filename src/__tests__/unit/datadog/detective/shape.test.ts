import { describe, expect, it } from "vitest";

import {
  envOf,
  quoteTerm,
  reproducingQuery,
  serviceOf,
  siteClause,
  tagValue,
} from "../../../../datadog/detective/shape.js";
import { ENV_ABSENT, SERVICE_ABSENT } from "../../../../datadog/detective/shapeKey.js";

describe("tagValue — the reserved attributes arrive in tags, not as fields", () => {
  it("reads a tag's value", () => {
    expect(tagValue({ attributes: { tags: ["env:staging"] }, key: "env" })).toBe("staging");
  });

  it("keeps a colon inside a tag's value rather than truncating at it", () => {
    expect(tagValue({ attributes: { tags: ["url:https://x/y"] }, key: "url" })).toBe("https://x/y");
  });

  it("answers nothing when no tag carries the key", () => {
    expect(tagValue({ attributes: { tags: ["service:a"] }, key: "env" })).toBe(null);
  });

  it("answers nothing when there are no tags at all", () => {
    expect(tagValue({ attributes: {}, key: "env" })).toBe(null);
  });
});

describe("envOf / serviceOf — every spelling before concluding there is none", () => {
  it("prefers a declared field over a tag", () => {
    expect(envOf({ attributes: { env: "staging", tags: ["env:production"] } })).toBe("staging");
  });

  it("falls back to the tag, which is where a log actually carries it", () => {
    expect(envOf({ attributes: { tags: ["env:production"] } })).toBe("production");
  });

  it("reports the absent bucket rather than defaulting to production — the owner's standing ruling", () => {
    expect(envOf({ attributes: { tags: [] } })).toBe(ENV_ABSENT);
  });

  it("reads the OpenTelemetry spelling", () => {
    expect(envOf({ attributes: { deployment: { environment: { name: "prod-eu" } } } })).toBe("prod-eu");
  });

  it("reports an absent service rather than guessing", () => {
    expect(serviceOf({ attributes: {} })).toBe(SERVICE_ABSENT);
  });
});

describe("quoteTerm / siteClause / reproducingQuery — a query that returns zero reads as a dead shape", () => {
  it("truncates at a quote rather than emitting a mangled escape", () => {
    expect(quoteTerm({ value: 'a"b' })).toBe('"a"');
  });

  it("queries a RESERVED facet bare, with no @ sigil", () => {
    expect(
      siteClause({
        origin: { kind: "attribute", path: "additionalProperties.operation_name" },
        site: "postgresql.query",
      }),
    ).toBe('operation_name:"postgresql.query"');
  });

  it("queries a custom attribute with the @ sigil, envelope stripped", () => {
    expect(
      siteClause({ origin: { kind: "attribute", path: "attributes.view.url_path_group" }, site: "/overview" }),
    ).toBe('@view.url_path_group:"/overview"');
  });

  it("makes a bracketed site a quoted phrase, which is what a person would type", () => {
    expect(siteClause({ origin: { kind: "message-bracket" }, site: "[classifyDependency]" })).toBe(
      '"[classifyDependency]"',
    );
  });

  it("emits NO clause for an absent site rather than one that matches nothing", () => {
    expect(siteClause({ origin: { kind: "absent" }, site: "(none)" })).toBe(null);
  });

  it("omits the env clause for the absent-env bucket, because no query means 'no env tag'", () => {
    expect(
      reproducingQuery({
        identity: { env: ENV_ABSENT, family: "log", service: "core-api", site: "[x]" },
        origin: { kind: "message-bracket" },
      }),
    ).toBe('service:core-api "[x]"');
  });

  it("builds the full three-clause query when everything is present", () => {
    expect(
      reproducingQuery({
        identity: { env: "production", family: "log", service: "core-api", site: "[sessionTypeForBooking]" },
        origin: { kind: "message-bracket" },
      }),
    ).toBe('env:production service:core-api "[sessionTypeForBooking]"');
  });
});
