/*
 * The board composition `handover list` and `handover alignment-board` share, and the refresh that writes the
 * Alignment projection off it: a whole default board is written, anything less is refused and never written, and a
 * write that fails says so without failing the verb. Plus the projection's own error factories, which every caller
 * displays.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { refreshAlignmentBoard } from "../../../../cli/commands/handover/alignmentBoardRefresh.js";
import { composedBoard, scannedBoard } from "../../../../cli/commands/handover/boardComposition.js";
import { deadlineIn } from "../../../../cli/commands/handover/probeSweep.js";
import { AlignmentBoardProjectionErrors } from "../../../../handover/alignmentBoardProjectionErrors.js";
import { EMPTY_TAG_FILTER } from "../../../../handover/tagFilter.js";
import { stateHomePaths } from "../../../../stateHome.js";

const VERB = "handover alignment-board";
const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "sw-aligncomp-"));
  homes.push(home);
  mkdirSync(stateHomePaths({ home }).handovers, { recursive: true });
  return home;
}

/** Scan and compose a home's board exactly as the rebuild does, then refresh the projection off it. */
function refreshed({
  home,
  handoverDir,
}: {
  home: string;
  handoverDir: string;
}): ReturnType<typeof refreshAlignmentBoard> {
  const scanned = scannedBoard({ handoverDir, home, verb: VERB });
  if (scanned.kind === "failed") {
    throw new Error(`the scan failed: ${scanned.why}`);
  }
  const composition = {
    ...scanned.board,
    base: undefined,
    deadline: deadlineIn({ seconds: 60 }),
    filter: EMPTY_TAG_FILTER,
    handoverDir,
    home,
    runCommands: false,
    verb: VERB,
  };
  const { models, sweep } = composedBoard(composition);
  return refreshAlignmentBoard({ ...composition, models, scanStartedIso: "2026-10-25T00:00:00.000Z", sweep });
}

describe("the shared board composition", () => {
  it("scans an empty board as no docs and nothing unreadable, and composes no rows", () => {
    const home = freshHome();
    const handoverDir = stateHomePaths({ home }).handovers;
    const scanned = scannedBoard({ handoverDir, home, verb: VERB });
    expect(scanned.kind).toBe("scanned");
    const board = (scanned as Extract<typeof scanned, { kind: "scanned" }>).board;
    expect([board.docs.length, board.unreadable.length]).toEqual([0, 0]);
    const { models, sweep } = composedBoard({
      ...board,
      base: undefined,
      deadline: deadlineIn({ seconds: 60 }),
      filter: EMPTY_TAG_FILTER,
      handoverDir,
      home,
      runCommands: false,
      verb: VERB,
    });
    expect([models.length, sweep.unresolved]).toEqual([0, 0]);
  });

  it("reports a doc name that is not a regular file as unreadable", () => {
    const home = freshHome();
    const handoverDir = stateHomePaths({ home }).handovers;
    mkdirSync(join(handoverDir, "broken.md"));
    const scanned = scannedBoard({ handoverDir, home, verb: VERB });
    expect((scanned as Extract<typeof scanned, { kind: "scanned" }>).board.unreadable.length).toBe(1);
  });
});

describe("refreshAlignmentBoard", () => {
  it("writes the projection off a whole default board", () => {
    const home = freshHome();
    const result = refreshed({ handoverDir: stateHomePaths({ home }).handovers, home });
    expect([result.refused, result.notWritten, result.projection.rows.length]).toEqual([undefined, undefined, 0]);
    expect(existsSync(stateHomePaths({ home }).alignmentBoardJson)).toBe(true);
  });

  it("refuses, and writes nothing, when a doc would not read", () => {
    const home = freshHome();
    mkdirSync(join(stateHomePaths({ home }).handovers, "broken.md"));
    const result = refreshed({ handoverDir: stateHomePaths({ home }).handovers, home });
    expect(result.refused).toBe("1 doc file(s) would not read");
    expect(existsSync(stateHomePaths({ home }).alignmentBoardJson)).toBe(false);
  });

  it("refuses a board scanned from anywhere but the home's own handovers", () => {
    const home = freshHome();
    const elsewhere = join(home, "elsewhere");
    mkdirSync(elsewhere);
    const result = refreshed({ handoverDir: elsewhere, home });
    expect(result.refused).toBe(`it scanned ${elsewhere}, not the home's own ${stateHomePaths({ home }).handovers}`);
  });

  it("serves a whole board it could not write, naming why rather than failing", () => {
    const home = freshHome();
    // A directory where the file goes, so the atomic rename cannot land.
    mkdirSync(join(stateHomePaths({ home }).alignmentBoardJson, "occupied"), { recursive: true });
    const result = refreshed({ handoverDir: stateHomePaths({ home }).handovers, home });
    expect(result.refused).toBe(undefined);
    expect(result.notWritten).toContain("could not write the Alignment board projection");
  });
});

describe("AlignmentBoardProjectionErrors", () => {
  it("names the path, and the detail where there is one, in every message", () => {
    const path = "/home/alignment-board.json";
    expect([
      AlignmentBoardProjectionErrors.missing({ path }),
      AlignmentBoardProjectionErrors.unreadable({ detail: "EACCES", path }),
      AlignmentBoardProjectionErrors.invalid({ detail: "not JSON", path }),
      AlignmentBoardProjectionErrors.writeFailed({ detail: "ENOSPC", path }),
    ]).toEqual([
      { code: "ALIGNMENT_BOARD_MISSING", message: `no Alignment board projection at ${path} yet`, path },
      {
        code: "ALIGNMENT_BOARD_UNREADABLE",
        message: `could not read the Alignment board projection at ${path}: EACCES`,
        path,
      },
      {
        code: "ALIGNMENT_BOARD_INVALID",
        message: `the Alignment board projection at ${path} will not read (not JSON)`,
        path,
      },
      {
        code: "ALIGNMENT_BOARD_WRITE_FAILED",
        message: `could not write the Alignment board projection at ${path}: ENOSPC`,
        path,
      },
    ]);
  });
});
