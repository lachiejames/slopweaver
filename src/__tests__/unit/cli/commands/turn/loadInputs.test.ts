import { describe, expect, it } from "vitest";

import { mentionFromBrief, parseTurnArgs } from "../../../../../cli/commands/turn/loadInputs.js";
import { err, ok } from "../../../../../lib/result.js";
import type { AnswerableBrief } from "../../../../../live/turn/briefAnswerable.js";

describe("parseTurnArgs", () => {
  it("decodes a direct invocation's string and boolean flags", () => {
    expect(
      parseTurnArgs({
        rest: ["--brief", "/tmp/brief.json", "--answer", "/tmp/answer.json", "--delta-cleared", "--home", "/tmp/h"],
      }),
    ).toEqual(
      ok({
        positionals: [],
        values: { answer: "/tmp/answer.json", brief: "/tmp/brief.json", "delta-cleared": true, home: "/tmp/h" },
      }),
    );
  });

  it("refuses a misspelt flag, and the value it was given becomes a stray argument it also refuses", () => {
    expect(parseTurnArgs({ rest: ["--brief", "/tmp/brief.json", "--answr", "/tmp/answer.json"] })).toEqual(
      err(["unknown flag: --answr", "unexpected argument: /tmp/answer.json"]),
    );
  });
});

const BRIEF: AnswerableBrief = {
  channel: "C0123456789",
  messageTs: "1700000000.000200",
  question: "why did the staging pool exhaust?",
  surface: "channel",
  threadTs: "1700000000.000100",
  unavailableCapabilities: [],
  userId: "U0SYN123456789",
};

describe("mentionFromBrief", () => {
  it("projects the brief's channel, both timestamps, surface, question and asker onto the mention", () => {
    expect(mentionFromBrief({ brief: BRIEF })).toEqual({
      channel: "C0123456789",
      messageTs: "1700000000.000200",
      surface: "channel",
      text: "why did the staging pool exhaust?",
      threadTs: "1700000000.000100",
      userId: "U0SYN123456789",
    });
  });
});
