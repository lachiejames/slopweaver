/*
 * Relating a card landing's words to the ask it landed on, over a real temp board: the steer reaches a row that takes
 * it, a row that will not is reported with the command that relates it, and a repeated landing finds the live row
 * itself and says nothing for a row the board no longer holds.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { relateLandedSteer, relateRepeatedSteer } from "../../../cli/commands/talk/cardLandSteer.js";
import { parseHandoverDoc } from "../../../handover/doc.js";

const ANCHOR = "call:a0000041-0000-4000-8000-000000000044#s-1";
const ROW = "---\nslug: the-ask\nstatus: ready\nanchor: talk:a0000015-0000-4000-8000-000000000016\n---\n\n# the ask\n";

let home = "";
let board = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "land-steer-home-"));
  board = mkdtempSync(join(tmpdir(), "land-steer-board-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
  rmSync(board, { force: true, recursive: true });
});

/** The steers the row at `path` reads back with. */
function steersOn({ path }: { path: string }): number {
  return parseHandoverDoc({ path, text: readFileSync(path, "utf8") }).hisWordsSteers.length;
}

describe("relateLandedSteer", () => {
  it("relates the words to a row that takes them and reports nothing", async () => {
    const path = join(board, "the-ask.md");
    writeFileSync(path, ROW);
    expect(await relateLandedSteer({ anchor: ANCHOR, home, path, slug: "the-ask" })).toEqual([]);
    expect(steersOn({ path })).toBe(1);
  });

  it("reports a row that will not take the steer, naming the command that relates it", async () => {
    const path = join(board, "the-ask.md");
    writeFileSync(path, ROW.replace("---\n", "---\nslug: the-ask\n"));
    const reported = await relateLandedSteer({ anchor: ANCHOR, home, path, slug: "the-ask" });
    expect(reported.length).toBe(1);
    expect(reported[0]).toContain(`${ANCHOR} not related to the-ask: `);
    expect(reported[0]).toContain(`\`slopweaver handover quote the-ask --add-steer ${ANCHOR} --apply\` relates it`);
  });
});

describe("relateRepeatedSteer", () => {
  it("finds the ask's live row on the board and relates the words to it", async () => {
    const path = join(board, "the-ask.md");
    writeFileSync(path, ROW);
    expect(await relateRepeatedSteer({ anchor: ANCHOR, handoverDir: board, home, slug: "the-ask" })).toEqual([]);
    expect(steersOn({ path })).toBe(1);
  });

  it("reports nothing for an ask the live board no longer holds", async () => {
    expect(await relateRepeatedSteer({ anchor: ANCHOR, handoverDir: board, home, slug: "the-ask" })).toEqual([]);
  });
});
