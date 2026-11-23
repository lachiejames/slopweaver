/**
 * `talk fidelity`'s body over a fixture home: one voice call where
 * the voice moved "powerful" from an option's trade-off into the problem and opened on "Right now" — which the word
 * reading (`--words`) sees and the claim reading does not, since no number, quote or negation changed — and one call
 * for the claim reading, the default.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { parseFidelityArgs } from "../../../cli/commands/talk/callArgs.js";
import { talkFidelity } from "../../../cli/commands/talk/fidelityRun.js";
import { EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../cli/exitCodes.js";
import { unwrap } from "../../../lib/result.js";
import { callsDir } from "../../../talk/callStore.js";

const CALL = "a0000075-0000-4000-8000-000000000082";

const HANDED = "Uploading a page needs a service key. Option A exposes the powerful key.";
const SPOKEN = "Right now uploading a page needs a powerful service key.";

/** One voice call: two handed messages, the first said with a word added and one moved, the second said as handed. */
const LINES = [
  { atIso: "2026-11-01T03:00:00.000Z", kind: "open", model: "realtime-v3", sessionId: "s-1", voice: "spruce" },
  { atIso: "2026-11-01T03:01:00.000Z", itemId: "msg-1", kind: "wrote", text: HANDED, turnId: "turn-1" },
  {
    atIso: "2026-11-01T03:01:01.000Z",
    beganIso: "2026-11-01T03:01:01.000Z",
    final: true,
    id: "seg-v1",
    kind: "segment",
    text: SPOKEN,
    who: "voice",
  },
  {
    atIso: "2026-11-01T03:02:00.000Z",
    itemId: "msg-2",
    kind: "wrote",
    text: "The card does not say.",
    turnId: "turn-2",
  },
  {
    atIso: "2026-11-01T03:02:01.000Z",
    beganIso: "2026-11-01T03:02:01.000Z",
    final: true,
    id: "seg-v2",
    kind: "segment",
    text: "The card does not say.",
    who: "voice",
  },
];

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "fidelity-"));
  mkdirSync(callsDir({ home }), { recursive: true });
  writeFileSync(join(callsDir({ home }), `${CALL}.jsonl`), `${LINES.map((line) => JSON.stringify(line)).join("\n")}\n`);
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** Run the verb's body over the fixture home, collecting what it prints. */
function run({ rest }: { rest: readonly string[] }): { readonly code: number; readonly lines: readonly string[] } {
  const lines: string[] = [];
  const code = talkFidelity({
    args: unwrap(parseFidelityArgs({ rest })),
    home,
    nowIso: "2026-11-02T00:00:00.000Z",
    out: (line) => {
      lines.push(line);
    },
  });
  return { code, lines };
}

/** A second call for the claim reading: a turn read a tool answer, wrote a swapped number, and the voice dropped a claim. */
const CLAIM_CALL = "22222222-2222-4333-8444-555555555555";

/** The claim call's lines: the tool answer names its turn, as current tool lines do. */
const CLAIM_LINES = [
  { atIso: "2026-11-01T04:00:00.000Z", kind: "open", model: "realtime-v3", sessionId: "s-2", voice: "spruce" },
  {
    answer: JSON.stringify({ text: "The pool holds 14 connections. The replica backup was not checked." }),
    atIso: "2026-11-01T04:00:30.000Z",
    detail: "read the card",
    kind: "tool",
    name: "read_card",
    refused: false,
    turnId: "turn-a",
  },
  {
    atIso: "2026-11-01T04:01:00.000Z",
    itemId: "msg-a",
    kind: "wrote",
    text: "The pool holds 13 connections. The replica backup was not checked.",
    turnId: "turn-a",
  },
  {
    atIso: "2026-11-01T04:01:01.000Z",
    beganIso: "2026-11-01T04:01:01.000Z",
    final: true,
    id: "seg-a",
    kind: "segment",
    text: "The pool holds 13 connections. Should we schedule a migration tomorrow?",
    who: "voice",
  },
];

describe("talkFidelity's claim reading, the default", () => {
  beforeEach(() => {
    writeFileSync(
      join(callsDir({ home }), `${CLAIM_CALL}.jsonl`),
      `${CLAIM_LINES.map((line) => JSON.stringify(line)).join("\n")}\n`,
    );
  });

  it("reads both hops: the number the answer swapped from its source, and the claim the voice dropped and added", () => {
    const { code, lines } = run({ rest: ["--call", CLAIM_CALL, "--json"] });
    expect(code).toBe(EXIT_OK);
    const document = JSON.parse(lines[0]!) as {
      pairs: { hop: string; toolAnswers: number; findings: { kind: string; detail: string }[] }[];
      unsourced: number;
    };
    expect(
      document.pairs.map((pair) => [pair.hop, pair.toolAnswers, pair.findings.map((one) => [one.kind, one.detail])]),
    ).toEqual([
      ["source-to-answer", 1, [["swapped-detail", "14 → 13"]]],
      [
        "answer-to-voice",
        0,
        [
          ["added-question", "nothing handed says it"],
          ["dropped-claim", "a negated claim, unsaid"],
        ],
      ],
    ]);
    expect(document.unsourced).toBe(0);
  });

  it("heads on the calibrated kinds only, prints every kind's grade, and names the rest uncalibrated", () => {
    const text = run({ rest: ["--call", CLAIM_CALL] });
    expect(text.lines.slice(1, 4)).toEqual([
      "  1 of 1 spoken answer(s) dropped a handed claim or added a question (dropped-claim, added-question: the kinds " +
        "hand-graded real at least 80% of the time)",
      "  hand-graded real: dropped-claim 86% of 37 · dropped-detail 56% of 9 · swapped-detail ungraded · " +
        "polarity-flip 5% of 40 · added-claim 72% of 29 · added-question 96% of 25 · unsourced-detail 63% of 24 · " +
        "misquote 71% of 28",
      "  uncalibrated, so counted and never a figure to quote: dropped-detail, swapped-detail, polarity-flip, " +
        "added-claim, unsourced-detail, misquote",
    ]);
    const document = JSON.parse(run({ rest: ["--call", CLAIM_CALL, "--json"] }).lines[0]!) as {
      uncalibratedKinds: string[];
    };
    expect(document.uncalibratedKinds).toEqual([
      "dropped-detail",
      "swapped-detail",
      "polarity-flip",
      "added-claim",
      "unsourced-detail",
      "misquote",
    ]);
  });
});

describe("talkFidelity --words", () => {
  it("prints the candidate headline, the day's counts and the one divergent pair, anchored to its segment", () => {
    expect(run({ rest: ["--since", "2026-11-01T00:00:00Z", "--words"] })).toEqual({
      code: EXIT_OK,
      lines: [
        "talk fidelity: CANDIDATE divergence (word overlap, never meaning: a synonym reads as added; never " +
          "hand-graded, so not a figure to quote) — 1 of 2 handed " +
          "message(s) the voice added to or moved a word within, across 1 voice call(s) read",
        "  day         pairs  +added  ~moved  per 100 spoken words (added / moved)",
        // Ten content words spoken: right, now, uploading, page, need, powerful, service, key; then card, not.
        "  2026-11-01      2       1       1  20.0 / 10.0",
        `  2026-11-01T03:01:00.000Z  talk-call:${CALL}#seg-v1`,
        "    added: right, now · moved: powerful",
        `    handed: ${HANDED}`,
        `    said:   ${SPOKEN}`,
      ],
    });
  });

  it("reads one named call whole, whatever the window", () => {
    const { code, lines } = run({ rest: ["--call", CALL, "--json", "--words"] });
    expect(code).toBe(EXIT_OK);
    const document = JSON.parse(lines[0]!) as {
      divergentPairs: number;
      handGraded: boolean;
      totalPairs: number;
      voiceCalls: number;
    };
    expect([document.divergentPairs, document.totalPairs, document.voiceCalls, document.handGraded]).toEqual([
      1,
      2,
      1,
      false,
    ]);
  });
});

describe("talkFidelity's refusals", () => {
  it("exits 3 for a named call with no file", () => {
    const missing = "99999999-2222-4333-8444-555555555555";
    expect(run({ rest: ["--call", missing] })).toEqual({
      code: EXIT_EXPECTED_EMPTY,
      lines: [`talk fidelity: no readable call ${missing} on file`],
    });
  });

  it("exits 2 on a window that will not parse", () => {
    const { code, lines } = run({ rest: ["--since", "yesterday-ish"] });
    expect(code).toBe(EXIT_USAGE);
    expect(lines[0]).toContain("talk fidelity: ");
  });
});
