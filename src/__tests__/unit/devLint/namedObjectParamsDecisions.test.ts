/**
 * The decision stream's completeness and its branch codes: every signature the walk examines yields exactly
 * one row naming the branch that settled it, a marker turns a violation into an accounted row rather than a
 * finding, a redundant marker adds its own row, and observing changes no finding.
 */

import { describe, expect, it, vi } from "vitest";
import { forEachChild, type NodeVisitor, ts, withSourceFile } from "#lib/tsSyntax.js";

import type { NamedObjectParamsDecision } from "../../../devLint/namedObjectParamsDecide.js";
import { EXEMPT_MARKER } from "../../../devLint/namedObjectParamsMarkers.js";
import { FIXTURE, scanFixture } from "../../namedObjectParamsFixture.js";

/** Each case builds a real Program over the full ESNext lib — the fixed cost `namedObjectParamsFixture.ts` names. */
vi.setConfig({ testTimeout: 60_000 });

/** One labelled source per branch, and the 1-based line and display name of the signature that branch decides. */
interface DecisionFixture {
  readonly line: number;
  readonly name: string;
  readonly source: string;
}

/** The library stand-in a callback case needs, itself marker-accounted so it does not add a finding. */
const TAKE = [
  `// ${EXEMPT_MARKER}: stands in for a library that takes a callback`,
  "declare function take(fn: (a: string) => void): void;",
];

/**
 * Every decision the rule can make, each with a fixture that makes it. Keyed by the decision union, so a new
 * branch that has no fixture fails to compile rather than going unwitnessed.
 */
const DECISION_FIXTURES: Readonly<Record<NamedObjectParamsDecision, DecisionFixture>> = {
  "compliant-declaration-arity": { line: 1, name: "m", source: "export interface I { m(a: string): void }" },
  "compliant-destructured": {
    line: 1,
    name: "f",
    source: "export function f({ a }: { a: string }): string { return a; }",
  },
  "compliant-options-object": {
    line: 2,
    name: "g",
    source: ["interface Opts { a: string }", "export function g(o: Opts): string { return o.a; }"].join("\n"),
  },
  "compliant-zero-parameters": { line: 1, name: "now", source: "export function now(): number { return 1; }" },
  "exempt-inherited": { line: 1, name: "(anonymous)", source: "export const xs = [1].map((n) => n + 1);" },
  "exempt-inline-callback": { line: 3, name: "(anonymous)", source: [...TAKE, "take((a: string) => {});"].join("\n") },
  "exempt-passed-by-reference": {
    line: 3,
    name: "onData",
    source: [
      `// ${EXEMPT_MARKER}: stands in for Node's own on(event, handler)`,
      "declare function on(event: string, handler: (chunk: string) => void): void;",
      "function onData(chunk: string): void {}",
      "on('data', onData);",
    ].join("\n"),
  },
  "exempt-predicate": {
    line: 1,
    name: "isText",
    source: "export function isText(x: unknown): x is string { return typeof x === 'string'; }",
  },
  "exempt-sole-rest": {
    line: 1,
    name: "join",
    source: "export function join(...parts: string[]): string { return parts.join(''); }",
  },
  "exempt-verb-contract": {
    line: 1,
    name: "verb",
    source: "export function verb(argv: readonly string[]): number { return argv.length; }",
  },
  "marker-accounted-arity": {
    line: 2,
    name: "pair",
    source: [
      `// ${EXEMPT_MARKER}: a library dictates this shape`,
      "export function pair(a: string, b: string): void {}",
    ].join("\n"),
  },
  "marker-accounted-not-options-object": {
    line: 2,
    name: "day",
    source: [`// ${EXEMPT_MARKER}: a library dictates this shape`, "export function day(d: Date): void {}"].join("\n"),
  },
  "redundant-marker": {
    line: 1,
    name: "",
    source: [
      `// ${EXEMPT_MARKER}: a reason for a signature that needs none`,
      "export function now(): number { return 1; }",
    ].join("\n"),
  },
  "violation-arity": { line: 1, name: "pair", source: "export function pair(a: string, b: string): void {}" },
  "violation-not-options-object": { line: 1, name: "day", source: "export function day(d: Date): void {}" },
};

/** The registry as rows, for the cases that sweep it. */
const CASES = Object.entries(DECISION_FIXTURES) as readonly (readonly [NamedObjectParamsDecision, DecisionFixture])[];

/** One observed scan per decision fixture, shared by every case that reads it: each scan builds a Program. */
const OBSERVED = new Map<NamedObjectParamsDecision, ReturnType<typeof scanFixture>>();

/** The observed scan of one decision's fixture, built once. */
function observedScan({ decision }: { decision: NamedObjectParamsDecision }): ReturnType<typeof scanFixture> {
  const cached = OBSERVED.get(decision);
  if (cached !== undefined) {
    return cached;
  }
  const scan = scanFixture({ observe: true, source: DECISION_FIXTURES[decision].source });
  OBSERVED.set(decision, scan);
  return scan;
}

/** Every node kind the rule treats as a signature, counted independently of the scanner's own walk. */
const SIGNATURE_KINDS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.FunctionExpression,
  ts.SyntaxKind.ArrowFunction,
  ts.SyntaxKind.MethodDeclaration,
  ts.SyntaxKind.MethodSignature,
  ts.SyntaxKind.FunctionType,
  ts.SyntaxKind.CallSignature,
  ts.SyntaxKind.ConstructSignature,
]);

/** How many signature nodes a source holds, by a walk of its own. */
function signatureCount({ source }: { source: string }): number {
  return withSourceFile({
    fileName: FIXTURE,
    text: source,
    use: (sf) => {
      let count = 0;
      const visit: NodeVisitor = (node) => {
        if (SIGNATURE_KINDS.has(node.kind)) {
          count += 1;
        }
        forEachChild({ node, visit });
      };
      visit(sf);
      return count;
    },
  });
}

describe("the named-object-params decision stream", () => {
  it("has a fixture for every decision the rule can make", () => {
    expect(CASES.length).toBeGreaterThan(0);
    expect(CASES.length).toBe(15);
  });

  it.each(CASES)("decides %s at its fixture's signature", (decision, fixture) => {
    const { diagnostics, rows } = observedScan({ decision });
    expect(diagnostics).toBe(0);
    const at = rows.filter((row) => row.line === fixture.line && row.name === fixture.name);
    expect(at.map((row) => row.decision)).toEqual([decision]);
  });

  it("emits exactly one signature decision for every signature the walk examines", () => {
    expect(CASES.length).toBeGreaterThan(0);
    const counts = CASES.map(([decision]) => {
      const { rows } = observedScan({ decision });
      return { decision, rows: rows.filter((row) => row.kind === "signature").length };
    });
    const expected = CASES.map(([decision, fixture]) => ({
      decision,
      rows: signatureCount({ source: fixture.source }),
    }));
    expect(counts).toEqual(expected);
  });

  it("writes every row of one fixture exactly — walk order, 1-based line and column, collapsed parameter text", () => {
    const source = [
      "export interface I {",
      "  m(a: string): void;",
      "}",
      "export function pair(",
      "  a: string,",
      "  b: string,",
      "): void {}",
      "export const xs = [1].map((n) => n + 1);",
      `// ${EXEMPT_MARKER}: a reason for a signature that needs none`,
      "export function now(): number { return 1; }",
    ].join("\n");
    const { rows } = scanFixture({ observe: true, source });
    expect(rows).toEqual([
      {
        column: 3,
        decision: "compliant-declaration-arity",
        kind: "signature",
        line: 2,
        name: "m",
        path: FIXTURE,
        signature: "(a: string)",
      },
      {
        column: 1,
        decision: "violation-arity",
        kind: "signature",
        line: 4,
        name: "pair",
        path: FIXTURE,
        signature: "(a: string, b: string)",
      },
      {
        column: 27,
        decision: "exempt-inherited",
        kind: "signature",
        line: 8,
        name: "(anonymous)",
        path: FIXTURE,
        signature: "(n)",
      },
      {
        column: 1,
        decision: "compliant-zero-parameters",
        kind: "signature",
        line: 10,
        name: "now",
        path: FIXTURE,
        signature: "()",
      },
      {
        column: 1,
        decision: "redundant-marker",
        kind: "marker",
        line: 9,
        name: "",
        path: FIXTURE,
        signature: `// ${EXEMPT_MARKER}: a reason for a signature that needs none`,
      },
    ]);
  });

  it.each([
    ["CR", "\r"],
    ["CRLF", "\r\n"],
    ["U+2028", String.fromCharCode(0x2028)],
  ])("numbers %s-terminated lines as TypeScript does, so a marker there is leaned on or reported", (_, eol) => {
    // An LF-only split merged a CR-only file into one line, so neither marker below was seen.
    const source = [
      `// ${EXEMPT_MARKER}: a library dictates this shape`,
      "export function pair(a: string, b: string): void {}",
      `// ${EXEMPT_MARKER}: a reason for a signature that needs none`,
      "export function now(): number { return 1; }",
      "",
    ].join(eol);
    const { rows, violations } = scanFixture({ observe: true, source });
    expect(violations.map((violation) => [violation.line, violation.rule])).toEqual([[3, "redundant-marker"]]);
    expect(rows.map((row) => [row.kind, row.line, row.decision])).toEqual([
      ["signature", 2, "marker-accounted-arity"],
      ["signature", 4, "compliant-zero-parameters"],
      ["marker", 3, "redundant-marker"],
    ]);
  });

  it("emits an accounted decision instead of a finding for each effective marker", () => {
    const source = [
      `// ${EXEMPT_MARKER}: a library dictates this shape`,
      "export function pair(a: string, b: string): void {}",
      `// ${EXEMPT_MARKER}: a library dictates this shape`,
      "export function day(d: Date): void {}",
    ].join("\n");
    const { rows, violations } = scanFixture({ observe: true, source });
    expect(violations).toEqual([]);
    expect(rows.map((row) => [row.kind, row.line, row.decision])).toEqual([
      ["signature", 2, "marker-accounted-arity"],
      ["signature", 4, "marker-accounted-not-options-object"],
    ]);
  });

  it("emits a redundant-marker row in addition to the signature decision it failed to affect", () => {
    const source = [
      `// ${EXEMPT_MARKER}: TS1230 forbids destructuring a type-predicate parameter`,
      "export function isText(x: unknown): x is string { return typeof x === 'string'; }",
    ].join("\n");
    const { rows, violations } = scanFixture({ observe: true, source });
    expect(violations.map((v) => [v.line, v.rule])).toEqual([[1, "redundant-marker"]]);
    expect(rows.map((row) => [row.kind, row.line, row.decision])).toEqual([
      ["signature", 2, "exempt-predicate"],
      ["marker", 1, "redundant-marker"],
    ]);
  });

  it("preserves the planted violation rows while decisions are observed", () => {
    expect(CASES.length).toBeGreaterThan(0);
    const observed = CASES.map(([decision]) => observedScan({ decision }).violations);
    const plain = CASES.map(([, fixture]) => scanFixture({ source: fixture.source }).violations);
    expect(observed).toEqual(plain);
    expect(plain.flat().map((v) => [v.name, v.rule])).toEqual([
      ["", "redundant-marker"],
      ["pair", "arity"],
      ["day", "not-an-options-object"],
    ]);
  });

  it("builds no row when nothing observes", () => {
    const { rows, violations } = scanFixture({ source: "export function pair(a: string, b: string): void {}" });
    expect(rows).toEqual([]);
    expect(violations.map((v) => v.rule)).toEqual(["arity"]);
  });
});
