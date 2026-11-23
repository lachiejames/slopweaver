import { describe, expect, it } from "vitest";
import { unwrap, unwrapErr } from "#lib/result.js";
import {
  isPushRootRepository,
  isPushRootSha,
  parsePushRootRegistry,
  pushRootForRepository,
  recordPushRoot,
} from "../../../admit/pushRootRegistry.js";

const ROOT = "a".repeat(40);
const OTHER_ROOT = "b".repeat(40);
const RECORDED = "2026-01-02T03:04:05.000Z";
const BINDING = { recordedAtIso: RECORDED, repository: "acme/widgets", rootSha: ROOT };

describe("isPushRootRepository", () => {
  it("accepts owner/name", () => {
    expect(isPushRootRepository({ value: "acme/widgets" })).toBe(true);
  });

  it("refuses a bare name, three segments and a dot segment", () => {
    expect(
      ["widgets", "acme/widgets/extra", "acme/..", "acme/ widgets"].map((value) => isPushRootRepository({ value })),
    ).toEqual([false, false, false, false]);
  });
});

describe("isPushRootSha", () => {
  it("accepts forty lowercase hex", () => {
    expect(isPushRootSha({ value: ROOT })).toBe(true);
  });

  it("refuses an abbreviated, upper-case or SHA-256-length id", () => {
    expect(["a".repeat(12), "A".repeat(40), "a".repeat(64)].map((value) => isPushRootSha({ value }))).toEqual([
      false,
      false,
      false,
    ]);
  });
});

describe("parsePushRootRegistry", () => {
  it("parses a register this module would write", () => {
    expect(unwrap(parsePushRootRegistry({ value: { bindings: [BINDING] } }))).toEqual({ bindings: [BINDING] });
  });

  it("refuses an unknown field, so a hand edit cannot smuggle in a shape the guard ignores", () => {
    const parsed = parsePushRootRegistry({ value: { bindings: [{ ...BINDING, allow: "anything" }] } });

    expect(unwrapErr(parsed).code).toBe("PUSH_ROOT_MALFORMED");
  });

  it("refuses a repository bound twice in different case, rather than letting row order decide", () => {
    const parsed = parsePushRootRegistry({
      value: { bindings: [BINDING, { ...BINDING, repository: "Acme/Widgets", rootSha: OTHER_ROOT }] },
    });

    expect(unwrapErr(parsed).message).toContain("Acme/Widgets is bound more than once");
  });
});

describe("pushRootForRepository", () => {
  it("finds a binding whatever the case of the push's repository", () => {
    expect(pushRootForRepository({ registry: { bindings: [BINDING] }, repository: "ACME/widgets" })).toEqual(BINDING);
  });

  it("finds nothing for a repository never re-cut", () => {
    expect(pushRootForRepository({ registry: { bindings: [BINDING] }, repository: "acme/gadgets" })).toBe(undefined);
  });
});

describe("recordPushRoot", () => {
  it("appends a binding for a new repository", () => {
    expect(unwrap(recordPushRoot({ binding: BINDING, registry: { bindings: [] } }))).toEqual({ bindings: [BINDING] });
  });

  it("returns the very same register for the same root again, keeping the first timestamp", () => {
    const registry = { bindings: [BINDING] };
    const again = recordPushRoot({ binding: { ...BINDING, recordedAtIso: "2026-02-02T00:00:00.000Z" }, registry });

    expect(unwrap(again)).toBe(registry);
  });

  it("refuses a different root for a bound repository, naming the existing binding", () => {
    const refused = recordPushRoot({ binding: { ...BINDING, rootSha: OTHER_ROOT }, registry: { bindings: [BINDING] } });

    expect(unwrapErr(refused).code).toBe("PUSH_ROOT_CONFLICT");
    expect(unwrapErr(refused).existing).toEqual(BINDING);
  });
});
