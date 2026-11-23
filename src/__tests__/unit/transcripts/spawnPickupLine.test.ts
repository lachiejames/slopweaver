/**
 * The line `cmux spawn` types into a seat it booted, and the reader that keeps it from reading as the owner's turn.
 *
 * The literal lines below are the witness against a generator and reader drifting TOGETHER: a round trip alone would
 * pass a template both of them changed. The wrapped shape is the one a real chair recorded, with a synthetic path.
 */
import { describe, expect, it } from "vitest";

import { isSpawnPickupLine, pickupLine, WAIT_RULE_INSTRUCTION } from "../../../transcripts/spawnPickupLine.js";

const DOC = "/home/handovers/fresh-supervisor-handoff-9342.md";

/** The current template, spelled out rather than composed, so a changed generator fails here. */
const START_LINE =
  "Read /home/handovers/fresh-supervisor-handoff-9342.md end to end, then run: slopweaver handover start " +
  "fresh-supervisor-handoff-9342, then execute the doc. It is complete; do not re-plan or ask what it covers. " +
  "Never sleep-poll in the foreground. " +
  "A short wait inside active work (a test, a push, a Codex pass) runs as a bounded background job whose completion " +
  "resumes you. Your own pull request's CI, a rebase, a red-CI fix and landing it are the work, so keep your seat " +
  "through them: wait with slopweaver github checks --number N --repo owner/repo --wait as a background job, or " +
  "--until merge once it is queued, and never park on your own pull request. Only a clock, or another branch's pull " +
  "request, you would sit idle through closes your seat: slopweaver handover park <slug> --wake-at <UTC instant " +
  "ending in Z>, or --wake-on-checks owner/repo#N, and the supervisor reseats you once it is due. A second read of " +
  "the same log, pid or task within 60s is refused by the poll gate.";

/** The wait sentence every seat received in an earlier release, which told it to park on its own CI. */
const PARK_ON_CI_WAIT_RULE =
  "Never sleep-poll in the foreground. A short wait inside active work (a test, a push, a Codex pass) runs as a " +
  "bounded background job whose completion resumes you. A CI or clock wait you would sit idle through closes your " +
  "seat instead: slopweaver handover park <slug> --wake-on-checks owner/repo#N, or --wake-at <UTC instant ending " +
  "in Z>, and the supervisor reseats you once it is due. A second read of the same log, pid or task within 60s is " +
  "refused by the poll gate.";

/** The oldest wait sentence, when a CI wait was still a background job rather than a park. */
const OLD_WAIT_RULE =
  "Never sleep-poll in the foreground: run a wait (CI, a test, a Codex pass) as a bounded background job, " +
  "whose completion resumes you.";

describe("pickupLine", () => {
  it("composes the current start line, byte for byte", () => {
    expect(pickupLine({ docPath: DOC, slug: "fresh-supervisor-handoff-9342", verb: "start" })).toBe(START_LINE);
  });

  it("composes the resume line with only the verb changed", () => {
    expect(pickupLine({ docPath: DOC, slug: "fresh-supervisor-handoff-9342", verb: "resume" })).toBe(
      START_LINE.replace("slopweaver handover start", "slopweaver handover resume"),
    );
  });
});

describe("isSpawnPickupLine", () => {
  const resume = START_LINE.replace("handover start", "handover resume");

  it("reads both bare lines as the spawn's", () => {
    expect([isSpawnPickupLine({ text: START_LINE }), isSpawnPickupLine({ text: resume })]).toEqual([true, true]);
  });

  it("reads the line inside the paste wrapper Claude Code recorded, id repeated on the close, or not", () => {
    expect([
      isSpawnPickupLine({ text: `<pasted_content id="b2c9">\n${START_LINE}\n</pasted_content id="b2c9">` }),
      isSpawnPickupLine({ text: `<pasted_content id="b2c9">\n${START_LINE}\n</pasted_content>` }),
      isSpawnPickupLine({ text: `<pasted_content>${resume}</pasted_content>` }),
    ]).toEqual([true, true, true]);
  });

  it("keeps a turn with the owner's words before or after the line, inside the wrapper or outside it", () => {
    const wrapped = `<pasted_content id="b2c9">\n${START_LINE}\n</pasted_content id="b2c9">`;
    expect([
      isSpawnPickupLine({ text: `actually wait. ${START_LINE}` }),
      isSpawnPickupLine({ text: `${START_LINE} Also check the bump PRs.` }),
      isSpawnPickupLine({ text: `look at this ${wrapped}` }),
      isSpawnPickupLine({ text: `${wrapped}\nthen tell me what it says` }),
      isSpawnPickupLine({ text: `<pasted_content id="1">\nhold on\n${START_LINE}\n</pasted_content id="1">` }),
    ]).toEqual([false, false, false, false, false]);
  });

  it("refuses a wrapper whose close names another id, or a second wrapper inside the first", () => {
    expect([
      isSpawnPickupLine({ text: `<pasted_content id="b2c9">\n${START_LINE}\n</pasted_content id="ffff">` }),
      isSpawnPickupLine({
        text: `<pasted_content id="a"><pasted_content id="b">${START_LINE}</pasted_content id="b"></pasted_content id="a">`,
      }),
    ]).toEqual([false, false]);
  });

  // `cmux spawn --dir` types the board path as given, whatever it holds.
  it("reads a relative doc path, or one holding a space, a line break or the head's own words, as the spawn's", () => {
    const tricky = "/home/x.md end to end, then run: slopweaver handover start y, then execute the doc. /x.md";
    expect([
      isSpawnPickupLine({ text: START_LINE.replace(DOC, "handovers/x.md") }),
      isSpawnPickupLine({ text: START_LINE.replace(DOC, "my handovers/x.md") }),
      isSpawnPickupLine({ text: START_LINE.replace(DOC, "my\nhandovers/x.md") }),
      isSpawnPickupLine({ text: START_LINE.replace(DOC, tricky) }),
      // `--dir .` over a file named exactly `.md`.
      isSpawnPickupLine({ text: START_LINE.replace(DOC, ".md") }),
    ]).toEqual([true, true, true, true, true]);
  });

  it("refuses a path not ending .md, and a slug the run store would not accept", () => {
    expect([
      isSpawnPickupLine({ text: START_LINE.replace(DOC, "/home/handovers/x.txt") }),
      isSpawnPickupLine({ text: START_LINE.replaceAll("fresh-supervisor-handoff-9342,", "-leading-dash,") }),
    ]).toEqual([false, false]);
  });

  it("refuses an older template's wait wording — only the current line is the spawn's", () => {
    const old = START_LINE.replace(WAIT_RULE_INSTRUCTION, OLD_WAIT_RULE);
    expect(old.includes(OLD_WAIT_RULE)).toBe(true);
    expect(isSpawnPickupLine({ text: old })).toBe(false);
  });

  it("recognises the earlier line every seat received, park-on-CI wording and all, bare and wrapped", () => {
    const retired = START_LINE.replace(WAIT_RULE_INSTRUCTION, PARK_ON_CI_WAIT_RULE);
    expect(retired.includes("A CI or clock wait you would sit idle through")).toBe(true);
    expect([
      isSpawnPickupLine({ text: retired }),
      isSpawnPickupLine({ text: `<pasted_content>\n${retired}\n</pasted_content>` }),
      isSpawnPickupLine({ text: `${retired} and also merge #12` }),
    ]).toEqual([true, true, false]);
  });

  it("recognises the oldest line every seat received, sidebar sentence and all, bare and wrapped", () => {
    const retired = START_LINE.replace(
      `covers. ${WAIT_RULE_INSTRUCTION}`,
      "covers. Publish progress as you go: slopweaver cmux todo start|check <id> as each checklist item moves, and " +
        `slopweaver cmux status set needs-attention|review when you park on the owner or finish. ${PARK_ON_CI_WAIT_RULE}`,
    );
    expect(retired.includes("cmux todo start|check")).toBe(true);
    expect([
      isSpawnPickupLine({ text: retired }),
      isSpawnPickupLine({ text: `<pasted_content>\n${retired}\n</pasted_content>` }),
      isSpawnPickupLine({ text: `${retired} and also merge #12` }),
    ]).toEqual([true, true, false]);
  });

  it("carries the standing wait instruction verbatim, so it cannot be edited without this line moving", () => {
    expect(START_LINE.endsWith(` ${WAIT_RULE_INSTRUCTION}`)).toBe(true);
  });
});
