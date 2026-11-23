/*
 * The effectful half of `hand post`'s opened-ask machine-id check, over a real ask doc and run journal in a throwaway
 * home: a clean step opening a shaped ask whose words name a call by its machine id is refused, as a review
 * counterexample required, while the same step opening a clean ask, an absent one, or an unshaped one
 * proceeds — none of those draws the id on the card.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openedAskMachineIdExit } from "../../../../../cli/commands/hand/openedAskMachineId.js";
import { EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import type { HandStep } from "../../../../../hand/step.js";

let home: string;
let lines: string[];

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "opened-ask-id-"));
  lines = [];
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** The counterexample step: clean in every field, opening the `release-reply` ask. */
const STEP: HandStep = {
  id: "approve-the-reply",
  postedBy: "supervisor",
  postedIso: "2026-11-01T04:39:00.000Z",
  unblocks: "the reply to the release thread",
  url: "http://localhost:3000/queue?open=ask%3Arelease-reply",
  what: "Read the release reply the room is waiting on and say whether it goes out today",
  witness: "slopweaver hand done approve-the-reply",
};

/**
 * Write the `release-reply` ask doc, registered with its shape in front matter.
 *
 * @param problem the ask's problem line
 * @param options how many options it records
 * @param archived whether it sits in the archive rather than on the live board
 * @param summary its front-matter summary
 */
function askDoc({
  problem,
  options = 2,
  archived = false,
  summary = "the release reply",
}: {
  problem: string;
  options?: number;
  archived?: boolean;
  summary?: string;
}): void {
  const optionLines = [
    "  - option: Send it today",
    "    tradeoff: the room reads it now",
    "  - option: Hold it a day",
    "    tradeoff: the room waits",
  ].slice(0, options * 2);
  const text = [
    "---",
    "slug: release-reply",
    "kind: ask",
    `summary: "${summary}"`,
    "status: ready",
    "askedIso: 2026-11-01T03:00:00.000Z",
    "stillRealIso: 2026-11-01T04:00:00.000Z",
    `problem: "${problem}"`,
    'lean: "Send it today"',
    'risk: "a late reply"',
    'blastRadius: "one thread"',
    'stillReal: "checked this morning"',
    "options:",
    ...optionLines,
    "---",
    "",
    "# the release reply",
    "",
  ].join("\n");
  const dir = archived ? join(home, "handovers", "archive") : join(home, "handovers");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "release-reply.md"), text);
}

function exitOf({ step }: { step: HandStep }): number | undefined {
  return openedAskMachineIdExit({ home, step, write: (line) => lines.push(line) });
}

describe("openedAskMachineIdExit", () => {
  it("refuses a clean step opening an ask whose problem names a call by its machine id", () => {
    askDoc({ problem: "call a0000019 left the release reply unsent" });
    expect(exitOf({ step: STEP })).toBe(EXIT_USAGE);
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain('(release-reply) has its problem name "call a0000019"');
    expect(lines[0]).toContain("NOTHING was recorded");
  });

  it("proceeds silently when the opened ask's words are clean", () => {
    askDoc({ problem: "the release reply is unsent" });
    expect(exitOf({ step: STEP })).toBe(undefined);
    expect(lines).toEqual([]);
  });

  it("proceeds when the opened ask is not on disk, which the Queue cannot draw either", () => {
    expect(exitOf({ step: STEP })).toBe(undefined);
    expect(lines).toEqual([]);
  });

  it("reads the summary as the board caps it: an id past the cap is not drawn, one inside it is", () => {
    const long = "the release reply ".repeat(20);
    expect(long.length).toBeGreaterThan(320);
    askDoc({ problem: "the release reply is unsent", summary: `${long}call a0000019` });
    expect(exitOf({ step: STEP })).toBe(undefined);
    askDoc({ problem: "the release reply is unsent", summary: `call a0000019 ${long}` });
    expect(exitOf({ step: STEP })).toBe(EXIT_USAGE);
    expect(lines[0]).toContain('has its summary name "call a0000019"');
  });

  it("still reads an opened ask whose front matter carries a problem, which the board still publishes", () => {
    askDoc({ problem: "call a0000019 left the release reply unsent" });
    const path = join(home, "handovers", "release-reply.md");
    writeFileSync(path, readFileSync(path, "utf8").replace("askedIso: 2026-11-01T03:00:00.000Z\n", ""));
    expect(exitOf({ step: STEP })).toBe(EXIT_USAGE);
    expect(lines[0]).toContain('has its problem name "call a0000019"');
  });

  it("proceeds when the opened ask is archived, which the Queue's live board does not join", () => {
    askDoc({ archived: true, problem: "call a0000019 left the release reply unsent" });
    expect(exitOf({ step: STEP })).toBe(undefined);
    expect(lines).toEqual([]);
  });

  it("proceeds when the opened ask records one option, which the Queue draws no decision for", () => {
    askDoc({ options: 1, problem: "call a0000019 left the release reply unsent" });
    expect(exitOf({ step: STEP })).toBe(undefined);
    expect(lines).toEqual([]);
  });

  it("reads the run's journalled shape over the doc's, as the card does", () => {
    askDoc({ problem: "the release reply is unsent" });
    const events = [
      { atIso: "2026-11-01T04:00:00.000Z", branch: "release-reply", docHash: "h1", kind: "started" },
      {
        atIso: "2026-11-01T04:10:00.000Z",
        kind: "question",
        lean: "Send it today",
        options: [
          { letter: "A", option: "Send it today", tradeoff: "the room reads it now" },
          { letter: "B", option: "Hold it a day", tradeoff: "the room waits" },
        ],
        problem: "run 9f3a1c2e never sent the release reply",
        question: "Does the release reply go out today?",
        stakes: { blastRadius: "one thread", risk: "a late reply", stillReal: "checked this morning" },
      },
    ];
    mkdirSync(join(home, "runs"), { recursive: true });
    writeFileSync(
      join(home, "runs", "release-reply.jsonl"),
      events.map((event) => `${JSON.stringify(event)}\n`).join(""),
    );
    expect(exitOf({ step: STEP })).toBe(EXIT_USAGE);
    expect(lines[0]).toContain('has its problem name "run 9f3a1c2e"');
  });

  it("reads no ask for a notice, which is on no Queue", () => {
    askDoc({ problem: "call a0000019 left the release reply unsent" });
    expect(exitOf({ step: { ...STEP, notice: true } })).toBe(undefined);
    expect(lines).toEqual([]);
  });
});
