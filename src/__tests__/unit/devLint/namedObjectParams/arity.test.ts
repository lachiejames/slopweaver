/*
 * `scanNamedObjectParams`'s arity limit: a second parameter on an implementation or a declared signature is
 * reported, a declared signature's single non-object parameter and a zero-parameter function are not.
 */
import { describe, expect, it, vi } from "vitest";

import { reportedNames, scanFixture } from "./harness.js";

/** Every case builds a real Program over the full ESNext lib: the same fixed cost `optionsObject.test.ts` names. */
vi.setConfig({ testTimeout: 60_000 });

describe("scanNamedObjectParams — arity", () => {
  it("reports a second parameter on an implementation, tagged `arity`", () => {
    const { violations } = scanFixture({ source: "export function f(a: string, b: string): void {}" });
    expect(violations).toHaveLength(1);
    expect(violations[0]!.rule).toBe("arity");
    expect(violations[0]!.line).toBe(1);
  });

  it("reports a second parameter on a DECLARED signature", () => {
    expect(reportedNames({ source: "export type F = (cursor: string, limit: number) => void;" })).toEqual(["F"]);
  });

  it("allows a declared signature's single non-object parameter — declarations carry only the arity limit", () => {
    // `(line: string) => void` is a fine callback contract. Extending the object rule here would ban every
    // callback type in the repo, which is NOT what the rule says.
    expect(reportedNames({ source: "export type Sink = (line: string) => void;" })).toEqual([]);
  });

  it("allows a zero-parameter function", () => {
    expect(reportedNames({ source: "export function f(): void {}" })).toEqual([]);
  });
});
