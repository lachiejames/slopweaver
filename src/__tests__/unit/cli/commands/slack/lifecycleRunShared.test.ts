import { describe, expect, it } from "vitest";

import { DEFAULT_GATES } from "../../../../../admit/door.js";
import { doorRefusalLines } from "../../../../../admit/doorRefusal.js";
import type { DoorDecision, DoorRequest } from "../../../../../admit/types.js";
import { NO_AUTHORED_PROSE, type VoiceGateInput, voiceProfileGate } from "../../../../../admit/voiceProfileGate.js";
import { gatesFor, reportRefusal, usage } from "../../../../../cli/commands/slack/lifecycleRunShared.js";
import { EXIT_USAGE } from "../../../../../cli/exitCodes.js";

/** A refusal carrying one hold, so rendering it reads nothing from the hatch register's journalled half. */
const HOLD_DECISION: DoorDecision = {
  findings: [
    {
      code: "ALPHA_HELD",
      correction: "post into the thread the card named",
      severity: "hold",
      summary: "the target is not the card's thread",
    },
  ],
  overridden: [],
  status: "hold",
};

/** A bot-lane lifecycle request, with nothing about it but the lane the voice gate reads. */
const BOT_REQUEST: DoorRequest = {
  action: { kind: "verb", noun: "slack", verb: "edit" },
  artifact: { actor: "bot" },
  meta: { createsWorkItem: false, effect: "external-write", home: null, requiresApproval: false },
};

/** Authored prose that breaks one phrase rule, so the voice gate has something to find. */
const BREAKING_VOICE: VoiceGateInput = {
  allowVoiceRules: false,
  prose: [{ path: "body", text: "circling back on the deploy" }],
  rules: [{ kind: "phrase", value: "circling back" }],
};

describe("usage", () => {
  it("prints each error on its own line, in order, and answers EXIT_USAGE", () => {
    const lines: string[] = [];
    const code = usage({
      errors: ["error-alpha", "error-bravo"],
      writeError: ({ msg }) => {
        lines.push(msg);
      },
    });
    expect(code).toBe(EXIT_USAGE);
    expect(lines).toEqual(["error-alpha", "error-bravo"]);
  });

  it("prints nothing for an empty list and still answers EXIT_USAGE", () => {
    const lines: string[] = [];
    const code = usage({
      errors: [],
      writeError: ({ msg }) => {
        lines.push(msg);
      },
    });
    expect(code).toBe(EXIT_USAGE);
    expect(lines).toEqual([]);
  });
});

describe("reportRefusal", () => {
  it("prints the door's refusal lines for this lifecycle command, in order", () => {
    const lines: string[] = [];
    reportRefusal({
      decision: HOLD_DECISION,
      writeError: ({ msg }) => {
        lines.push(msg);
      },
    });
    expect(lines).toEqual(doorRefusalLines({ command: "this slack lifecycle operation", decision: HOLD_DECISION }));
    expect(lines[0]).toBe("the door did not admit this (hold). Nothing was changed.");
    expect(lines[1]).toBe(
      "this slack lifecycle operation blocked because the target is not the card's thread [ALPHA_HELD].",
    );
  });
});

describe("gatesFor", () => {
  it("is the default gates plus exactly one voice gate", () => {
    const gates = gatesFor({ voice: BREAKING_VOICE });
    expect(gates.length).toBe(DEFAULT_GATES.length + 1);
    expect(gates.slice(0, DEFAULT_GATES.length)).toEqual(DEFAULT_GATES);
  });

  it("installs a voice gate built from the input it was handed", () => {
    const gates = gatesFor({ voice: BREAKING_VOICE });
    const findings = gates.at(-1)!(BOT_REQUEST);
    expect(findings).toEqual(voiceProfileGate(BREAKING_VOICE)(BOT_REQUEST));
    expect(findings.map((finding) => finding.code)).toEqual(["VOICE_RULE_BROKEN"]);
  });

  it("still installs the voice gate for a mutation that authors nothing, which then finds nothing", () => {
    const gates = gatesFor({ voice: NO_AUTHORED_PROSE });
    expect(gates.length).toBe(DEFAULT_GATES.length + 1);
    expect(gates.at(-1)!(BOT_REQUEST)).toEqual([]);
  });
});
