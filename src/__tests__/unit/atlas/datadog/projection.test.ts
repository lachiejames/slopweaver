import { describe, expect, it } from "vitest";

import { projectDatadogValue } from "../../../../atlas/datadog/projection.js";

describe("projectDatadogValue", () => {
  it("removes a denied field and reports where it was", () => {
    const projected = projectDatadogValue({
      kind: "integrations",
      value: { accountId: "a-1", credentials: { apiKey: "live" } },
    });

    expect(projected.value).toStrictEqual({ accountId: "a-1" });
    expect(projected.dropped).toStrictEqual([{ pointer: "/credentials", reason: "secret-material" }]);
  });

  // The whole reason the walk carries a kind: the same document under two kinds must project differently.
  it("keeps a field under one kind and drops it under another", () => {
    const record = { key: "CASE-14", title: "a case" };

    expect(projectDatadogValue({ kind: "cases", value: record }).value).toStrictEqual(record);
    expect(projectDatadogValue({ kind: "api_key", value: record }).value).toStrictEqual({ title: "a case" });
  });

  it("walks into arrays and nested objects, because a denied field can sit at any depth", () => {
    const projected = projectDatadogValue({
      kind: "integrations",
      value: { accounts: [{ name: "one", secretAccessKey: "x" }, { name: "two" }] },
    });

    expect(projected.value).toStrictEqual({ accounts: [{ name: "one" }, { name: "two" }] });
    expect(projected.dropped).toStrictEqual([{ pointer: "/accounts/0/secretAccessKey", reason: "secret-material" }]);
  });

  // A provider is free to name a field `a/b`, and an unescaped pointer for it is the same string as the
  // pointer for `b` inside `a` — two genuinely different positions collapsing into one.
  it("escapes a pointer segment per RFC 6901 so two positions cannot share one pointer", () => {
    const projected = projectDatadogValue({ kind: "monitor", value: { "a/b": { password: "x" }, "a~c": 1 } });

    expect(projected.dropped).toStrictEqual([{ pointer: "/a~1b/password", reason: "secret-material" }]);
    expect(projected.value).toStrictEqual({ "a/b": {}, "a~c": 1 });
  });

  it("reports the depth bound as its own reason, because a truncation is a defect and not a policy", () => {
    let deep: unknown = { leaf: true };
    for (let level = 0; level < 30; level += 1) {
      deep = { down: deep };
    }
    const projected = projectDatadogValue({ kind: "monitor", value: deep });

    expect(projected.dropped.map((drop) => drop.reason)).toStrictEqual(["depth-limit"]);
  });

  it("stops a cyclic document at the depth bound rather than throwing", () => {
    const cyclic: Record<string, unknown> = { name: "loop" };
    cyclic["self"] = cyclic;
    const projected = projectDatadogValue({ kind: "monitor", value: cyclic });

    // Two positions rather than one: the bound is checked before the node's type is, so both of the
    // record's keys at the last admitted depth are reported.
    expect(projected.dropped.map((drop) => drop.reason)).toStrictEqual(["depth-limit", "depth-limit"]);
  });

  // A `toJSON` serialises to something the walk never inspected, so a denied field reintroduced that way
  // would survive a projection that had visibly dropped it.
  it("projects what a WRITER would serialise, not the object graph it was handed", () => {
    const sneaky = { toJSON: () => ({ password: "reintroduced" }) };
    const projected = projectDatadogValue({ kind: "monitor", value: sneaky });

    expect(projected.value).toStrictEqual({});
    expect(projected.dropped).toStrictEqual([{ pointer: "/password", reason: "secret-material" }]);
  });

  it("drops a function rather than copying it, so the projected value is what would be written", () => {
    const projected = projectDatadogValue({ kind: "monitor", value: { name: "m", run: () => "x" } });

    expect(projected.value).toStrictEqual({ name: "m" });
  });

  it("reports one drop per pointer-and-reason pair, sorted by pointer", () => {
    const projected = projectDatadogValue({
      kind: "integrations",
      value: { z: { password: "1" }, a: { clientSecret: "2" } },
    });

    expect(projected.dropped.map((drop) => drop.pointer)).toStrictEqual(["/a/clientSecret", "/z/password"]);
  });

  // The drop report is EVIDENCE about the value beside it, and the entry worth defeating is the
  // depth-limit drop — the only one that denies a family `synced`.
  it("freezes the report, so a caller cannot quietly delete a truncation from it", () => {
    const projected = projectDatadogValue({ kind: "monitor", value: { password: "x" } });

    expect(Object.isFrozen(projected)).toBe(true);
    expect(Object.isFrozen(projected.dropped)).toBe(true);
    expect(Object.isFrozen(projected.dropped[0])).toBe(true);
  });

  it("passes a primitive and a null through untouched", () => {
    expect(projectDatadogValue({ kind: "monitor", value: 7 }).value).toBe(7);
    expect(projectDatadogValue({ kind: "monitor", value: null }).value).toBe(null);
  });
});
