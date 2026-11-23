/*
 * `profile words <anchor>` over a console relay: the record printed whole under its head line, the exit 1 naming
 * why an anchor would not read, and a relay record holding none of the owner's words refused as the list names it a gap.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { EXIT_ERROR, EXIT_OK } from "../../../../../../cli/exitCodes.js";
import { stateHomePaths } from "../../../../../../stateHome.js";
import { home, run, stage, TURN, useWordsHomes } from "./harness.js";

useWordsHomes();

describe("profile words — one anchor", () => {
  it("prints the record whole under its head line", () => {
    stage({ atIso: "2026-10-04T09:00:00.000Z", heard: "ship it\nthen tell me", turnId: TURN, typed: true });

    const { code, lines } = run({ rest: [`talk:${TURN}`] });

    expect(code).toBe(EXIT_OK);
    expect(lines).toEqual([
      `2026-10-04 09:00Z · written · typed on the console · 20 chars · talk:${TURN}`,
      "    ship it",
      "    then tell me",
    ]);
  });

  it("exits 1 naming why an anchor would not read", () => {
    const { code, lines } = run({ rest: [`talk:${TURN}`] });

    expect(code).toBe(EXIT_ERROR);
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("no relay turn file carries it");
  });

  it("refuses a relay record holding none of the owner's words, as the list names it a gap", () => {
    stage({ atIso: "2026-10-04T09:00:00.000Z", heard: "ship the atlas", turnId: TURN, typed: false });
    const turnFile = join(stateHomePaths({ home }).talkTurns, `${TURN}.json`);
    const { heard: _heard, ...legacy } = JSON.parse(readFileSync(turnFile, "utf8")) as Record<string, unknown>;
    writeFileSync(turnFile, JSON.stringify(legacy), "utf8");

    expect(run({ rest: [`talk:${TURN}`] })).toEqual({
      code: EXIT_ERROR,
      lines: [
        `profile words: talk:${TURN} holds none of their own words — the record was written before they were stored`,
      ],
    });
  });
});
