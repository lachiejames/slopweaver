import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { parseCutInsArgs } from "../../../cli/commands/talk/callArgs.js";
import { talkCutIns } from "../../../cli/commands/talk/cutInsRun.js";
import { EXIT_OK, EXIT_USAGE } from "../../../cli/exitCodes.js";
import { unwrap } from "../../../lib/result.js";
import { callsDir } from "../../../talk/callStore.js";

const CALL = "a0000030-0000-4000-8000-000000000033";

/** Lines of a call as written — its Codex turn and the reported segment among them — then a torn last line. */
const LINES = [
  { atIso: "2026-10-06T10:46:45.547Z", kind: "open", model: "realtime-v3", sessionId: "s-1", voice: "spruce" },
  {
    atIso: "2026-10-06T11:41:00.019Z",
    detail: "turn a0000002-0000-4000-8000-000000000002 started",
    kind: "tool",
    name: "codex",
    refused: false,
  },
  {
    atIso: "2026-10-06T11:41:30.887Z",
    detail: "turn a0000002-0000-4000-8000-000000000002 completed",
    kind: "tool",
    name: "codex",
    refused: false,
  },
  {
    atIso: "2026-10-06T11:41:41.267Z",
    final: false,
    id: "turn_000000000000000000012",
    kind: "segment",
    text: " Yes, that's it — make the change. Next card is Sorry, this one's slow. I'm writing some of it up. Park",
    who: "voice",
  },
  {
    atIso: "2026-10-06T11:41:44.809Z",
    final: true,
    id: "turn_000000000000000000012",
    kind: "segment",
    text: " Yes, that's it — make the change. Next card is Sorry, this one's slow. I'm writing some of it up. Park this one?",
    who: "voice",
  },
  {
    atIso: "2026-10-06T11:42:40.698Z",
    final: true,
    id: "turn_000000000000000000013",
    kind: "segment",
    text: " Uh, that was weird. It kind of sound like you started saying one thing",
    who: "owner",
  },
];

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "cut-ins-"));
  mkdirSync(callsDir({ home }), { recursive: true });
  const body = `${LINES.map((line) => JSON.stringify(line)).join("\n")}\n{"atIso":"2026-10-06T11:4`;
  writeFileSync(join(callsDir({ home }), `${CALL}.jsonl`), body);
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** Run the verb's body over the fixture home, collecting what it prints. */
function run({ rest }: { rest: readonly string[] }): { readonly code: number; readonly lines: readonly string[] } {
  const lines: string[] = [];
  const code = talkCutIns({
    args: unwrap(parseCutInsArgs({ rest })),
    home,
    nowIso: "2026-10-08T16:00:00.000Z",
    out: (line) => {
      lines.push(line);
    },
  });
  return { code, lines };
}

describe("talk cut-ins", () => {
  it("reports the reported cut-in once, anchored to its turn, and names the torn line as a gap", () => {
    const { code, lines } = run({ rest: ["--json"] });
    expect(code).toBe(EXIT_OK);
    expect(JSON.parse(lines[0]!)).toEqual({
      calls: 1,
      cutIns: [
        {
          anchor: `talk-call:${CALL}#turn_000000000000000000012`,
          atIso: "2026-10-06T11:41:44.809Z",
          before: "Yes, that's it — make the change. Next card is",
          callId: CALL,
          line: "Sorry, this one's slow. I'm writing some of it up.",
          likelyTurnId: "a0000002-0000-4000-8000-000000000002",
        },
      ],
      gaps: [`${CALL}: 1 line(s) did not parse, so a cut-in in one is not counted`],
      observedAtIso: "2026-10-08T16:00:00.000Z",
      ok: true,
      sinceIso: "2026-08-09T16:00:00.000Z",
    });
  });

  it("counts nothing before its floor, while still saying how many calls it read", () => {
    const { lines } = run({ rest: ["--since", "2026-10-07T00:00:00Z", "--json"] });
    const report = JSON.parse(lines[0]!) as { calls: number; cutIns: readonly unknown[] };
    expect([report.calls, report.cutIns]).toEqual([1, []]);
  });

  it("prints the count, the anchor and the words the line landed after", () => {
    const { lines } = run({ rest: [] });
    expect(lines).toEqual([
      "talk cut-ins: 1 answer(s) cut into by what reads as the console's own progress line, across 1 voice call(s) since 2026-08-09T16:00:00.000Z",
      `  2026-10-06T11:41:44.809Z  talk-call:${CALL}#turn_000000000000000000012  most likely from Codex turn a0000002-0000-4000-8000-000000000002`,
      "    …Yes, that's it — make the change. Next card is ⟶ Sorry, this one's slow. I'm writing some of it up.",
      `  not read whole — ${CALL}: 1 line(s) did not parse, so a cut-in in one is not counted`,
    ]);
  });

  it("refuses a floor that is neither an instant nor a span", () => {
    const { code, lines } = run({ rest: ["--since", "last tuesday"] });
    expect(code).toBe(EXIT_USAGE);
    expect(lines[0]).toContain("--since last tuesday is neither an instant nor a span");
  });
});
