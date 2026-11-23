/**
 * The voice gate at the door: the actor split applied off the REQUEST, the two absences that are not a
 * finding, and the one that is.
 *
 * Every assertion names the code and the path, never a count alone: a gate that returns the right NUMBER of
 * findings for the wrong lane is the defect this module was written to stop, and a length check passes it.
 */
import { describe, expect, it } from "vitest";

import type { DoorRequest } from "../../../admit/types.js";
import {
  NO_AUTHORED_PROSE,
  VOICE_PROFILE_OVERRIDE,
  voiceInputFor,
  voiceProfileFindings,
  voiceProfileGate,
} from "../../../admit/voiceProfileGate.js";
import type { AuthoredProse, ExactVoiceRule } from "../../../outbound/voice/exactRules.js";

const BOTH: ExactVoiceRule = { kind: "literal", value: "—" };
const ME_ONLY: ExactVoiceRule = { actors: ["me"], kind: "word", value: "delve" };
const BOT_ONLY: ExactVoiceRule = { actors: ["bot"], kind: "phrase", value: "happy to help" };
const RULES = [BOTH, ME_ONLY, BOT_ONLY];

const PROSE: readonly AuthoredProse[] = [{ path: "tldr", text: "happy to help — let me delve into it" }];

/** A door request on one lane, with nothing on it but the field the gate reads. */
function requestFor({ actor }: { actor: string | undefined }): DoorRequest {
  return {
    action: { kind: "verb", noun: "slack", verb: "post" },
    artifact: actor === undefined ? {} : { actor },
    meta: { createsWorkItem: false, effect: "external-write", home: "/tmp/home", requiresApproval: false },
  };
}

describe("voiceProfileFindings", () => {
  it("applies the me lane's rules and not the bot's", () => {
    expect(voiceProfileFindings({ actor: "me", prose: PROSE, rules: RULES })).toStrictEqual([
      {
        code: "VOICE_RULE_BROKEN",
        correction: "rewrite the authored prose, or send it unchanged past the override token with a stated reason",
        override: VOICE_PROFILE_OVERRIDE,
        severity: "warn",
        summary: 'tldr matches the configured literal voice rule "—" for the me lane',
      },
      {
        code: "VOICE_RULE_BROKEN",
        correction: "rewrite the authored prose, or send it unchanged past the override token with a stated reason",
        override: VOICE_PROFILE_OVERRIDE,
        severity: "warn",
        summary: 'tldr matches the configured word voice rule "delve" for the me lane',
      },
    ]);
  });

  it("applies the bot lane's rules and not the me lane's", () => {
    expect(
      voiceProfileFindings({ actor: "bot", prose: PROSE, rules: RULES }).map((finding) => finding.summary),
    ).toStrictEqual([
      'tldr matches the configured literal voice rule "—" for the bot lane',
      'tldr matches the configured phrase voice rule "happy to help" for the bot lane',
    ]);
  });

  it("never quotes the prose into a finding, because the door ledger keeps every summary", () => {
    const summaries = voiceProfileFindings({ actor: "bot", prose: PROSE, rules: RULES }).map((f) => f.summary);
    expect(summaries.filter((summary) => summary.includes("let me delve into it"))).toStrictEqual([]);
    expect(PROSE[0]!.text).toBe("happy to help — let me delve into it");
  });

  it("reports the unstated lane rather than defaulting it", () => {
    expect(voiceProfileFindings({ actor: undefined, prose: PROSE, rules: RULES })).toStrictEqual([
      {
        code: "VOICE_ACTOR_UNSTATED",
        correction: 'state the lane on the door request\'s `actor` artifact field as "me" or "bot"',
        override: VOICE_PROFILE_OVERRIDE,
        severity: "warn",
        summary: "this send does not say which name it goes out under, so no voice profile could be applied",
      },
    ]);
  });

  it("says nothing when the install has configured no rules, even with a lane missing", () => {
    expect(voiceProfileFindings({ actor: undefined, prose: PROSE, rules: [] })).toStrictEqual([]);
  });

  it("says nothing when the send authors no prose, even with a lane missing", () => {
    expect(voiceProfileFindings({ actor: undefined, prose: [], rules: RULES })).toStrictEqual([]);
  });

  it("every finding is a warn carrying the override token — no voice rule hard-blocks", () => {
    const findings = voiceProfileFindings({ actor: "me", prose: PROSE, rules: RULES });
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.filter((finding) => finding.severity !== "warn")).toStrictEqual([]);
    expect(findings.filter((finding) => finding.override !== VOICE_PROFILE_OVERRIDE)).toStrictEqual([]);
  });
});

describe("voiceProfileGate", () => {
  it("reads the lane off the request rather than from its own closure", () => {
    const gate = voiceProfileGate({ allowVoiceRules: false, prose: PROSE, rules: RULES });
    expect(gate(requestFor({ actor: "bot" })).map((finding) => finding.summary)).toStrictEqual([
      'tldr matches the configured literal voice rule "—" for the bot lane',
      'tldr matches the configured phrase voice rule "happy to help" for the bot lane',
    ]);
  });

  it("raises the unstated-lane finding when the request carries no actor", () => {
    const gate = voiceProfileGate({ allowVoiceRules: false, prose: PROSE, rules: RULES });
    expect(gate(requestFor({ actor: undefined })).map((finding) => finding.code)).toStrictEqual([
      "VOICE_ACTOR_UNSTATED",
    ]);
  });

  it("raises the unstated-lane finding on an actor value it does not recognise", () => {
    const gate = voiceProfileGate({ allowVoiceRules: false, prose: PROSE, rules: RULES });
    expect(gate(requestFor({ actor: "somebody-else" })).map((finding) => finding.code)).toStrictEqual([
      "VOICE_ACTOR_UNSTATED",
    ]);
  });

  it("stays silent under the named hatch", () => {
    const gate = voiceProfileGate({ allowVoiceRules: true, prose: PROSE, rules: RULES });
    expect(gate(requestFor({ actor: "bot" }))).toStrictEqual([]);
  });

  it("NO_AUTHORED_PROSE is a gate that finds nothing on any lane", () => {
    const gate = voiceProfileGate(NO_AUTHORED_PROSE);
    expect(gate(requestFor({ actor: "me" }))).toStrictEqual([]);
    expect(gate(requestFor({ actor: "bot" }))).toStrictEqual([]);
  });
});

describe("voiceInputFor", () => {
  it("splits the findings by actor while handing the gate the WHOLE rule list", () => {
    const input = voiceInputFor({ actor: "bot", allowVoiceRules: false, prose: PROSE, rules: RULES });
    expect(input.findings).toStrictEqual([
      { path: "tldr", rule: BOTH },
      { path: "tldr", rule: BOT_ONLY },
    ]);
    expect(input.gate.rules).toStrictEqual(RULES);
    expect(input.gate.allowVoiceRules).toBe(false);
  });

  it("records findings even when the hatch is open, so the pain-point ledger still learns", () => {
    const input = voiceInputFor({ actor: "me", allowVoiceRules: true, prose: PROSE, rules: RULES });
    expect(input.findings.map((finding) => finding.rule)).toStrictEqual([BOTH, ME_ONLY]);
    expect(voiceProfileGate(input.gate)(requestFor({ actor: "me" }))).toStrictEqual([]);
  });
});
