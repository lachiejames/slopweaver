/*
 * `scanNamedObjectParams`'s options-object predicate: the labelled accept/reject table, the `Date` trap a
 * class-symbol check sails past, and a defaulted destructure read as the AST shape it is.
 */
import { describe, expect, it, vi } from "vitest";

import { reportedNames, scanFixture } from "./harness.js";

/**
 * A generous per-test timeout, because every case here builds its own TypeScript program with the FULL
 * `lib.esnext.full.d.ts` — the rule needs resolved types to decide whether a parameter is an options bag, so a
 * bare `createSourceFile` will not do. Locally the whole file is ~6s across 35 cases; the first case pays the
 * cold lib load alone and measured over 5s on a CI runner, which the default 5s timeout then failed. Not a slow
 * test to speed up: a fixed cost the default was always going to sit too close to.
 */
vi.setConfig({ testTimeout: 60_000 });

/**
 * The labelled predicate table: one function per case, each taking a sole annotated parameter, named for the
 * verdict the rule requires. Nothing here is exempt by any other rule — no predicate, no callback, every
 * parameter annotated — so the P-B ("is this an options object?") decision is the only thing under test.
 */
const PREDICATE_FIXTURE = `
interface Rec { a: string; k: number }
interface Empty {}
type Mapped = { [K in keyof Rec]: string };
type Cond = string extends string ? Rec : never;
enum Colour { Red }

// --- ACCEPT: a bag whose field names tell a caller what is available ---
export function acceptInline(o: { a: string }): void {}
export function acceptPartial(o: Partial<Rec>): void {}
export function acceptOmit(o: Omit<Rec, "k">): void {}
export function acceptRequired(o: Required<Rec>): void {}
export function acceptMapped(o: Mapped): void {}
export function acceptConditional(o: Cond): void {}
export function acceptIntersection(o: Rec & { b: number }): void {}
export function acceptOptionalUnion(o: Rec | undefined): void {}
export function acceptConstrainedParam<T extends Rec>(o: T): void {}
export function acceptRecordUnknown(o: Record<string, unknown>): void {}
export function acceptRecordString(o: Record<string, string>): void {}
export function acceptDefaultedDestructure({ a }: { a?: string } = {}): void {}

// --- REJECT: a value you pass, which names nothing ---
export function rejectString(o: string): void {}
export function rejectNumber(o: number): void {}
export function rejectBranded(o: string & { __brand: "x" }): void {}
export function rejectDate(o: Date): void {}
export function rejectMap(o: Map<string, string>): void {}
export function rejectUrl(o: URL): void {}
export function rejectUint8Array(o: Uint8Array): void {}
export function rejectObject(o: object): void {}
export function rejectEmptyInterface(o: Empty): void {}
export function rejectEnum(o: Colour): void {}
export function rejectUnconstrainedParam<T>(o: T): void {}
export function rejectUnknown(o: unknown): void {}
export function rejectTuple(o: [string, number]): void {}
export function rejectCallable(o: () => void): void {}
`;

describe("scanNamedObjectParams — the options-object predicate", () => {
  it("reports exactly the reject cases and none of the accept cases", () => {
    // One exact assertion over the whole labelled table: every `reject*` case is caught, in source order,
    // and no `accept*` case is. A permissive predicate fails this, and so does an over-strict one.
    expect(reportedNames({ source: PREDICATE_FIXTURE })).toEqual([
      "rejectString",
      "rejectNumber",
      "rejectBranded",
      "rejectDate",
      "rejectMap",
      "rejectUrl",
      "rejectUint8Array",
      "rejectObject",
      "rejectEmptyInterface",
      "rejectEnum",
      "rejectUnconstrainedParam",
      "rejectUnknown",
      "rejectTuple",
      "rejectCallable",
    ]);
  });

  it("reports `Date` — the trap a class-symbol check sails past, because lib declares it as an interface", () => {
    // Kept as its own case because a first cut of this scanner reported `toYyyyMmDd(date: Date)` COMPLIANT.
    const { violations } = scanFixture({ source: "export function f(date: Date): string { return ''; }" });
    expect(violations).toHaveLength(1);
    expect(violations[0]!.name).toBe("f");
    expect(violations[0]!.rule).toBe("not-an-options-object");
    expect(violations[0]!.signature).toBe("(date: Date)");
  });

  it("accepts a defaulted destructure — an AST shape, not a violation", () => {
    expect(reportedNames({ source: "export function f({ cwd = 'x' }: { cwd?: string } = {}): void {}" })).toEqual([]);
  });
});
