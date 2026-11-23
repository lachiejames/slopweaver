/*
 * The named-object-params exemption marker: when one exempts the signature below it, when it is refused or
 * reported redundant, and how `deliberateMarkerLines` and `isMarkerLine` read a marker comment.
 */
import { describe, expect, it, vi } from "vitest";

import { deliberateMarkerLines, EXEMPT_MARKER, isMarkerLine } from "../../../../devLint/namedObjectParamsMarkers.js";
import { reportedNames, scanFixture } from "./harness.js";

/** Every case builds a real Program over the full ESNext lib: the same fixed cost `optionsObject.test.ts` names. */
vi.setConfig({ testTimeout: 60_000 });

describe("scanNamedObjectParams — an exemption the AST decides still leaves its marker redundant", () => {
  it("reports a marker above an unannotated callback, whose shape a consumer already chose", () => {
    const source = [
      `// ${EXEMPT_MARKER}: stands in for a library's on(event, handler)`,
      "declare function take(handler: (value: string) => void): void;",
      `// ${EXEMPT_MARKER}: the consumer chose this shape`,
      "take((value) => {});",
    ].join("\n");
    const { violations } = scanFixture({ source });
    expect(violations.map((v) => `${v.rule}@${v.line}`)).toEqual(["redundant-marker@3"]);
  });

  it("reports a marker above a sole rest parameter", () => {
    const source = [
      `// ${EXEMPT_MARKER}: one list cannot be transposed`,
      "export function join(...parts: string[]): string { return parts.join(''); }",
    ].join("\n");
    const { violations } = scanFixture({ source });
    expect(violations.map((v) => `${v.rule}@${v.line}`)).toEqual(["redundant-marker@1"]);
  });
});

describe("scanNamedObjectParams — the inline marker", () => {
  it("exempts a signature when the line DIRECTLY above carries a marker with a reason", () => {
    const source = [`// ${EXEMPT_MARKER}: a library dictates this shape`, "export function f(a: string): void {}"].join(
      "\n",
    );
    expect(reportedNames({ source })).toEqual([]);
  });

  it("refuses a BARE marker — the reason is the whole point of making the exception visible", () => {
    const source = [`// ${EXEMPT_MARKER}`, "export function f(a: string): void {}"].join("\n");
    expect(reportedNames({ source })).toEqual(["f"]);
  });

  it("refuses a marker with an empty reason", () => {
    const source = [`// ${EXEMPT_MARKER}:   `, "export function f(a: string): void {}"].join("\n");
    expect(reportedNames({ source })).toEqual(["f"]);
  });

  it("refuses a marker two lines above", () => {
    const source = [
      `// ${EXEMPT_MARKER}: a real reason, but on the wrong line`,
      "// an intervening comment",
      "export function f(a: string): void {}",
    ].join("\n");
    // The signature is still refused, and the stranded marker is itself reported (name "") at its own line.
    expect(reportedNames({ source })).toEqual(["", "f"]);
  });

  it("refuses the marker's text inside a string literal", () => {
    // Otherwise this gate's own tests, and the rule's documentation, would exempt whatever followed them.
    const source = [
      `const doc = "${EXEMPT_MARKER}: not a real exemption";`,
      "export function f(a: string): void {}",
    ].join("\n");
    expect(reportedNames({ source })).toEqual(["f"]);
  });
});

describe("scanNamedObjectParams — a marker that exempts nothing", () => {
  it("reports a marker above a type predicate, which the gate already exempts", () => {
    const source = [
      `// ${EXEMPT_MARKER}: TS1230 forbids destructuring a type-predicate parameter`,
      "export function isRec(value: unknown): value is { a: string } { return true; }",
    ].join("\n");
    const { violations } = scanFixture({ source });
    expect(violations.map((v) => `${v.rule}@${v.line}`)).toEqual(["redundant-marker@1"]);
  });

  it("reports a marker above a signature that already takes a destructured options object", () => {
    const source = [
      `// ${EXEMPT_MARKER}: a reason for a signature that needs none`,
      "export function f({ a }: { a: string }): void {}",
    ].join("\n");
    const { violations } = scanFixture({ source });
    expect(violations.map((v) => `${v.rule}@${v.line}`)).toEqual(["redundant-marker@1"]);
  });

  it("reports a marker that is not on the line directly above any signature", () => {
    const source = [
      `// ${EXEMPT_MARKER}: a real reason, but a doc comment sits between it and the signature`,
      "/** Whether the value is a record. */",
      "export function isRec(value: unknown): value is { a: string } { return true; }",
    ].join("\n");
    const { violations } = scanFixture({ source });
    expect(violations.map((v) => `${v.rule}@${v.line}`)).toEqual(["redundant-marker@1"]);
  });

  it("keeps a marker that is the only thing exempting a two-parameter declared signature", () => {
    const source = [
      `// ${EXEMPT_MARKER}: mirrors a library's own two-argument signature`,
      "export type Graphql = (query: string, variables: Record<string, unknown>) => Promise<unknown>;",
    ].join("\n");
    const { violations } = scanFixture({ source });
    expect(violations).toEqual([]);
  });

  it("does not read a marker inside a template literal as a marker", () => {
    const source = [
      "export const fixture = `",
      `// ${EXEMPT_MARKER}: text inside a template literal is not a comment`,
      "function f(a: string): void {}",
      "`;",
    ].join("\n");
    const { violations } = scanFixture({ source });
    expect(violations).toEqual([]);
  });

  it("does not read a marker inside a backslash-continued string literal as a marker", () => {
    const source = ['export const fixture = "\\', `// ${EXEMPT_MARKER}: prose inside a string\\`, '";'].join("\n");
    const { violations } = scanFixture({ source });
    expect(violations).toEqual([]);
  });

  it("names the marker's own line and carries its reason, so the line to delete is findable", () => {
    const source = [
      "export const keep = 1;",
      `// ${EXEMPT_MARKER}: the reason that does nothing`,
      "export function isRec(value: unknown): value is { a: string } { return true; }",
    ].join("\n");
    const found = scanFixture({ source }).violations[0]!;
    expect({ line: found.line, name: found.name, signature: found.signature }).toEqual({
      line: 2,
      name: "",
      signature: `// ${EXEMPT_MARKER}: the reason that does nothing`,
    });
  });
});

describe("deliberateMarkerLines", () => {
  it("lists a comment that opens with the marker, and skips prose that merely mentions it", () => {
    const lines = [
      `// ${EXEMPT_MARKER}: a deliberate one`,
      `// see ${EXEMPT_MARKER}: for the rule this gate enforces`,
      ` * ${EXEMPT_MARKER}: also deliberate, inside a block comment`,
      `const x = "${EXEMPT_MARKER}: a string";`,
      `// ${EXEMPT_MARKER}:`,
    ];
    expect(deliberateMarkerLines({ lines })).toEqual([0, 2]);
  });

  it("does not read a line carrying an interior line terminator as one marker comment", () => {
    const terminators = ["\n", "\r", String.fromCharCode(0x2028), String.fromCharCode(0x2029)];
    for (const terminator of terminators) {
      expect(isMarkerLine({ line: `// x${terminator}${EXEMPT_MARKER}: a reason` })).toBe(false);
    }
    expect(isMarkerLine({ line: `// ${EXEMPT_MARKER}: a reason` })).toBe(true);
  });

  it("still lets prose that mentions the marker exempt the line below it", () => {
    expect(isMarkerLine({ line: `// see ${EXEMPT_MARKER}: for the rule this gate enforces` })).toBe(true);
  });
});
