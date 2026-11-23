import { describe, expect, it } from "vitest";

import {
  EMPTY_SKILL_REMINDER_STATE,
  governedVerbFor,
  hasBeenReminded,
  MAX_TRACKED_SESSIONS,
  parseSkillReminderState,
  reminderMessage,
  withReminded,
} from "../../../cli/skillReminder.js";

describe("governedVerbFor", () => {
  it("names the owning skill for a governed linear write verb", () => {
    const governed = governedVerbFor({ noun: "linear", verb: "issue" });
    expect(governed?.skill).toBe("/slopweaver:linear");
  });

  it("covers all three linear write verbs", () => {
    expect(governedVerbFor({ noun: "linear", verb: "project" })?.skill).toBe("/slopweaver:linear");
    expect(governedVerbFor({ noun: "linear", verb: "milestone" })?.skill).toBe("/slopweaver:linear");
  });

  it("is undefined for linear's read-only verbs — nothing Linear-shaped is rendered", () => {
    expect(governedVerbFor({ noun: "linear", verb: "read" })).toBeUndefined();
    expect(governedVerbFor({ noun: "linear", verb: "search" })).toBeUndefined();
  });

  it("is undefined for an unrelated noun/verb", () => {
    expect(governedVerbFor({ noun: "github", verb: "pr" })).toBeUndefined();
  });
});

describe("hasBeenReminded / withReminded", () => {
  it("reports false for a key never recorded", () => {
    expect(hasBeenReminded({ key: "linear issue", sessionId: "s1", state: EMPTY_SKILL_REMINDER_STATE })).toBe(false);
  });

  it("reports true once withReminded has recorded the key", () => {
    const state = withReminded({ key: "linear issue", sessionId: "s1", state: EMPTY_SKILL_REMINDER_STATE });
    expect(hasBeenReminded({ key: "linear issue", sessionId: "s1", state })).toBe(true);
  });

  it("keeps two sessions' keys independent", () => {
    const state = withReminded({ key: "linear issue", sessionId: "s1", state: EMPTY_SKILL_REMINDER_STATE });
    expect(hasBeenReminded({ key: "linear issue", sessionId: "s2", state })).toBe(false);
  });

  it("keeps two keys within one session independent", () => {
    const state = withReminded({ key: "linear issue", sessionId: "s1", state: EMPTY_SKILL_REMINDER_STATE });
    expect(hasBeenReminded({ key: "linear project", sessionId: "s1", state })).toBe(false);
  });

  it("returns the identical state object when the key is already recorded (no-op)", () => {
    const state = withReminded({ key: "linear issue", sessionId: "s1", state: EMPTY_SKILL_REMINDER_STATE });
    const again = withReminded({ key: "linear issue", sessionId: "s1", state });
    expect(again).toBe(state);
  });

  it("evicts the oldest session once the tracked set exceeds the cap", () => {
    let state = EMPTY_SKILL_REMINDER_STATE;
    for (let i = 0; i < MAX_TRACKED_SESSIONS; i += 1) {
      state = withReminded({ key: "linear issue", sessionId: `s${i}`, state });
    }
    expect(hasBeenReminded({ key: "linear issue", sessionId: "s0", state })).toBe(true);
    const overflowed = withReminded({ key: "linear issue", sessionId: "sOverflow", state });
    expect(hasBeenReminded({ key: "linear issue", sessionId: "s0", state: overflowed })).toBe(false);
    expect(hasBeenReminded({ key: "linear issue", sessionId: "sOverflow", state: overflowed })).toBe(true);
    expect(Object.keys(overflowed).length).toBe(MAX_TRACKED_SESSIONS);
  });
});

describe("reminderMessage", () => {
  it("names the noun, verb and skill", () => {
    const message = reminderMessage({
      governed: { skill: "/slopweaver:linear", why: "issue structure and brevity caps" },
      noun: "linear",
      verb: "issue",
    });
    expect(message).toContain("slopweaver linear issue");
    expect(message).toContain("/slopweaver:linear");
    expect(message).toContain("issue structure and brevity caps");
  });
});

describe("parseSkillReminderState", () => {
  it("returns empty state for undefined raw input (unreadable file)", () => {
    expect(parseSkillReminderState({ raw: undefined })).toEqual(EMPTY_SKILL_REMINDER_STATE);
  });

  it("returns empty state for malformed JSON", () => {
    expect(parseSkillReminderState({ raw: "not json{{{" })).toEqual(EMPTY_SKILL_REMINDER_STATE);
  });

  it("returns empty state for a JSON array (wrong shape)", () => {
    expect(parseSkillReminderState({ raw: "[1,2,3]" })).toEqual(EMPTY_SKILL_REMINDER_STATE);
  });

  it("round-trips a well-formed state", () => {
    const raw = JSON.stringify({ s1: ["linear issue"] });
    expect(parseSkillReminderState({ raw })).toEqual({ s1: ["linear issue"] });
  });

  it("drops a session entry whose value isn't a string array", () => {
    const raw = JSON.stringify({ s1: ["linear issue"], s2: "not-an-array", s3: [1, 2] });
    expect(parseSkillReminderState({ raw })).toEqual({ s1: ["linear issue"] });
  });
});
