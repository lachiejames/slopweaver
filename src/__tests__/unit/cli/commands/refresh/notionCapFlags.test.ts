import { describe, expect, it } from "vitest";

import { notionCapDiagnostics, parseNotionCaps } from "../../../../../cli/commands/refresh/notionCapFlags.js";

describe("parseNotionCaps", () => {
  it("answers every shipped cap, with no time bound, when no cap flag was given", () => {
    const errors: string[] = [];
    expect(parseNotionCaps({ errors, values: {} })).toEqual({
      itemCallBudget: 400,
      itemTimeBudgetMs: undefined,
      maxBlockDepth: 6,
    });
    expect(errors).toEqual([]);
  });

  it("answers each given flag in place of its shipped cap", () => {
    const errors: string[] = [];
    const caps = parseNotionCaps({
      errors,
      values: { "notion-block-depth": "9", "notion-item-calls": "800", "notion-item-time": "30m" },
    });
    expect(caps).toEqual({ itemCallBudget: 800, itemTimeBudgetMs: 1_800_000, maxBlockDepth: 9 });
    expect(errors).toEqual([]);
  });

  it("refuses each malformed value in flag order, and reads each as its shipped cap", () => {
    const errors: string[] = [];
    const caps = parseNotionCaps({
      errors,
      values: { "notion-block-depth": "0", "notion-item-calls": "many", "notion-item-time": "soon" },
    });
    expect(caps).toEqual({ itemCallBudget: 400, itemTimeBudgetMs: undefined, maxBlockDepth: 6 });
    expect(errors.slice(0, 2)).toEqual([
      "--notion-block-depth must be a positive integer",
      "--notion-item-calls must be a positive integer",
    ]);
    expect(errors).toHaveLength(3);
    expect(errors[2]!.startsWith("--notion-item-time ")).toBe(true);
  });
});

describe("notionCapDiagnostics", () => {
  it("says nothing when no cap flag was named", () => {
    const notionCaps = parseNotionCaps({ errors: [], values: {} });
    expect(notionCapDiagnostics({ notionCaps, sources: [], values: {} })).toEqual([]);
  });

  it("refuses a lifted cap with no time bound, and a cap flag with no Notion selected", () => {
    const values = { "notion-item-calls": "800" };
    const notionCaps = parseNotionCaps({ errors: [], values });
    const lines = notionCapDiagnostics({ notionCaps, sources: ["github"], values });
    expect(lines).toHaveLength(2);
    expect(lines[0]!.startsWith("--notion-item-calls only means anything with `--source notion`")).toBe(true);
    expect(lines[1]!.startsWith("lifting --notion-block-depth or --notion-item-calls needs --notion-item-time")).toBe(
      true,
    );
  });

  it("accepts a lifted cap bounded by a time cap on a Notion run", () => {
    const values = { "notion-item-calls": "800", "notion-item-time": "4h" };
    const notionCaps = parseNotionCaps({ errors: [], values });
    expect(notionCapDiagnostics({ notionCaps, sources: ["notion"], values })).toEqual([]);
  });
});
