/**
 * Building, decoding and projecting the v6 BRIEF — `buildTurnRoutingBrief`, `parseTurnRoutingBrief`, and the
 * answerable projection `turn answer`/`turn resume` actually read. Pure, so every case is a plain call.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { buildTurnRoutingBrief, parseTurnRoutingBrief, TURN_BRIEF_VERSION } from "../../../../../live/turn/brief.js";
import { answerableProjectionOf, parseAnswerableBrief } from "../../../../../live/turn/briefAnswerable.js";
import { brief, ROUTING_INPUT, UNAVAILABLE_CAPABILITY } from "./harness.js";

describe("buildTurnRoutingBrief", () => {
  it("stamps the version, so a stale brief is refused by name rather than crashing", () => {
    expect(brief({ question: "what are my open PRs?" }).version).toBe(TURN_BRIEF_VERSION);
  });

  it("carries no `started` field when none was given, so a hand-driven brief is unaffected", () => {
    expect(Object.keys(brief({ question: "what did we decide?" }))).not.toContain("started");
  });

  it("carries no pre-decided `route`/`plan` field, even for a message no capability matches", () => {
    const keys = Object.keys(brief({ question: "yo" }));
    expect(keys).not.toContain("route");
    expect(keys).not.toContain("plan");
  });

  it("omits otherActiveAsks entirely when the asker has nothing else running", () => {
    expect(Object.keys(brief({ question: "what are my open PRs?" }))).not.toContain("otherActiveAsks");
  });

  it("carries the asker's own in-flight asks, so a follow-up is judged against what is already running", () => {
    const built = buildTurnRoutingBrief({
      channel: "C1",
      messageTs: "1.2",
      otherActiveAsks: [{ channel: "C1", messageTs: "1.1", state: "dispatched", threadTs: "1.1", userId: "U_ASKER" }],
      question: "also, what about the alert?",
      routingInput: ROUTING_INPUT,
      surface: "channel",
      threadTs: "1.1",
      unavailableCapabilities: [],
      userId: "U_ASKER",
    });

    expect(built.otherActiveAsks).toEqual([
      { channel: "C1", messageTs: "1.1", state: "dispatched", threadTs: "1.1", userId: "U_ASKER" },
    ]);
    expect(unwrap(parseTurnRoutingBrief({ raw: JSON.parse(JSON.stringify(built)) })).otherActiveAsks).toEqual(
      built.otherActiveAsks,
    );
  });

  it("carries `started` through untouched when the listener already posted a checklist", () => {
    const built = buildTurnRoutingBrief({
      channel: "C1",
      messageTs: "1.1",
      question: "what did we decide?",
      routingInput: ROUTING_INPUT,
      started: { turnId: "turn-1", workingTs: "1712345678.000300" },
      surface: "channel",
      threadTs: "1.1",
      unavailableCapabilities: [],
      userId: "U_ASKER",
    });

    expect(built.started).toEqual({ turnId: "turn-1", workingTs: "1712345678.000300" });
  });
});

describe("parseTurnRoutingBrief", () => {
  it("round-trips a built brief through JSON exactly", () => {
    const built = brief({ question: "what are my open PRs?" });
    const parsed = unwrap(parseTurnRoutingBrief({ raw: JSON.parse(JSON.stringify(built)) }));
    expect(parsed).toEqual(built);
  });

  it("refuses a brief at the wrong version by name", () => {
    const stale = { ...brief({ question: "what did we decide?" }), version: 5 };
    const error = unwrapErr(parseTurnRoutingBrief({ raw: stale }));
    expect(error.code).toBe("BRIEF_VERSION_MISMATCH");
    expect(error.message).toContain("version 5");
  });

  it("refuses a value that is not an object", () => {
    const error = unwrapErr(parseTurnRoutingBrief({ raw: "not an object" }));
    expect(error.code).toBe("BRIEF_NOT_AN_OBJECT");
    expect(error.message).toContain("not a JSON object");
  });

  it("refuses a brief missing a required string field", () => {
    const { question, ...rest } = brief({ question: "what did we decide?" });
    const error = unwrapErr(parseTurnRoutingBrief({ raw: rest }));
    expect(error.code).toBe("BRIEF_MISSING_FIELDS");
    expect(error.message).toContain("question");
  });
});

describe("parseAnswerableBrief / answerableProjectionOf", () => {
  it("projects down to exactly the answerable fields, dropping routingInput", () => {
    const built = brief({ question: "what did we decide?" });
    const projected = answerableProjectionOf({ brief: built });
    expect(projected).toEqual({
      channel: "C1",
      messageTs: "1.1",
      question: "what did we decide?",
      surface: "channel",
      threadTs: "1.1",
      unavailableCapabilities: [UNAVAILABLE_CAPABILITY],
      userId: "U_ASKER",
    });
  });

  it("parses through the SAME full decoder, never a second looser shape", () => {
    const built = brief({ question: "what did we decide?" });
    const parsed = unwrap(parseAnswerableBrief({ raw: JSON.parse(JSON.stringify(built)) }));
    expect(parsed).toEqual(answerableProjectionOf({ brief: built }));
  });
});
