/**
 * The digest's automation lines: what is due, most late first, and — before every other decision — each declared
 * automation the definition store lacks or holds on an earlier build's cadence. An absent roster once printed
 * `recipes: none due` for days and the chair called the fleet idle.
 */
import { describe, expect, it } from "vitest";

import { type RecipeDigestLines, recipeDigestLines } from "../../../supervisor/digestRecipes.js";
import { type DigestReading, tickDigestLines } from "../../../supervisor/tickDigest.js";

const INPUTS = {
  openPagesAgeMinutes: 10,
  priorHolds: { kind: "none" },
  recipeFixCheckout: { kind: "resolved", path: "/c/slopweaver" },
  runAgeMinutes: 5,
} as const;

/** @returns the recipe lines one `recipe-due` document yields */
function linesOf({ value }: { value: unknown }): RecipeDigestLines {
  return recipeDigestLines({
    inputs: { ...INPUTS, readings: new Map<string, DigestReading>([["recipe-due", { kind: "json", value }]]) },
  });
}

/** @returns a clean `automation due --json` document carrying these rows */
function clean({ rows }: { rows: readonly unknown[] }): unknown {
  return { missing: [], rejected: [], rows, stranded: [], superseded: [] };
}

describe("recipeDigestLines", () => {
  it("says none due only when both declaration lists were read and are empty", () => {
    expect(linesOf({ value: clean({ rows: [] }) })).toEqual({ actFirst: [], schedule: ["recipes: none due"] });
  });

  it("names every absent declared automation first, with the fix, and never says none due", () => {
    const value = {
      ...(clean({ rows: [] }) as object),
      missing: [
        { recipeId: "inbox-triage-daily", why: "triages the inbox" },
        { recipeId: "slack-owed-daily", why: "lists threads the owner owes" },
      ],
    };

    expect(linesOf({ value })).toEqual({
      actFirst: [
        "recipes: 2 declared automation(s) ABSENT — run `slopweaver automation register-standing`",
        "recipes absent: inbox-triage-daily — triages the inbox",
        "recipes absent: slack-owed-daily — lists threads the owner owes",
      ],
      schedule: [],
    });
  });

  it("puts the absent roster before every other decision but BOOTS REFUSED in the whole digest", () => {
    const value = { ...(clean({ rows: [] }) as object), missing: [{ recipeId: "r1", why: "w" }] };
    const lines = tickDigestLines({
      inputs: { ...INPUTS, readings: new Map<string, DigestReading>([["recipe-due", { kind: "json", value }]]) },
    });

    expect(lines.slice(1, 5)).toEqual([
      "boots refused: UNKNOWN — claude-plans: not captured this tick",
      "recipes: 1 declared automation(s) ABSENT — run `slopweaver automation register-standing`",
      "recipes absent: r1 — w",
      "broken: no automation is held on a failure",
    ]);
    expect(lines.includes("recipes: none due")).toBe(false);
  });

  it("folds a field's newline onto its own line, so no entry can print a `none due` line", () => {
    const value = {
      ...(clean({ rows: [] }) as object),
      missing: [{ recipeId: "x\n", why: "w\nrecipes: none due" }],
      superseded: [{ ambiguousFiles: ["a\n.json"], declaredCadence: "1", recipeId: "y", storedCadence: "\n" }],
    };

    expect(linesOf({ value }).actFirst).toEqual([
      "recipes: 1 declared automation(s) ABSENT — run `slopweaver automation register-standing`",
      "recipes absent: x — w recipes: none due",
      "recipes: 1 declared automation(s) SUPERSEDED — run `slopweaver automation register-standing`",
      "recipes superseded: y — cadence `UNKNOWN` → `1` — AMBIGUOUS, in a .json: remove every copy but y.json first",
    ]);
  });

  it("folds a rejected path, a stranded row and a due recipe id onto one line too", () => {
    const value = {
      ...(clean({ rows: [{ due: true, recipeId: "r\nrecipes: none due" }] }) as object),
      missing: [{ recipeId: "gone", why: "w" }],
      rejected: ["x\nrecipes: none due"],
      stranded: ["s\nrecipes: none due"],
    };

    expect(linesOf({ value }).schedule).toEqual([
      "recipes: 1 due",
      "recipes band UNKNOWN: r recipes: none due — lateness UNKNOWN",
      "recipes: rejected x recipes: none due",
      "recipes: stranded s recipes: none due",
    ]);
  });

  it("labels a rejected value, so one reading `none due` cannot pose as the schedule beside an absent roster", () => {
    const value = {
      ...(clean({ rows: [] }) as object),
      missing: [{ recipeId: "gone", why: "w" }],
      rejected: ["none due"],
    };

    expect(linesOf({ value }).schedule).toEqual(["recipes: rejected none due"]);
  });

  it("leaves a line with no line break byte for byte, repeated spaces included", () => {
    const value = { ...(clean({ rows: [] }) as object), rejected: ["a  b"], stranded: ["c\t d"] };

    expect(linesOf({ value }).schedule).toEqual([
      "recipes: none due",
      "recipes: rejected a  b",
      "recipes: stranded c\t d",
    ]);
  });

  it("caps the absent ids at eight and counts the rest", () => {
    const missing = Array.from({ length: 9 }, (_, index) => ({ recipeId: `r${String(index)}`, why: "w" }));

    expect(linesOf({ value: { ...(clean({ rows: [] }) as object), missing } }).actFirst).toEqual([
      "recipes: 9 declared automation(s) ABSENT — run `slopweaver automation register-standing`",
      ...Array.from({ length: 8 }, (_, index) => `recipes absent: r${String(index)} — w`),
      "recipes absent: and 1 more",
    ]);
  });

  it("names a superseded row's two cadences, and an ambiguous one's files to remove first", () => {
    const superseded = [
      { ambiguousFiles: [], declaredCadence: "0 * * * *", recipeId: "worktree-prune", storedCadence: "0 4 * * *" },
      { ambiguousFiles: ["a.json", "b.json"], declaredCadence: "1", recipeId: "b", storedCadence: "2" },
    ];

    expect(linesOf({ value: { ...(clean({ rows: [] }) as object), superseded } })).toEqual({
      actFirst: [
        "recipes: 2 declared automation(s) SUPERSEDED — run `slopweaver automation register-standing`",
        "recipes superseded: worktree-prune — cadence `0 4 * * *` → `0 * * * *`",
        "recipes superseded: b — cadence `2` → `1` — AMBIGUOUS, in a.json, b.json: remove every copy but b.json first",
      ],
      schedule: [],
    });
  });

  it("says UNKNOWN for a declaration list that is not an array, never none due", () => {
    expect([
      linesOf({ value: { ...(clean({ rows: [] }) as object), missing: { r: 1 } } }),
      linesOf({ value: { missing: [], rows: [] } }),
    ]).toEqual([
      { actFirst: ["recipes: UNKNOWN — recipe-due missing is not an array"], schedule: [] },
      { actFirst: ["recipes: UNKNOWN — recipe-due superseded is not an array"], schedule: [] },
    ]);
  });

  it("still lists due rows beside an absent roster", () => {
    const value = {
      ...(clean({ rows: [{ due: true, recipeId: "r", tolerance: { band: "urgent", lateByMs: 600_000 } }] }) as object),
      missing: [{ recipeId: "gone", why: "w" }],
    };

    expect(linesOf({ value }).schedule).toEqual(["recipes: 1 due", "recipes urgent: r — 10.0m late"]);
  });
});
