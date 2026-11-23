/*
 * The repairs register: which seat has taken a stopped recipe. What makes a stop TAKEN is under test here —
 * a take whose row is live — because a take that outlived its seat would read as fixed while nothing is.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import {
  appendRepairTake,
  liveRepairRows,
  parseRepairTake,
  readRepairTakes,
  repairingRows,
  repairingTakeIsos,
  repairRowLiveness,
} from "../../../../live/automation/repairTake.js";
import { stateHomePaths } from "../../../../stateHome.js";

const NOW_ISO = "2026-09-27T15:00:00.000Z";
const LATER_ISO = "2026-09-27T16:00:00.000Z";

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "repair-take-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** A doc for `row` at `status`, and its run journal holding these event kinds. */
function row({ slug, status, events }: { slug: string; status: string; events: readonly string[] }): void {
  const paths = stateHomePaths({ home });
  mkdirSync(paths.handovers, { recursive: true });
  mkdirSync(paths.runs, { recursive: true });
  writeFileSync(join(paths.handovers, `${slug}.md`), `---\nslug: ${slug}\nstatus: ${status}\n---\n# repair\n`);
  const lines = events.map((kind) => {
    if (kind === "started") {
      return JSON.stringify({ atIso: NOW_ISO, branch: "b", docHash: "h", kind });
    }
    return JSON.stringify({ atIso: NOW_ISO, kind, residue: [], summary: "fixed" });
  });
  writeFileSync(join(paths.runs, `${slug}.jsonl`), lines.map((line) => `${line}\n`).join(""));
}

describe("parseRepairTake", () => {
  it("reads a line carrying all three fields", () => {
    expect(parseRepairTake({ value: { recipeId: "a", row: "fix-a", takenIso: NOW_ISO } })).toEqual({
      recipeId: "a",
      row: "fix-a",
      takenIso: NOW_ISO,
    });
  });

  it.each([
    ["an empty row", { recipeId: "a", row: "", takenIso: NOW_ISO }],
    ["no recipe id", { row: "fix-a", takenIso: NOW_ISO }],
    ["a numeric instant", { recipeId: "a", row: "fix-a", takenIso: 1 }],
    ["an array", []],
  ])("reads nothing from %s", (_label, value) => {
    expect(parseRepairTake({ value })).toBe(undefined);
  });
});

describe("appendRepairTake and readRepairTakes", () => {
  it("reads an absent register as no take ever written", () => {
    expect(unwrap(readRepairTakes({ home }))).toEqual({ takes: [], unparsed: [] });
  });

  it("round-trips takes in order, and numbers a line that did not read rather than dropping the rest", () => {
    unwrap(appendRepairTake({ home, take: { recipeId: "a", row: "fix-a", takenIso: NOW_ISO } }));
    writeFileSync(stateHomePaths({ home }).live.recipe.repairsJsonl, '{"recipeId":"b"}\n', { flag: "a" });
    unwrap(appendRepairTake({ home, take: { recipeId: "c", row: "fix-c", takenIso: LATER_ISO } }));

    expect(unwrap(readRepairTakes({ home }))).toEqual({
      takes: [
        { recipeId: "a", row: "fix-a", takenIso: NOW_ISO },
        { recipeId: "c", row: "fix-c", takenIso: LATER_ISO },
      ],
      unparsed: [2],
    });
  });
});

describe("repairingRows", () => {
  it("names the newest take per recipe whose row is live, and nothing for a recipe whose rows all finished", () => {
    const takes = [
      { recipeId: "a", row: "fix-a", takenIso: NOW_ISO },
      { recipeId: "a", row: "fix-a-again", takenIso: LATER_ISO },
      { recipeId: "b", row: "fix-b", takenIso: NOW_ISO },
    ];

    expect([...repairingRows({ liveRows: new Set(["fix-a", "fix-a-again"]), takes })]).toEqual([["a", "fix-a-again"]]);
  });

  it("falls back to an older take whose row is still live when the newer one's row finished", () => {
    const takes = [
      { recipeId: "a", row: "fix-a", takenIso: NOW_ISO },
      { recipeId: "a", row: "fix-a-again", takenIso: LATER_ISO },
    ];

    expect([...repairingRows({ liveRows: new Set(["fix-a"]), takes })]).toEqual([["a", "fix-a"]]);
  });
});

describe("repairingTakeIsos", () => {
  it("dates each recipe by the same take repairingRows picks", () => {
    const takes = [
      { recipeId: "a", row: "fix-a", takenIso: NOW_ISO },
      { recipeId: "a", row: "fix-a-again", takenIso: LATER_ISO },
      { recipeId: "b", row: "fix-b", takenIso: NOW_ISO },
    ];

    expect([...repairingTakeIsos({ liveRows: new Set(["fix-a", "fix-a-again", "fix-b"]), takes })]).toEqual([
      ["a", LATER_ISO],
      ["b", NOW_ISO],
    ]);
    expect([...repairingTakeIsos({ liveRows: new Set(["fix-a"]), takes })]).toEqual([["a", NOW_ISO]]);
  });

  it("orders takes by instant, so an offset stamp that sorts later as text does not win", () => {
    const takes = [
      { recipeId: "a", row: "old", takenIso: "2026-10-13T10:00:00+11:00" },
      { recipeId: "a", row: "new", takenIso: "2026-10-13T00:30:00.000Z" },
    ];

    expect([...repairingTakeIsos({ liveRows: new Set(["old", "new"]), takes })]).toEqual([
      ["a", "2026-10-13T00:30:00.000Z"],
    ]);
  });
});

describe("repairRowLiveness", () => {
  it("admits a ready row whose run a seat started", () => {
    row({ events: ["started"], slug: "fix-a", status: "ready" });
    expect(repairRowLiveness({ home, slug: "fix-a" }).isOk()).toBe(true);
  });

  it("refuses a row whose run closed, which derives it done", () => {
    row({ events: ["started", "closed"], slug: "fix-a", status: "ready" });
    expect(unwrapErr(repairRowLiveness({ home, slug: "fix-a" }))).toEqual({ kind: "terminal", status: "done" });
  });

  it("refuses a row no seat has started, since nothing is repairing it yet", () => {
    row({ events: [], slug: "fix-a", status: "ready" });
    expect(unwrapErr(repairRowLiveness({ home, slug: "fix-a" }))).toEqual({ kind: "run-not-started" });
  });

  it("refuses a cancelled row", () => {
    row({ events: ["started"], slug: "fix-a", status: "cancelled" });
    expect(unwrapErr(repairRowLiveness({ home, slug: "fix-a" }))).toEqual({
      kind: "terminal",
      status: "cancelled",
    });
  });
});

describe("liveRepairRows", () => {
  it("keeps a live row, drops a finished one silently, and names a row that does not read", () => {
    row({ events: ["started"], slug: "fix-a", status: "ready" });
    row({ events: ["started", "closed"], slug: "fix-b", status: "ready" });
    const takes = [
      { recipeId: "a", row: "fix-a", takenIso: NOW_ISO },
      { recipeId: "b", row: "fix-b", takenIso: NOW_ISO },
      { recipeId: "c", row: "no-such-row", takenIso: NOW_ISO },
    ];

    const { live, problems } = liveRepairRows({ home, takes });

    expect([[...live], problems.length]).toEqual([["fix-a"], 1]);
    expect(problems[0]).toContain("repair row no-such-row:");
  });
});
