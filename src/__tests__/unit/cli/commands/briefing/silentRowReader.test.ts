/**
 * The briefing's adapter over the shared silent-row join: a reading's `.silent` passes through, and EVERY
 * read failure becomes the empty list — the gate it feeds can only add a refusal, so an unmeasurable store
 * must leave it silent. The underlying reader's own test proves that failure is an `err`.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { silentRecipeRows } from "../../../../../cli/commands/briefing/silentRowReader.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { readSilentRecipeRows } from "../../../../../live/automation/silentRowReader.js";
import { stateHomePaths } from "../../../../../stateHome.js";
import { dailyRow, stampRecipeRuns, writeRecipeDefinitions } from "../../../live/automation/recipeHome.js";

const NOW = "2026-09-18T12:00:00.000Z";

/** Three daily slots ago — two whole slots have gone by unrun, past the daily threshold of one. */
const STALE = "2026-09-15T09:30:00.000Z";

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "briefsilent-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("silentRecipeRows", () => {
  it("answers the empty list for a home with no recipe store", () => {
    expect(silentRecipeRows({ home, nowIso: NOW })).toEqual([]);
  });

  it("answers the reading's silent rows when a live row's slots went by unrun", () => {
    writeRecipeDefinitions({ home, rows: [dailyRow()] });
    stampRecipeRuns({ home, stamps: { "vulnfix-digest-acme-admin": STALE } });

    const rows = silentRecipeRows({ home, nowIso: NOW });

    expect(rows.map((row) => [row.recipeId, row.reason, row.missedSlots])).toEqual([
      ["vulnfix-digest-acme-admin", "MISSED", 2],
    ]);
    expect(rows).toEqual(unwrap(readSilentRecipeRows({ home, nowIso: NOW })).silent);
  });

  it("answers the empty list, not a refusal, when the run stamps will not parse", () => {
    writeRecipeDefinitions({ home, rows: [dailyRow()] });
    const path = stateHomePaths({ home }).live.recipe.definitionRunsJson;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "{ not json", "utf8");

    expect(unwrapErr(readSilentRecipeRows({ home, nowIso: NOW })).join(" ")).toContain(path);
    expect(silentRecipeRows({ home, nowIso: NOW })).toEqual([]);
  });
});
