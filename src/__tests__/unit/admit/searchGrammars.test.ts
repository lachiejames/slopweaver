/**
 * Which option grammars a search program's name is read by, and which options print and exit under each — the
 * tables `searchWords` walks (a bare `grep` is two programs).
 */
import { describe, expect, it } from "vitest";

import { grammarsFor, longPrintsAndExits, shortPrintsAndExits } from "../../../admit/searchGrammars.js";

describe("grammarsFor", () => {
  it("reads a bare grep under ugrep's table AND BSD grep's measured one", () => {
    const [ugrep, bsd] = grammarsFor({ binary: "grep" });
    expect(grammarsFor({ binary: "grep" }).length).toBe(2);
    expect(ugrep!.valueShort.has("O")).toBe(true);
    expect(ugrep!.known).toBeUndefined();
    expect(bsd!.valueShort.has("O")).toBe(false);
    expect(bsd!.known!.short.has("O")).toBe(true);
    expect(bsd!.known!.short.has("K")).toBe(false);
  });

  it("reads ugrep and ug by ugrep's table alone, and rg by its own", () => {
    expect(grammarsFor({ binary: "ugrep" }).length).toBe(1);
    expect(grammarsFor({ binary: "ug" }).length).toBe(1);
    const [rg] = grammarsFor({ binary: "rg" });
    expect(rg!.grepFamily).toBe(false);
    expect(rg!.valueShort.has("r")).toBe(true);
  });

  it("knows no grammar for a program that is not a search", () => {
    expect(grammarsFor({ binary: "find" })).toEqual([]);
  });
});

describe("print-and-exit options", () => {
  const [ugrep] = grammarsFor({ binary: "ugrep" });
  const [rg] = grammarsFor({ binary: "rg" });

  it("reads -V and -? everywhere, and -h only for rg, where grep's -h is --no-filename", () => {
    expect(shortPrintsAndExits({ grammar: ugrep!, letter: "V" })).toBe(true);
    expect(shortPrintsAndExits({ grammar: ugrep!, letter: "?" })).toBe(true);
    expect(shortPrintsAndExits({ grammar: ugrep!, letter: "h" })).toBe(false);
    expect(shortPrintsAndExits({ grammar: rg!, letter: "h" })).toBe(true);
  });

  it("reads rg's own print-and-exit longs, and a grep-family prefix of --version", () => {
    expect(longPrintsAndExits({ grammar: rg!, name: "--pcre2-version" })).toBe(true);
    expect(longPrintsAndExits({ grammar: rg!, name: "--type-list" })).toBe(true);
    expect(longPrintsAndExits({ grammar: ugrep!, name: "--type-list" })).toBe(false);
    expect(longPrintsAndExits({ grammar: ugrep!, name: "--vers" })).toBe(true);
    expect(longPrintsAndExits({ grammar: rg!, name: "--vers" })).toBe(false);
  });
});
