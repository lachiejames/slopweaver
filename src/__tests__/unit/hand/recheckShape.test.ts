import { describe, expect, it } from "vitest";

import { bareHttpsOrigin, checkedRecheck, isChannelId, RECHECK_SHAPE } from "../../../hand/recheckShape.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

describe("bareHttpsOrigin", () => {
  it.each([
    ["https://dashboard.clerk.com", "https://dashboard.clerk.com"],
    ["https://dashboard.clerk.com/", "https://dashboard.clerk.com"],
  ])("reads %s as its origin", (value, origin) => {
    expect(bareHttpsOrigin({ value })).toBe(origin);
  });

  it.each([
    "https://dashboard.clerk.com/apps",
    "https://dashboard.clerk.com?x=1",
    "http://dashboard.clerk.com",
    "not a url",
  ])("reads %s as no bare https origin", (value) => {
    expect(bareHttpsOrigin({ value })).toBe(undefined);
  });
});

describe("isChannelId", () => {
  it.each([
    ["C0123456789", true],
    ["G0SYN123456789", true],
    ["D0SYN123456789", false],
    ["general", false],
    ["C0123", false],
  ])("judges %s a channel id: %s", (channel, expected) => {
    expect(isChannelId({ channel })).toBe(expected);
  });
});

describe("checkedRecheck — a register line's recheck, checked as a shape", () => {
  it("reads an absent field as absent", () => {
    expect(unwrap(checkedRecheck({ value: undefined }))).toBe(undefined);
  });

  it("keeps a browser session at a bare origin, whether or not an atlas reads it", () => {
    expect(unwrap(checkedRecheck({ value: { kind: "browser-session", origin: "https://example.com" } }))).toEqual({
      kind: "browser-session",
      origin: "https://example.com",
    });
  });

  it("keeps a channel membership", () => {
    expect(unwrap(checkedRecheck({ value: { channel: "C0123456789", kind: "slack-member" } }))).toEqual({
      channel: "C0123456789",
      kind: "slack-member",
    });
  });

  it.each<[string, unknown]>([
    ["an origin with a path", { kind: "browser-session", origin: "https://dashboard.clerk.com/apps" }],
    ["an origin with a trailing slash", { kind: "browser-session", origin: "https://dashboard.clerk.com/" }],
    ["a channel name", { channel: "general", kind: "slack-member" }],
    ["an unknown kind", { kind: "docker", origin: "https://example.com" }],
    ["an extra field", { channel: "C0123456789", kind: "slack-member", origin: "https://example.com" }],
    ["a string", "browser-session:https://example.com"],
    ["null", null],
  ])("refuses %s as a corrupt line, never as absent", (_label, value) => {
    const error = unwrapErr(checkedRecheck({ value }));
    expect(error.message).toContain(RECHECK_SHAPE);
  });
});
