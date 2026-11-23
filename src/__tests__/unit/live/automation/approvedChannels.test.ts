/**
 * `live/automation/approvedChannels.ts` over a throwaway home — the effectful shell the door's half of owner
 * turn 291-8x reads, exercised against the real definition store rather than a restatement of it.
 *
 * A round-trip through a `mkdtempSync` directory is what `.claude/rules/testing.md` allows here and what
 * this function needs: its whole job is reading files, and every interesting case (an absent directory, a
 * row nobody can parse) is a property of that read.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { approvedScheduledChannelsOf } from "../../../../live/automation/approvedChannels.js";
import { RECIPE_DEFINITION_SCHEMA_VERSION } from "../../../../live/automation/definition.js";

const homes: string[] = [];

afterEach(() => {
  homes.splice(0).forEach((home) => {
    rmSync(home, { force: true, recursive: true });
  });
});

/** A home carrying the given definition files, written as the store reads them. */
function homeWith({ rows }: { rows: readonly Record<string, unknown>[] }): string {
  const home = mkdtempSync(join(tmpdir(), "ac-"));
  homes.push(home);
  const dir = join(home, "live", "recipe", "definitions");
  mkdirSync(dir, { recursive: true });
  rows.forEach((entry, index) => {
    writeFileSync(join(dir, `row-${String(index)}.json`), JSON.stringify(entry), "utf8");
  });
  return home;
}

/** One parsable row, overridable field by field. */
function row(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    cadence: "0 9 * * *",
    destination: { kind: "slack" },
    effect: "read-write",
    kind: "verb-run",
    params: { argv: ["atlas", "freshness"] },
    recipeId: "atlas-rolling-window",
    schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
    ...over,
  };
}

/** One recorded approval, overridable field by field. */
function approval(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    atIso: "2026-09-21T04:00:00.000Z",
    channel: "C0TEAM",
    dmChannel: "D0SYNOWNERDM",
    ts: "1758424800.000100",
    ...over,
  };
}

describe("approvedScheduledChannelsOf", () => {
  it("answers an EMPTY list for a home with no definitions directory at all", () => {
    const home = mkdtempSync(join(tmpdir(), "ac-"));
    homes.push(home);
    expect(approvedScheduledChannelsOf({ home })).toEqual([]);
  });

  it("answers an EMPTY list when no row records an approval, so nothing public is admitted by default", () => {
    expect(approvedScheduledChannelsOf({ home: homeWith({ rows: [row()] }) })).toEqual([]);
  });

  it("reads a row's approved channel back off disk", () => {
    const home = homeWith({ rows: [row({ channelApprovals: [approval()] })] });
    expect(approvedScheduledChannelsOf({ home })).toEqual(["C0TEAM"]);
  });

  it("dedupes one channel two rows approve, and sorts so a refusal reads the same on two runs", () => {
    const home = homeWith({
      rows: [
        row({ channelApprovals: [approval({ channel: "C0ZED" }), approval()] }),
        row({ channelApprovals: [approval()], recipeId: "second-row" }),
      ],
    });
    expect(approvedScheduledChannelsOf({ home })).toEqual(["C0TEAM", "C0ZED"]);
  });

  it("gives a row nobody can parse no approval at all, while a good row beside it still counts", () => {
    const home = homeWith({ rows: [row({ channelApprovals: [approval()] })] });
    writeFileSync(join(home, "live", "recipe", "definitions", "broken.json"), '{"kind":"verb-run"', "utf8");
    writeFileSync(
      join(home, "live", "recipe", "definitions", "wrong.json"),
      JSON.stringify(row({ channelApprovals: [approval({ channel: "C0NEVER" })], kind: "retired-kind" })),
      "utf8",
    );
    expect(approvedScheduledChannelsOf({ home })).toEqual(["C0TEAM"]);
  });
});
