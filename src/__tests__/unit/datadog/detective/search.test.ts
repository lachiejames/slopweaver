/**
 * Every Datadog host in this file reads the synthetic `ap1` site rather than the install's own.
 */

import { describe, expect, it } from "vitest";

import {
  correlationKeys,
  datadogRecordId,
  isDatadogId,
  parseDatadogRecordId,
} from "../../../../datadog/detective/record.js";
import {
  ASSUMED_RETENTION_DAYS,
  aroundQuery,
  checkRetention,
  linkDomainFor,
  recordFromLog,
} from "../../../../datadog/detective/search.js";

const WINDOW = { fromMs: 1_789_326_548_803, toMs: 1_789_330_148_803 };

describe("datadogRecordId / parseDatadogRecordId", () => {
  it("round-trips an opaque Datadog event id, which carries no surface marker of its own", () => {
    const id = datadogRecordId({ eventId: "AwAAAaCcI97Uu:L4aVg", family: "log" });
    expect(parseDatadogRecordId({ id })).toEqual({ eventId: "AwAAAaCcI97Uu:L4aVg", family: "log" });
  });

  it("refuses a store UUID", () => {
    expect(isDatadogId({ id: "16ab6aec-e951-4682-8b9f-d4425b3816c8" })).toBe(false);
  });

  it("refuses a dd: prefix with no event id after the family", () => {
    expect(parseDatadogRecordId({ id: "dd:log:" })).toBe(null);
  });
});

describe("checkRetention — a zero over an older window means NOT RETAINED", () => {
  it("accepts a window inside the reported retention", () => {
    expect(checkRetention({ retentionDays: 15, window: WINDOW }).isOk()).toBe(true);
  });

  it("refuses a window past it, and says what the zero would have meant", () => {
    const failure = checkRetention({
      retentionDays: 15,
      window: { fromMs: 0, toMs: 30 * 86_400_000 },
    });
    expect(failure.isErr()).toBe(true);
    expect(failure._unsafeUnwrapErr().message).toContain("not retained");
  });

  it("falls back to the assumed ceiling when no catalogue reported one", () => {
    const failure = checkRetention({
      retentionDays: null,
      window: { fromMs: 0, toMs: (ASSUMED_RETENTION_DAYS + 1) * 86_400_000 },
    });
    expect(failure.isErr()).toBe(true);
    expect(failure._unsafeUnwrapErr().code).toBe("WINDOW_PAST_RETENTION");
  });
});

describe("linkDomainFor", () => {
  it("sends a span to the traces console", () => {
    expect(linkDomainFor({ family: "span" })).toBe("traces");
  });

  it("sends a RUM session to the RUM console", () => {
    expect(linkDomainFor({ family: "rum-session" })).toBe("rum");
  });

  it("sends an error log to the logs console, because it is a cut of that index", () => {
    expect(linkDomainFor({ family: "error" })).toBe("logs");
  });
});

describe("recordFromLog — nothing is masked, by the owner's standing ruling", () => {
  it("keeps usr.id and session.ip in the attributes it returns", () => {
    const record = recordFromLog({
      attributes: {
        attributes: { session: { ip: "203.0.113.7" }, usr: { id: "u-1" } },
        message: "[x] y",
        service: "checkout-api",
        status: "info",
        tags: ["env:production"],
      },
      consoleHost: "ap1.datadoghq.com",
      eventId: "abc",
      family: "log",
      window: WINDOW,
    });
    expect(correlationKeys({ attributes: record.attributes }).ip).toBe("203.0.113.7");
  });

  it("uses the message as the record's text", () => {
    const record = recordFromLog({
      attributes: { message: "[x] y", service: "a", tags: [] },
      consoleHost: "ap1.datadoghq.com",
      eventId: "abc",
      family: "log",
      window: WINDOW,
    });
    expect(record.text).toBe("[x] y");
  });

  it("falls back to the resource name for a surface with no message", () => {
    const record = recordFromLog({
      attributes: { resource_name: "SELECT 1", service: "a", tags: [] },
      consoleHost: "ap1.datadoghq.com",
      eventId: "abc",
      family: "span",
      window: WINDOW,
    });
    expect(record.text).toBe("SELECT 1");
  });

  it("links to the service view frozen to the window, never to a get-by-id route that 404s", () => {
    const record = recordFromLog({
      attributes: { message: "m", service: "checkout-api", tags: [] },
      consoleHost: "ap1.datadoghq.com",
      eventId: "abc",
      family: "log",
      window: WINDOW,
    });
    expect(record.link).toContain("query=service%3Acheckout-api");
    expect(record.link).toContain("live=false");
  });
});

describe("aroundQuery — the five correlations, and the one that is the owner's own move", () => {
  const record = {
    attributes: {
      attributes: { requestId: "req-1", session: { id: "s-1", ip: "203.0.113.7" }, trace_id: "t-1" },
    },
    env: "production",
    family: "log" as const,
    id: "dd:log:abc",
    link: "",
    occurredAtIso: "2026-09-13T20:09:04.503Z",
    service: "checkout-api",
    status: "info" as string | null,
    text: "m",
  };

  it("follows the trace", () => {
    expect(aroundQuery({ mode: "trace", record })).toBe("@trace_id:t-1");
  });

  it("follows the request", () => {
    expect(aroundQuery({ mode: "request", record })).toBe("@requestId:req-1");
  });

  it("follows the IP, which is the correlation the owner asked for by name", () => {
    expect(aroundQuery({ mode: "ip", record })).toBe("@session.ip:203.0.113.7");
  });

  it("follows the service", () => {
    expect(aroundQuery({ mode: "service", record })).toBe("service:checkout-api");
  });

  it("returns NOTHING rather than widening to the service when the key is absent", () => {
    expect(aroundQuery({ mode: "trace", record: { ...record, attributes: {} } })).toBe(null);
  });
});
