/**
 * The RULINGS-section reader `ruling seed` stands on, over a synthetic state document in every row shape the live
 * documents use. The owner's words must come out byte for byte; a row it cannot read with certainty is a blocker.
 */
import { describe, expect, it } from "vitest";

import { scanRulingSource } from "../../../ruling/sourceRows.js";

const FILE = "/synthetic/state.md";
const TALK = "talk:00000000-0000-4000-8000-000000000001";
const CALL = "talk-call:00000000-0000-4000-8000-000000000002#turn_AbCdEf123";

const DOC = [
  "# Supervisor state",
  "",
  "## first boot",
  "",
  "- a shift row, not a ruling",
  "### RULINGS",
  "",
  "- 2026-01-01, the owner, transcript 0a1b2c3d: land through local laps, fill",
  "  capacity, review after.",
  "- 2026-01-01, the owner, same transcript: leftovers do not belong: on a description.",
  "- 2026-01-01, the owner: two review passes, no third.",
  "",
  "## second boot",
  "### RULINGS",
  "- None new this boot; the earlier rulings stand.",
  `- RULED 2026-01-02, the owner, ${TALK}: the store is always local.`,
  `- RULED 2026-01-02, the owner, ${CALL} (with turn_GhIjKl456), on page acme-briefing, call two: accepts the lean at 07:30Z.`,
  "- STEER 2026-01-02, the owner, same anchor: a steer, not a ruling.",
  "- ASKED 2026-01-02, the owner: a briefing first.",
  "- RULED 2026-01-02, the owner, transcript 9f9f turn 8e8e: a spoken transcript pointer.",
  "",
  "A prose line closes the section.",
  "- a bullet outside any RULINGS section",
  "",
].join("\n");

describe("scanRulingSource", () => {
  const scan = scanRulingSource({ file: FILE, text: DOC });

  it("finds both sections and reads every ruling in document order", () => {
    expect(scan.sections).toBe(2);
    expect(scan.candidates.map((candidate) => candidate.line)).toStrictEqual([8, 10, 11, 16, 17, 20]);
    expect(scan.blockers).toStrictEqual([]);
  });

  it("refuses a row holding an indented list item rather than absorbing it into the words", () => {
    const nested = scanRulingSource({
      file: FILE,
      text: "### RULINGS\n- 2026-01-01, the owner: keep this.\n  - 2026-01-02, the owner: a separate later bullet.\n",
    });
    expect(nested.candidates).toStrictEqual([]);
    expect(nested.blockers).toStrictEqual([
      { file: FILE, line: 2, why: "an indented list item inside the row, which may be a ruling of its own" },
    ]);
  });

  it("refuses a row followed by an indented paragraph after a blank line rather than dropping it", () => {
    const detached = scanRulingSource({
      file: FILE,
      text: "### RULINGS\n- 2026-01-01, the owner: first paragraph\n  continued\n\n  second paragraph\n",
    });
    expect(detached.candidates).toStrictEqual([]);
    expect(detached.blockers).toStrictEqual([
      {
        file: FILE,
        line: 2,
        why: "an indented paragraph after a blank line follows the row, which may be part of its words",
      },
    ]);
  });

  it("keeps a wrapped row's continuation line verbatim, indentation included", () => {
    expect(scan.candidates[0]!).toStrictEqual({
      anchor: "transcript 0a1b2c3d",
      decidedOn: "2026-01-01",
      file: FILE,
      line: 8,
      words: "land through local laps, fill\n  capacity, review after.",
    });
  });

  it("gives `same transcript` the anchor of the ruling just before it, and splits only at the first `: `", () => {
    expect(scan.candidates[1]!.anchor).toBe("transcript 0a1b2c3d");
    expect(scan.candidates[1]!.words).toBe("leftovers do not belong: on a description.");
  });

  it("reads a row with no locator as having no anchor", () => {
    expect(scan.candidates[2]!.anchor).toBeUndefined();
    expect(scan.candidates[2]!.words).toBe("two review passes, no third.");
  });

  it("keeps a pointer anchor whole and the occasion beside it as context", () => {
    expect(scan.candidates[3]!.anchor).toBe(TALK);
    expect(scan.candidates[4]!).toStrictEqual({
      anchor: CALL,
      context: "(with turn_GhIjKl456), on page acme-briefing, call two",
      decidedOn: "2026-01-02",
      file: FILE,
      line: 17,
      words: "accepts the lean at 07:30Z.",
    });
    expect(scan.candidates[5]!.anchor).toBe("transcript 9f9f turn 8e8e");
  });

  it("skips STEER, ASKED and filler rows by name", () => {
    expect(scan.skipped.map((skip) => `${String(skip.line)}:${skip.reason}`)).toStrictEqual([
      "15:filler",
      "18:steer",
      "19:asked",
    ]);
  });

  it("treats a CRLF line ending as a line ending, not as words", () => {
    const crlf = scanRulingSource({ file: FILE, text: "### RULINGS\r\n- 2026-01-03, the owner: keep it.\r\n" });
    expect(crlf.candidates.map((candidate) => candidate.words)).toStrictEqual(["keep it."]);
  });
});

describe("scanRulingSource blockers", () => {
  /** Scan one section holding the given bullets. */
  function blockersOf({ bullets }: { bullets: readonly string[] }): readonly string[] {
    return scanRulingSource({ file: FILE, text: ["### RULINGS", ...bullets].join("\n") }).blockers.map(
      (blocker) => blocker.why,
    );
  }

  it("blocks an undated bullet in a RULINGS section", () => {
    expect(blockersOf({ bullets: ["- https://example.invalid/pull/1 — approved"] })).toStrictEqual([
      "a bullet in a RULINGS section that is not a dated ruling row",
    ]);
  });

  it("blocks a locator it does not recognise", () => {
    expect(blockersOf({ bullets: ["- 2026-01-04, the owner, in the hallway: something."] })).toStrictEqual([
      "the locator names no anchor this reads",
    ]);
  });

  it("blocks a row whose locator never ends", () => {
    expect(blockersOf({ bullets: [`- 2026-01-04, the owner, ${TALK} and nothing after`] })).toStrictEqual([
      "no `: ` ends the row's locator",
    ]);
  });

  it("blocks `same anchor` when the bullet before it was not an anchored ruling", () => {
    expect(
      blockersOf({
        bullets: ["- 2026-01-04, the owner: unanchored.", "- 2026-01-04, the owner, same anchor: then this."],
      }),
    ).toStrictEqual(["`same …` with no anchored ruling just before it"]);
  });

  it("reads a document with no RULINGS section as empty", () => {
    const empty = scanRulingSource({ file: FILE, text: "# nothing here\n- a bullet\n" });
    expect(empty.sections).toBe(0);
    expect(empty.candidates).toStrictEqual([]);
  });
});
