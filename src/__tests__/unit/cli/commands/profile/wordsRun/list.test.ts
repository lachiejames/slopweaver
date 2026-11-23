/*
 * `profile words` listing the owner's turns: the empty home's exit 3, newest first with each turn's anchor, narrowing by
 * phrase and by how, a call stretch read off a file whose mtime predates the window, and the two windows refused
 * as a usage mistake.
 */
import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../../cli/exitCodes.js";
import { home, NOW, OTHER_TURN, run, stage, TURN, useWordsHomes } from "./harness.js";

useWordsHomes();

describe("profile words — a list", () => {
  it("exits 3 over a home where the owner has said nothing and nothing failed to read", () => {
    const { code, lines } = run({ rest: [] });

    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(lines).toEqual([
      "profile words: 0 turn(s) of the owner's from 2026-09-27 12:00Z to 2026-10-04 12:00Z — 0 spoken, 0 written",
    ]);
  });

  it("lists the owner's console turns newest first, each marked spoken or written, with its anchor", () => {
    stage({ atIso: "2026-10-04T09:00:00.000Z", heard: "ship the atlas", turnId: TURN, typed: true });
    stage({ atIso: "2026-10-04T10:00:00.000Z", heard: "hold the atlas", turnId: OTHER_TURN, typed: false });

    const { code, lines } = run({ rest: [] });

    expect(code).toBe(EXIT_OK);
    expect(lines).toEqual([
      "profile words: 2 turn(s) of the owner's from 2026-09-27 12:00Z to 2026-10-04 12:00Z — 1 spoken, 1 written",
      `  2026-10-04 10:00Z · spoken · relayed from the console voice · 14 chars · the record does not say whether it kept all of it · talk:${OTHER_TURN}`,
      "      hold the atlas",
      `  2026-10-04 09:00Z · written · typed on the console · 14 chars · talk:${TURN}`,
      "      ship the atlas",
      "  one whole: slopweaver profile words <anchor>",
    ]);
  });

  it("narrows by phrase and by how", () => {
    stage({ atIso: "2026-10-04T09:00:00.000Z", heard: "ship the atlas", turnId: TURN, typed: true });
    stage({ atIso: "2026-10-04T10:00:00.000Z", heard: "hold the queue", turnId: OTHER_TURN, typed: false });

    expect(run({ rest: ["--phrase", "atlas"] }).lines[0]).toBe(
      "profile words: 1 turn(s) of the owner's containing atlas from 2026-09-27 12:00Z to 2026-10-04 12:00Z — 0 spoken, 1 written",
    );
    expect(run({ rest: ["--how", "spoken", "--json"] }).lines.map((line) => JSON.parse(line).matched)).toEqual([1]);
    expect(run({ rest: ["--phrase", "nowhere"] }).code).toBe(EXIT_EXPECTED_EMPTY);
  });

  it("lists a call stretch inside the window from a file whose mtime is older than the floor", () => {
    const call = "5d6e7f80-9102-4a3b-8c4d-5e6f70819203";
    const path = join(home, "talk", "calls", `${call}.jsonl`);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(
      path,
      `${JSON.stringify({ atIso: "2026-10-04T08:00:00.000Z", final: true, id: "s-1", kind: "segment", text: "restored from a backup", who: "owner" })}\n`,
      "utf8",
    );
    utimesSync(path, new Date("2026-09-01T00:00:00.000Z"), new Date("2026-09-01T00:00:00.000Z"));

    const { code, lines } = run({ rest: ["--phrase", "restored backup"] });

    expect(code).toBe(EXIT_OK);
    expect(lines[0]).toBe(
      "profile words: 1 turn(s) of the owner's containing restored + backup from 2026-09-27 12:00Z to 2026-10-04 12:00Z — 1 spoken, 0 written",
    );
  });

  it("refuses a span longer than a date can hold as a usage mistake, never a thrown RangeError", () => {
    const { code, lines } = run({ rest: ["--since", "99999999999d"] });

    expect(code).toBe(EXIT_USAGE);
    expect(lines).toEqual(["profile words: --since 99999999999d reaches back past any instant a date can hold"]);
  });

  it("refuses a window that holds nothing as a usage mistake", () => {
    const { code, lines } = run({ rest: ["--since", NOW] });

    expect(code).toBe(EXIT_USAGE);
    expect(lines).toEqual([`profile words: --since ${NOW} is not before --until — the window holds nothing`]);
  });
});
