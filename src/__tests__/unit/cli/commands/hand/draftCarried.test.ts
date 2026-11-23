/*
 * The effectful half of the undrawn-draft gate, over a real run journal in a throwaway home: a step saying "drafted
 * as you" proceeds only when it names a parked draft or opens an ask offering the message, and the hatch lets it
 * through while still saying what its card will lack.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { undrawnDraftExit } from "../../../../../cli/commands/hand/draftCarried.js";
import { EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import type { HandStep } from "../../../../../hand/step.js";

let home: string;
let lines: string[];

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "draft-carried-"));
  lines = [];
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

const STEP: HandStep = {
  id: "iso-reply",
  postedBy: "a-session",
  postedIso: "2026-09-27T08:00:00.000Z",
  unblocks: "closing #17344",
  url: "http://localhost:3000/queue?open=ask%3Aiso-reply",
  what: "Read the reply to Rosa drafted as you, and say whether to post it",
  witness: "slopweaver hand done iso-reply --did 'yes or hold'",
};

/** The `iso-reply` run's journal: started, asked, and — when `offered` — a reply as the owner attached. */
function journal({ offered }: { offered: boolean }): void {
  const question = "Can I post this reply as you in the ISO thread?";
  const events: unknown[] = [
    { atIso: "2026-09-26T08:00:00.000Z", branch: "iso", docHash: "h1", kind: "started" },
    { atIso: "2026-09-26T08:10:00.000Z", kind: "question", question },
  ];
  if (offered) {
    events.push({
      action: {
        actor: "me",
        body: "<@U0SYN000002> happy for me to upload it?",
        destinations: [{ channel: "C0SYN000001", kind: "channel", label: "#proj-iso", tradeoff: "under your name" }],
        mentions: [{ label: "Rosa Lindqvist", userId: "U0SYN000002" }],
        version: 1,
      },
      atIso: "2026-09-26T08:25:00.000Z",
      kind: "question-offered",
      lean: "post it",
      options: [
        { letter: "A", option: "#proj-iso", tradeoff: "under your name" },
        { letter: "B", option: "Hold it — send nothing for now", tradeoff: "the draft goes stale" },
      ],
      problem: "change management waits on Rosa",
      question,
    });
  }
  mkdirSync(join(home, "runs"), { recursive: true });
  writeFileSync(join(home, "runs", "iso-reply.jsonl"), events.map((event) => `${JSON.stringify(event)}\n`).join(""));
}

function exitOf({ step, env = {} }: { step: HandStep; env?: Record<string, string> }): number | undefined {
  return undrawnDraftExit({ env, home, step, write: (line) => lines.push(line) });
}

describe("undrawnDraftExit", () => {
  it("proceeds silently when the ask the step opens offers the reply", () => {
    journal({ offered: true });
    expect(exitOf({ step: STEP })).toBe(undefined);
    expect(lines).toEqual([]);
  });

  it("refuses when the ask the step opens offers no message", () => {
    journal({ offered: false });
    expect(exitOf({ step: STEP })).toBe(EXIT_USAGE);
    expect(lines[0]).toContain("it names no parked draft, and the ask it opens offers no message");
  });

  it("refuses when the opened ask has no journal at all, never reading a missing file as an offer", () => {
    expect(exitOf({ step: STEP })).toBe(EXIT_USAGE);
    expect(lines[0]).toContain("it names no parked draft, and the ask it opens offers no message");
  });

  it("refuses a step that opens no ask", () => {
    const { url: _dropped, ...bare } = STEP;
    expect(exitOf({ step: bare })).toBe(EXIT_USAGE);
    expect(lines[0]).toContain('it says "drafted as you", and it names no parked draft and opens no ask');
  });

  it("proceeds, saying so, past the hatch", () => {
    expect(exitOf({ env: { SLOPWEAVER_ALLOW_UNDRAWN_DRAFT: "1" }, step: STEP })).toBe(undefined);
    expect(lines).toEqual([
      'recorded past SLOPWEAVER_ALLOW_UNDRAWN_DRAFT=1: it says "drafted as you" and carries no draft, so its card ' +
        "will say the draft is missing",
    ]);
  });

  it("never reads the journal for a step naming no draft as the owner", () => {
    expect(exitOf({ step: { ...STEP, what: "Say whether to close #17344" } })).toBe(undefined);
    expect(lines).toEqual([]);
  });
});
