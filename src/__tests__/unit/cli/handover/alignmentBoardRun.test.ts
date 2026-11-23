/*
 * `handover alignment-board`'s rebuild: a missing projection is composed now and served live only when the
 * composition is the whole board. One doc that will not read makes it exit non-zero, printing and caching nothing,
 * so the console's Alignment count stays not measured rather than counting rows that are not all there (Codex al-r1).
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runHandoverAlignmentBoard } from "../../../../cli/commands/handover/alignmentBoardRun.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../cli/exitCodes.js";
import { stateHomePaths } from "../../../../stateHome.js";

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "sw-alignrun-"));
  homes.push(home);
  mkdirSync(stateHomePaths({ home }).handovers, { recursive: true });
  return home;
}

function run({ home }: { home: string }): number {
  return runHandoverAlignmentBoard(["node", "slopweaver", "handover", "alignment-board", "--json", "--home", home]);
}

describe("handover alignment-board's rebuild", () => {
  it("composes, caches and serves a whole board when the projection is missing", () => {
    const home = freshHome();
    expect([run({ home }), existsSync(stateHomePaths({ home }).alignmentBoardJson)]).toEqual([EXIT_OK, true]);
  });

  it("refuses a rebuild with one unreadable doc: non-zero, and nothing cached", () => {
    const home = freshHome();
    // The scan reads only regular files, and reports anything else under a doc's name as unreadable.
    mkdirSync(join(stateHomePaths({ home }).handovers, "broken.md"));
    expect([run({ home }), existsSync(stateHomePaths({ home }).alignmentBoardJson)]).toEqual([EXIT_ERROR, false]);
  });
});
