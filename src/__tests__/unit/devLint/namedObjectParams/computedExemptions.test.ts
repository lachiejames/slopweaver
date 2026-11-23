/*
 * `scanNamedObjectParams`'s computed exemptions: type predicates, inherited and inline callbacks, by-reference
 * callbacks matched by symbol, a sole rest parameter and the CLI verb contract, each with the case it must not
 * let through beside it.
 */
import { describe, expect, it, vi } from "vitest";

import { EXEMPT_MARKER } from "../../../../devLint/namedObjectParamsMarkers.js";
import { reportedNames, scanFixture } from "./harness.js";

/** Every case builds a real Program over the full ESNext lib: the same fixed cost `optionsObject.test.ts` names. */
vi.setConfig({ testTimeout: 60_000 });

describe("scanNamedObjectParams — the computed exemptions", () => {
  it("exempts a type predicate and an assertion signature (TS1230 forbids destructuring)", () => {
    const source = [
      "export function isRec(value: unknown): value is { a: string } { return true; }",
      "export function assertRec(value: unknown): asserts value { }",
    ].join("\n");
    expect(reportedNames({ source })).toEqual([]);
  });

  it("exempts an unannotated parameter — a consumer supplied the type, so the list was not authored here", () => {
    const source = ["type Sink = (line: string) => void;", "export const sink: Sink = (line) => {};"].join("\n");
    expect(reportedNames({ source })).toEqual([]);
  });

  it("does NOT exempt an unannotated parameter that has a DEFAULT — strict infers that type locally", () => {
    // The hole this closes: `value` has no annotation, so a "no annotation ⇒ inherited" rule exempted it, but
    // `strict` infers `string` from the initializer with zero diagnostics and no consumer supplied anything.
    // An authored positional parameter was walking straight through the gate.
    expect(reportedNames({ source: 'export function f(value = "x"): string { return value; }' })).toEqual(["f"]);
  });

  it("exempts an inline callback, directly and inside an options object literal", () => {
    // The `declare`d stand-ins carry markers because they play the part of a LIBRARY here — without one the
    // scaffolding would be reported alongside the case under test, which is what a first cut of this did.
    //
    // `opts` is the case that must stay exempt while `Promise.resolve({ run: … })` does not: the difference is
    // that `opts` DECLARES `run` as a function type, so the consumer really did choose that parameter list.
    const source = [
      `// ${EXEMPT_MARKER}: stands in for a library that takes a callback`,
      "declare function take(fn: (a: string) => void): void;",
      "declare function opts(o: { run: (a: string) => void }): void;",
      "take((a: string) => {});",
      "opts({ run: (a: string) => {} });",
    ].join("\n");
    expect(reportedNames({ source })).toEqual([]);
  });

  it("does NOT exempt a literal nested in an object literal passed as an OPAQUE value", () => {
    // The object-literal path resolves the property against the callee's declared type: `Promise.resolve`
    // declares `T | PromiseLike<T>`, which has no `run`, so nothing dictated `run`'s parameter list.
    const source = "export const saved = Promise.resolve({ run: (value: string): string => value });";
    expect(reportedNames({ source })).toEqual(["run"]);
  });

  it("does NOT exempt a literal passed as an OPAQUE value rather than as a callback", () => {
    // `Promise.resolve` declares `value: T | PromiseLike<T>` — it accepts the function, it does not dictate
    // its parameter list. Exempting on "is a call argument" alone let this authored signature through.
    const source = "export const saved = Promise.resolve((value: string): string => value);";
    expect(reportedNames({ source })).toEqual(["(anonymous)"]);
  });

  it("still exempts a literal whose callee DECLARES a function parameter", () => {
    // The other side of the same rule: the distinction is the callee's declared type, not the syntax.
    const source = [
      `// ${EXEMPT_MARKER}: stands in for a library that takes a callback`,
      "declare function take(fn: (a: string) => void): void;",
      "take((a: string) => {});",
    ].join("\n");
    expect(reportedNames({ source })).toEqual([]);
  });

  it("does NOT let the inline-callback walk cross a containing function boundary", () => {
    // The inner arrow is inside the outer callback's BODY, so its shape was nobody else's choice.
    const source = [
      `// ${EXEMPT_MARKER}: stands in for a library that takes a callback`,
      "declare function take(fn: () => unknown): void;",
      "take(() => (inner: string) => inner);",
    ].join("\n");
    expect(reportedNames({ source })).toEqual(["(anonymous)"]);
  });

  it("exempts a named function passed by reference as a callback", () => {
    const source = [
      `// ${EXEMPT_MARKER}: stands in for Node's own on(event, handler)`,
      "declare function on(event: string, handler: (chunk: string) => void): void;",
      "function onData(chunk: string): void {}",
      "on('data', onData);",
    ].join("\n");
    expect(reportedNames({ source })).toEqual([]);
  });

  it("does NOT exempt a named function passed BY REFERENCE as an opaque value", () => {
    // The symmetric case to the inline-callback one: being handed to something is not evidence that the
    // something chose your shape. `Promise.resolve` takes `authored` as an opaque generic value.
    const source = [
      "export function authored(value: string): string { return value; }",
      "export const saved = Promise.resolve(authored);",
    ].join("\n");
    expect(reportedNames({ source })).toEqual(["authored"]);
  });

  it("matches the by-reference exemption by SYMBOL, so a same-named function is not laundered", () => {
    // Keyed by identifier text, the genuine `Array.map(transform)` reference exempted BOTH `transform`s. They
    // share a spelling and nothing else. Only the second — never passed anywhere — should be reported.
    const source = [
      "export function probe(): void {",
      "  {",
      "    function transform(value: string): string { return value; }",
      '    ["callback"].map(transform);',
      "  }",
      "  {",
      "    function transform(authored: string): string { return authored; }",
      "    void transform;",
      "  }",
      "}",
    ].join("\n");
    const { violations } = scanFixture({ source });
    expect(violations).toHaveLength(1);
    expect(violations[0]!.signature).toBe("(authored: string)");
  });

  it("exempts a sole rest parameter — one list cannot be transposed", () => {
    expect(reportedNames({ source: "export function join(...parts: string[]): string { return ''; }" })).toEqual([]);
  });

  it("exempts the CLI verb contract, resolved semantically in either union order", () => {
    // Semantically, not by annotation text: the compiler sees one type for both union orders, so the gate must.
    const source = [
      "export function a(argv: readonly string[]): number | Promise<number> { return 0; }",
      "export function b(argv: readonly string[]): Promise<number> | number { return 0; }",
      "export function c(argv: readonly string[]): number { return 0; }",
    ].join("\n");
    expect(reportedNames({ source })).toEqual([]);
  });

  it("exempts anything merely SHAPED like a verb — the structural limit, pinned so it cannot drift silently", () => {
    // Not an endorsement: `countValues` is no verb and no router registers it, yet it is exempt because the
    // match is structural. Recorded as a test so the limit is a decision on the record rather than a surprise,
    // and so tightening it later produces a deliberate red here instead of a quiet behaviour change.
    const source = "export function countValues(values: readonly string[]): number { return values.length; }";
    expect(reportedNames({ source })).toEqual([]);
  });

  it("does not mistake a mutable string array for the verb contract", () => {
    expect(reportedNames({ source: "export function f(argv: string[]): number { return 0; }" })).toEqual(["f"]);
  });
});
