/*
 * `talk laps` over a real home: two looks at one card on a call that recorded the open card, read back through the
 * verb's injected body — the `--json` shape the console reads, the plain lines, and a window that will not parse.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type LapsArgs, parseLapsArgs } from "../../../cli/commands/talk/cardArgs.js";
import { talkLaps } from "../../../cli/commands/talk/lapsRun.js";
import { EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../cli/exitCodes.js";
import { unwrap } from "../../../lib/result.js";
import type { CallEntry } from "../../../talk/callRecord.js";
import { appendCallEntries } from "../../../talk/callStore.js";
import { readCardLaps, readLapsInputs } from "../../../talk/cardLapsRead.js";

const CALL = "a0000041-0000-4000-8000-000000000044";
const NOW = "2026-10-05T00:00:00.000Z";
const CARD = "pr:acme.widgets.1842";
const NO_CHAIN =
  "no supervisor chain is recorded, so no supervisor turn was read — `slopweaver supervisor chain --rescan`";

let home = "";
let claudeHome = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "laps-"));
  claudeHome = join(home, "claude");
  mkdirSync(claudeHome, { recursive: true });
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** One stretch of the owner's speech, with the card open when it began. */
const segment = ({ id, atIso, text, open }: { id: string; atIso: string; text: string; open?: string }): CallEntry => ({
  atIso,
  final: true,
  id,
  kind: "segment",
  ...(open === undefined ? {} : { open }),
  text,
  who: "owner",
});

/** Write the call, as writer pid 101 that is running, so no `ps` is spawned to ask. */
const writeCall = ({ entries }: { entries: readonly CallEntry[] }): void => {
  unwrap(
    appendCallEntries({
      callId: CALL,
      entries,
      home,
      pid: 101,
      startOf: () => ({ running: true, start: "t101" }),
    }),
  );
};

/** Drive the verb with argv, collecting its lines. */
const run = ({ argv }: { argv: readonly string[] }): { code: number; lines: string[] } => {
  const args: LapsArgs = unwrap(parseLapsArgs({ rest: argv }));
  const lines: string[] = [];
  const code = talkLaps({
    args,
    claudeHome,
    handoverDir: join(home, "handovers"),
    home,
    nowIso: NOW,
    out: (line) => {
      lines.push(line);
    },
  });
  return { code, lines };
};

describe("talk laps", () => {
  it("reads two looks at one card as one fleet lap, with the steer and the unplaced stretch", () => {
    writeCall({
      entries: [
        segment({ atIso: "2026-10-04T10:00:00.000Z", id: "s-1", open: CARD, text: "the title is wrong" }),
        segment({ atIso: "2026-10-04T12:00:00.000Z", id: "s-2", open: CARD, text: "ship it" }),
        segment({ atIso: "2026-10-04T12:01:00.000Z", id: "s-3", text: "what else is there" }),
      ],
    });
    const { code, lines } = run({ argv: ["--json"] });
    expect(code).toBe(EXIT_OK);
    const reading = JSON.parse(lines[0]!) as Record<string, unknown> & {
      cards: { key: string; laps: number; fleetLaps: number; steeringChars: number; lastLookChars: number }[];
    };
    expect([reading["ok"], reading["sinceIso"], reading["unplaced"], reading["gaps"]]).toEqual([
      true,
      "2026-09-21T00:00:00.000Z",
      { call: 1, chair: 0, relay: 0, typed: 0 },
      // No supervisor chain in this home: a source that did not read is named, never read as no words.
      [{ source: "supervisor", why: NO_CHAIN }],
    ]);
    const [card] = reading.cards;
    expect([card!.key, card!.laps, card!.fleetLaps, card!.steeringChars, card!.lastLookChars]).toEqual([
      CARD,
      1,
      1,
      18,
      7,
    ]);
  });

  it("prints the summary, the card, its lap and the unplaced count as lines", () => {
    writeCall({
      entries: [
        segment({ atIso: "2026-10-04T10:00:00.000Z", id: "s-1", open: CARD, text: "the title is wrong" }),
        segment({ atIso: "2026-10-04T12:00:00.000Z", id: "s-2", open: CARD, text: "ship it" }),
      ],
    });
    expect(run({ argv: ["--since", "2d"] }).lines).toEqual([
      "talk laps: 1 card(s) the owner looked at since 2026-10-03T00:00:00.000Z — 0 on one look; laps 1 fleet, 0 world; 18 chars in earlier looks, 7 in last looks",
      `  ${CARD}  1 lap(s): 1 fleet, 0 world · steering 18 chars, last look 7`,
      `    lap 1 (fleet) 2026-10-04T10:00:00.000Z talk-call:${CALL}#s-1: the title is wrong`,
      "  named no card, so on none: 0 call stretch(es), 0 chair turn(s), 0 console steer(s)",
      `  not read whole (supervisor): ${NO_CHAIN}`,
    ]);
  });

  it("exits expected-empty on a home with no words", () => {
    expect(run({ argv: [] }).code).toBe(EXIT_EXPECTED_EMPTY);
  });

  it("refuses a window that does not parse as a usage error", () => {
    const { code, lines } = run({ argv: ["--since", "yesterday-ish"] });
    expect(code).toBe(EXIT_USAGE);
    expect(lines[0]).toContain("talk laps:");
  });
});

describe("readCardLaps", () => {
  it("reads only words inside the window: one before its floor and one at its ceiling sit on no look", () => {
    writeCall({
      entries: [
        segment({ atIso: "2026-10-01T23:59:59.000Z", id: "s-0", open: CARD, text: "before the window" }),
        segment({ atIso: "2026-10-04T10:00:00.000Z", id: "s-1", open: CARD, text: "ship it" }),
        segment({ atIso: NOW, id: "s-2", open: CARD, text: "at the ceiling" }),
      ],
    });
    const reading = readCardLaps({ claudeHome, home, nowIso: NOW, sinceIso: "2026-10-02T00:00:00.000Z" });
    expect(reading.cards.map((card) => [card.key, card.looks, card.laps, card.lastLookChars])).toEqual([
      [CARD, 1, 0, 7],
    ]);
  });

  it("reads no board for a plain reading, so a missing board names no gap", () => {
    const inputs = readLapsInputs({
      claudeHome,
      handoverDir: undefined,
      home,
      nowIso: NOW,
      sinceIso: "2026-10-02T00:00:00.000Z",
    });
    expect(inputs.gaps.map((gap) => gap.source)).toEqual(["supervisor"]);
  });
});
