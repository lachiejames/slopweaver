import { describe, expect, it } from "vitest";

import { formatTurnPointer, parseTurnPointer, TURN_POINTER_SCHEME } from "../../../transcripts/pointer.js";

const SESSION = "a0000013-0000-4000-8000-000000000014";
const TURN = "0a335102-005d-4f3d-a2e3-cbbf3fd794c0";

describe("turn pointers", () => {
  it("round-trips the canonical form", () => {
    const text = formatTurnPointer({ pointer: { sessionId: SESSION, turnUuid: TURN } });

    expect(text).toBe(`${TURN_POINTER_SCHEME}${SESSION}#${TURN}`);
    expect(parseTurnPointer({ text })).toEqual({ sessionId: SESSION, turnUuid: TURN });
  });

  it("tolerates surrounding whitespace, which a pasted anchor often carries", () => {
    expect(parseTurnPointer({ text: `  transcript:${SESSION}#${TURN}\n` })).toEqual({
      sessionId: SESSION,
      turnUuid: TURN,
    });
  });

  it("is not a Slack permalink, a GitHub URL, or a bare uuid", () => {
    expect(parseTurnPointer({ text: "https://example.slack.com/archives/C1/p1788220579306599" })).toBeUndefined();
    expect(parseTurnPointer({ text: "https://github.com/o/r/pull/246" })).toBeUndefined();
    expect(parseTurnPointer({ text: SESSION })).toBeUndefined();
  });

  it("refuses a pointer whose halves are not uuids — a line number or a workspace name would rot", () => {
    expect(parseTurnPointer({ text: `transcript:${SESSION}#11` })).toBeUndefined();
    expect(parseTurnPointer({ text: `transcript:supervisor#${TURN}` })).toBeUndefined();
    expect(parseTurnPointer({ text: `transcript:${SESSION}` })).toBeUndefined();
    expect(parseTurnPointer({ text: `transcript:${SESSION.toUpperCase()}#${TURN}` })).toBeUndefined();
  });
});
