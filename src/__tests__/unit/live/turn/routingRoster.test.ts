/**
 * The WHOLE roster path, end to end and pure: inventory → producer → brief → JSON → decoder → renderer, and
 * then the judge.
 *
 * Each of those seams was individually correct and the path between them was not. `judgement.ts`
 * had declared, validated and documented `historicalCapabilities`; `grep -rn historicalCapabilities
 * src | grep -v __tests__` found eleven hits and every one was a CONSUMER. No producer existed, the persisted
 * brief's schema did not decode the field, and the renderer had no section for it — so a history question
 * reached a worker with a roster of current legs and the brief's own contract promising "AVAILABLE or
 * HISTORICAL". Nothing failed. That is why this file walks the seams in one go rather than testing each alone:
 * every unit test in the tree passed while the path was broken.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import {
  buildTurnRoutingBrief,
  parseTurnRoutingBrief,
  renderTurnRoutingBrief,
  TURN_BRIEF_VERSION,
} from "../../../../live/turn/brief.js";
import { BriefParseErrors } from "../../../../live/turn/errors.js";
import { judgeRouting, type RoutingDecision, type RoutingJudgementInput } from "../../../../live/turn/judgement.js";
import { routingInputForTurn } from "../../../../live/turn/routingContext.js";
import { buildRoutingCapabilities } from "../../../../route/routingCapabilities.js";

const HISTORY_QUESTION =
  "what did we decide about zero sensitive logs, and who still has to sign off on it? i want the history, not the current state";

/** The inventory exactly as `turn brief` builds it for the ask that produced this finding. */
const capabilities = buildRoutingCapabilities({
  question: HISTORY_QUESTION,
  slopweaverCommand: "/abs/bin/slopweaver",
});

/** The routing input exactly as the producer assembles it. */
const routingInput: RoutingJudgementInput = routingInputForTurn({
  briefTarget: {
    channel: "D1",
    messageTs: "1789000001.000100",
    question: HISTORY_QUESTION,
    surface: "dm",
    threadTs: "1789000001.000100",
    userId: "U_OWNER",
  },
  capabilities,
  execution: { mode: "single-turn", supervisorHost: "claude-code" },
});

const brief = buildTurnRoutingBrief({
  channel: "D1",
  messageTs: "1789000001.000100",
  question: HISTORY_QUESTION,
  routingInput,
  surface: "dm",
  threadTs: "1789000001.000100",
  unavailableCapabilities: capabilities.unavailable,
  userId: "U_OWNER",
});

describe("the roster path — a history question reaches a worker with a history leg on it", () => {
  it("the producer carries the inventory's history into the judgement input", () => {
    expect(routingInput.historicalCapabilities?.map((capability) => capability.id)).toContain("corpus");
  });

  it("writes the history array even when it is empty, so absence never reads as `this build has no history`", () => {
    const empty = routingInputForTurn({
      briefTarget: {
        channel: "D1",
        messageTs: "1.1",
        question: "yo",
        surface: "dm",
        threadTs: "1.1",
        userId: "U_OWNER",
      },
      capabilities: { available: [], historical: [], unavailable: [] },
      execution: { mode: "single-turn", supervisorHost: "claude-code" },
    });
    expect(empty.historicalCapabilities).toEqual([]);
  });

  it("survives the JSON round-trip the four turn verbs are separated by, field for field", () => {
    const decoded = unwrap(parseTurnRoutingBrief({ raw: JSON.parse(JSON.stringify(brief)) as unknown }));
    expect(decoded.routingInput.historicalCapabilities).toEqual(routingInput.historicalCapabilities);
  });

  it("keeps the history leg's whole contract through the round-trip, not just its id", () => {
    const decoded = unwrap(parseTurnRoutingBrief({ raw: JSON.parse(JSON.stringify(brief)) as unknown }));
    const history = decoded.routingInput.historicalCapabilities!.find((capability) => capability.id === "corpus")!;
    expect(history.truthMode).toBe("history");
    expect(history.command).toEqual(["/abs/bin/slopweaver", "store", "read", HISTORY_QUESTION]);
  });

  it("still parses a brief written before the field existed, rather than refusing it by version", () => {
    const legacy = JSON.parse(JSON.stringify(brief)) as { routingInput: Record<string, unknown> };
    delete legacy.routingInput["historicalCapabilities"];
    const decoded = unwrap(parseTurnRoutingBrief({ raw: legacy }));
    expect(decoded.version).toBe(TURN_BRIEF_VERSION);
    expect(decoded.routingInput.historicalCapabilities).toBe(undefined);
  });

  it("REFUSES a present-but-malformed history array rather than silently dropping it", () => {
    const broken = JSON.parse(JSON.stringify(brief)) as { routingInput: Record<string, unknown> };
    broken.routingInput["historicalCapabilities"] = [{ id: "corpus" }];
    expect(unwrapErr(parseTurnRoutingBrief({ raw: broken })).code).toBe(BriefParseErrors.invalidRoutingInput().code);
  });

  it("renders the history leg under its own heading in the brief the session actually reads", () => {
    const rendered = renderTurnRoutingBrief({
      brief,
      briefPath: "/tmp/brief.json",
      painPoints: [],
      skills: [],
      tagTree: [],
    }).join("\n");
    expect(rendered).toContain("HISTORICAL (reachable, and what was said/decided/recorded");
    expect(rendered).toContain("corpus [HISTORICAL] — history/read/corpus");
  });

  it("renders the contract's promise and the section it promises in the SAME brief", () => {
    const rendered = renderTurnRoutingBrief({
      brief,
      briefPath: "/tmp/brief.json",
      painPoints: [],
      skills: [],
      tagTree: [],
    }).join("\n");
    expect(rendered).toContain("AVAILABLE or HISTORICAL");
    expect(rendered).toContain("corpus [HISTORICAL]");
  });

  it("no longer prints `audit` as a corpus leg, so nothing on the roster impersonates history", () => {
    const rendered = renderTurnRoutingBrief({
      brief,
      briefPath: "/tmp/brief.json",
      painPoints: [],
      skills: [],
      tagTree: [],
    }).join("\n");
    expect(rendered).toContain("audit [available] — current/read/artifact");
    expect(rendered).not.toContain("audit [available] — current/read/corpus");
  });
});

describe("the roster path — what the judge does with the history leg now that it is offered", () => {
  const judged = ({ decision }: { decision: RoutingDecision }) =>
    judgeRouting({ context: routingInput, judgement: () => decision });

  it("accepts a `history` claim carried by the world model alone — the ask this finding came from", () => {
    const decision: RoutingDecision = {
      confidence: "high",
      needs: [{ capabilityId: "corpus", reason: "what was decided is in the record", requirement: "required" }],
      rationale: "the owner asked for the history, not the current state",
      response: "respond",
      schemaVersion: 1,
      tier: "fresh-visible-session",
      truthMode: "history",
    };
    expect(unwrap(judged({ decision })).response).toBe("respond");
  });

  it("still REFUSES a `current` claim assembled from that leg alone — offering history widened nothing", () => {
    const decision: RoutingDecision = {
      confidence: "high",
      needs: [{ capabilityId: "corpus", reason: "the corpus mentions it", requirement: "required" }],
      rationale: "asserting present state off the record",
      response: "respond",
      schemaVersion: 1,
      tier: "inline",
      truthMode: "current",
    };
    expect(unwrapErr(judged({ decision })).join(" ")).toContain("from historical legs alone");
  });

  it("accepts a `current` claim that pairs the history leg with a live one — the brief's own advice", () => {
    const decision: RoutingDecision = {
      confidence: "high",
      needs: [
        { capabilityId: "corpus", reason: "find the candidate decision", requirement: "required" },
        { capabilityId: "handover-list", reason: "check whether it still holds", requirement: "required" },
      ],
      rationale: "corpus finds it, the live leg checks it",
      response: "respond",
      schemaVersion: 1,
      tier: "fresh-visible-session",
      truthMode: "current",
    };
    expect(unwrap(judged({ decision })).response).toBe("respond");
  });

  it("refuses the RETIRED `world-model` id, which names no capability in any table", () => {
    const decision: RoutingDecision = {
      confidence: "high",
      needs: [{ capabilityId: "world-model", reason: "read the corpus", requirement: "required" }],
      rationale: "naming the retired spelling",
      response: "respond",
      schemaVersion: 1,
      tier: "inline",
      truthMode: "history",
    };
    // Refused for NAMING NOTHING, never for being reserved: the roster offers `corpus`, so the retired
    // spelling reaches the same refusal any invented id does. Reserving it would refuse a pre-rename
    // BRIEF too, which `../../../route/liveCapabilityPolicy.ts` explains at length.
    expect(unwrapErr(judged({ decision })).join(" ")).toContain(
      'live need "world-model" does not name any capability this context offers',
    );
  });

  it("refuses an id no partition offers, so the three sets really are the vocabulary", () => {
    const decision: RoutingDecision = {
      confidence: "high",
      needs: [{ capabilityId: "slack-history", reason: "invented", requirement: "required" }],
      rationale: "naming a leg nobody declared",
      response: "respond",
      schemaVersion: 1,
      tier: "inline",
      truthMode: "history",
    };
    expect(unwrapErr(judged({ decision })).join(" ")).toContain("does not name any capability this context offers");
  });
});
