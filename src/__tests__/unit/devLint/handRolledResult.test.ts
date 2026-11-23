/**
 * The hand-rolled-`Result` gate's own tests: it must catch every spelling of the banned shape that this
 * repository actually contained, and must NOT catch the two shapes error-handling.md deliberately allows.
 */
import { describe, expect, it } from "vitest";
import { isScannablePath, scanHandRolledResult } from "../../../devLint/handRolledResult.js";

/** Scan one snippet as if it were a source file. */
function hits({ content }: { content: string }): readonly string[] {
  return scanHandRolledResult({ content, path: "src/x.ts" }).map((hit) => `${String(hit.line)}`);
}

describe("scanHandRolledResult — the shapes it must catch", () => {
  it("catches the exact shape the survey called a straight violation", () => {
    expect(
      hits({
        content:
          "export type ArgParse =\n  { readonly ok: true; readonly args: A } | { readonly ok: false; readonly errors: readonly string[] };\n",
      }),
    ).toEqual(["1"]);
  });

  it("catches an outcome union whose failure arm carries a reason instead of errors", () => {
    expect(
      hits({
        content:
          "type R = { readonly ok: true; readonly plan: P } | { readonly ok: false; readonly reason: string };\n",
      }),
    ).toEqual(["1"]);
  });

  it("catches a two-armed outcome whose failure arm has no `ok` at all", () => {
    expect(hits({ content: "type StatusOutcome = { readonly ok: true } | { readonly reason: string };\n" })).toEqual([
      "1",
    ]);
  });

  it("catches a lone alias, because the two arms were split across two names three times", () => {
    expect(hits({ content: "type OpenedWorkspace = { readonly ok: true; readonly id: string };\n" })).toEqual(["1"]);
  });

  it("catches an inline return annotation, not just a named alias", () => {
    expect(
      hits({
        content:
          'function f(): { readonly ok: true; readonly v: string } | { readonly ok: false; readonly reason: string } {\n  return err("x");\n}\n',
      }),
    ).toEqual(["1"]);
  });
});

describe("scanHandRolledResult — the shapes it must NOT catch", () => {
  it("allows a plain `ok: boolean` success flag on a record that carries the same payload either way", () => {
    expect(
      hits({ content: "type SyncOutcome = { readonly lines: readonly string[]; readonly ok: boolean };\n" }),
    ).toEqual([]);
  });

  it("allows a provider wire envelope: an interface with `ok: true` and no failure arm", () => {
    expect(
      hits({ content: "export interface SlackSendResult {\n  readonly ok: true;\n  readonly ts: string;\n}\n" }),
    ).toEqual([]);
  });

  it("allows the real thing", () => {
    expect(
      hits({ content: 'import { type Result } from "./result.js";\nexport type ArgParse = Result<A>;\n' }),
    ).toEqual([]);
  });

  it("allows a union with no `ok` member at all", () => {
    expect(
      hits({ content: 'type Kinded = { readonly kind: "a" } | { readonly kind: "b"; readonly why: string };\n' }),
    ).toEqual([]);
  });
});

describe("isScannablePath", () => {
  it("scans the source trees", () => {
    expect(isScannablePath({ path: "src/cli/commands/github/core.ts" })).toBe(true);
    expect(isScannablePath({ path: "eval/x.ts" })).toBe(true);
    expect(isScannablePath({ path: "hooks/y.ts" })).toBe(true);
  });

  it("does not scan its own source, which quotes the banned shape in its documentation", () => {
    expect(isScannablePath({ path: "src/devLint/handRolledResult.ts" })).toBe(false);
  });

  it("does not scan outside the source trees", () => {
    expect(isScannablePath({ path: "docs/architecture.md" })).toBe(false);
  });
});
