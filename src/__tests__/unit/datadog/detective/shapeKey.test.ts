import { describe, expect, it } from "vitest";

import {
  bracketedSite,
  ENV_ABSENT,
  parseShapeKey,
  SITE_ABSENT,
  shapeKey,
  siteOf,
  templateOf,
} from "../../../../datadog/detective/shapeKey.js";

describe("templateOf — the per-event values are replaced, widest shape first", () => {
  it("replaces a UUID whole rather than carving it into digit runs", () => {
    expect(templateOf({ message: "user 01d0a8c3-1c3e-4cc4-956b-9b1c6e2fefe3 signed in" })).toBe(
      "user <uuid> signed in",
    );
  });

  it("folds two different UUIDs to the same template, which is what makes it a key", () => {
    const left = templateOf({ message: "[job] ran 01d0a8c3-1c3e-4cc4-956b-9b1c6e2fefe3" });
    const right = templateOf({ message: "[job] ran fe5dfe99-5397-479f-a0cc-b1cce9fccd92" });
    expect(left).toBe(right);
  });

  it("replaces an email before the number pass reaches its digits", () => {
    expect(templateOf({ message: "sent to a1@example.com ok" })).toBe("sent to <email> ok");
  });

  it("replaces a bare number and collapses runs of whitespace", () => {
    expect(templateOf({ message: "retried   17  times" })).toBe("retried <n> times");
  });
});

describe("bracketedSite — the leading token only, because a bracket elsewhere is data", () => {
  it("takes a leading bracketed token including its brackets, so it is already a quotable literal", () => {
    expect(bracketedSite({ message: "[sessionTypeForBooking] type absent" })).toBe("[sessionTypeForBooking]");
  });

  it("ignores a bracket that is not leading", () => {
    expect(bracketedSite({ message: "handled [object Object] badly" })).toBe(null);
  });

  it("ignores a leading JSON array, which would otherwise become one site per payload", () => {
    expect(bracketedSite({ message: '["a","b"] parsed' })).toBe(null);
  });

  it("ignores a leading bracket that opens with a digit, which is an index rather than a name", () => {
    expect(bracketedSite({ message: "[0] first element" })).toBe(null);
  });

  it("keeps a hyphenated slug, which is how several of this organisation's sites are written", () => {
    expect(bracketedSite({ message: "[braze-twilio-sms] failed to send" })).toBe("[braze-twilio-sms]");
  });
});

describe("siteOf — each family keys on what it actually carries, and says where it read it", () => {
  it("keys a log on its bracketed site", () => {
    const reading = siteOf({ attributes: {}, family: "log", message: "[classifyDependency] not created yet" });
    expect(reading.site).toBe("[classifyDependency]");
    expect(reading.origin).toEqual({ kind: "message-bracket" });
  });

  it("keys a span on operation_name even when the SDK parked it under additionalProperties", () => {
    const reading = siteOf({
      attributes: { "additionalProperties.operation_name": "postgresql.query" },
      family: "span",
      message: null,
    });
    expect(reading.site).toBe("postgresql.query");
    expect(reading.origin).toEqual({ kind: "attribute", path: "additionalProperties.operation_name" });
  });

  it("falls through to the family's SECOND declared path when the first is absent", () => {
    const reading = siteOf({
      attributes: { "attributes.error.source": "console" },
      family: "rum-error",
      message: null,
    });
    expect(reading.site).toBe("console");
    expect(reading.origin).toEqual({ kind: "attribute", path: "attributes.error.source" });
  });

  it("falls back to a truncated template for a log with no bracket, rather than an unkeyed bucket", () => {
    const reading = siteOf({ attributes: {}, family: "log", message: "connection reset by peer 17" });
    expect(reading.site).toBe("connection reset by peer <n>");
    expect(reading.origin).toEqual({ kind: "message-template" });
  });

  it("reports an absent site for an event with neither a keyable attribute nor a message", () => {
    const reading = siteOf({ attributes: {}, family: "span", message: null });
    expect(reading.site).toBe(SITE_ABSENT);
    expect(reading.origin).toEqual({ kind: "absent" });
  });
});

describe("shapeKey / parseShapeKey — four fields, and a site may contain the separator", () => {
  it("round-trips a key whose site contains a pipe", () => {
    const identity = { env: "production", family: "span" as const, service: "jobs-api", site: "a|b" };
    expect(parseShapeKey({ key: shapeKey({ identity }) })).toEqual(identity);
  });

  it("round-trips the absent-env bucket, which is the standing ruling's own case", () => {
    const identity = { env: ENV_ABSENT, family: "log" as const, service: "core-api", site: "[x]" };
    expect(parseShapeKey({ key: shapeKey({ identity }) })).toEqual(identity);
  });

  it("refuses a key naming a family that does not exist", () => {
    expect(parseShapeKey({ key: "trace|production|jobs-api|Internal" })).toBe(null);
  });

  it("refuses a string with too few fields to be a key", () => {
    expect(parseShapeKey({ key: "log|production|jobs-api" })).toBe(null);
  });
});
