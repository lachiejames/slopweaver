/*
 * `scanNamedObjectParams`'s by-reference prefilter: every shape where the identifier-text prefilter and the
 * checker symbol could part company, pinned to the verdict the symbol alone gives.
 */
import { describe, expect, it, vi } from "vitest";

import { EXEMPT_MARKER } from "../../../../devLint/namedObjectParamsMarkers.js";
import { reportedNames } from "./harness.js";

/** Every case builds a real Program over the full ESNext lib: the same fixed cost `optionsObject.test.ts` names. */
vi.setConfig({ testTimeout: 60_000 });

/**
 * The by-reference exemption finds its candidates by identifier TEXT and decides by checker SYMBOL. These pin
 * every shape where the two could part company, each to the verdict the symbol-only scan gave before the text
 * prefilter existed — so a prefilter that ever widens or narrows the exemption reddens here.
 */
describe("scanNamedObjectParams — the by-reference prefilter decides nothing the symbol does not", () => {
  const TAKE = [
    `// ${EXEMPT_MARKER}: stands in for a library's on(event, handler)`,
    "declare function take(handler: (value: string) => void): void;",
  ];

  it("does NOT exempt a function handed over through an ALIAS — the argument's symbol is the alias's", () => {
    const source = [
      ...TAKE,
      "function original(value: string): void {}",
      "const alias = original;",
      "take(alias);",
    ].join("\n");
    expect(reportedNames({ source })).toEqual(["original"]);
  });

  it("does NOT exempt a function handed over as an object SHORTHAND — only a bare argument is a reference", () => {
    const source = [
      "declare function take(options: { handler: (value: string) => void }): void;",
      "function handler(value: string): void {}",
      "take({ handler });",
    ].join("\n");
    expect(reportedNames({ source })).toEqual(["handler"]);
  });

  it("does NOT exempt a function handed to a CONSTRUCTOR by reference — only a call's arguments are read", () => {
    const source = [
      "declare class Box { constructor(handler: (value: string) => void); }",
      "function handler(value: string): void {}",
      "export const box = new Box(handler);",
    ].join("\n");
    expect(reportedNames({ source })).toEqual(["handler"]);
  });

  it("exempts a function whose name is spelled with a unicode escape — the prefilter reads the normalised text", () => {
    const source = [...TAKE, "function \\u0061bc(value: string): void {}", "take(abc);"].join("\n");
    expect(reportedNames({ source })).toEqual([]);
  });

  it("exempts an arrow bound to a const and handed over by reference", () => {
    const source = [...TAKE, "const onValue = (value: string): void => {};", "take(onValue);"].join("\n");
    expect(reportedNames({ source })).toEqual([]);
  });
});
