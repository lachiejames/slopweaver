/*
 * `canonicalJson` — the encoding a calendar write's approval digest is taken over: every object's keys sorted at
 * every depth, an undefined field dropped, and array order kept, so two equal plans encode equally.
 */
import { describe, expect, it } from "vitest";
import { canonicalJson } from "../../../../live/calendar/canonicalJson.js";

describe("canonicalJson", () => {
  it("sorts keys at every depth and drops an undefined field", () => {
    expect(canonicalJson({ value: { z: [{ b: 2, a: 1 }], omitted: undefined, a: "first" } })).toBe(
      '{"a":"first","z":[{"a":1,"b":2}]}',
    );
  });

  it("encodes two objects built in different key orders identically", () => {
    expect(canonicalJson({ value: { kind: "patch", etag: "e1" } })).toBe(
      canonicalJson({ value: { etag: "e1", kind: "patch" } }),
    );
  });

  it("keeps array order, since the order of an attendee list is part of the value", () => {
    expect(canonicalJson({ value: ["b@acme.test", "a@acme.test"] })).toBe('["b@acme.test","a@acme.test"]');
  });

  it("encodes a scalar exactly as JSON does", () => {
    expect(canonicalJson({ value: "acme" })).toBe('"acme"');
    expect(canonicalJson({ value: null })).toBe("null");
  });
});
