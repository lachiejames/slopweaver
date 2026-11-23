/*
 * The orb's face: which mood it wears and which badge sits on it, read off the phase and the work in flight.
 */
import { describe, expect, it } from "vitest";

import {
  MOOD_WORDS,
  ORB_BADGES,
  ORB_MOODS,
  orbFaceOf,
  orbPreviewOf,
  previewStatusOf,
  stepMoodOf,
  toolMoodOf,
} from "../../lib/orbMood";
import { TALK_TOOL_NAMES } from "../../lib/talkTools";

describe("toolMoodOf", () => {
  it("reads every tool the console voice can call as something other than plain work, bar the verb runner and the page preferences", () => {
    expect(TALK_TOOL_NAMES.length).toBeGreaterThan(0);
    const plain = TALK_TOOL_NAMES.filter((name) => toolMoodOf({ name }) === "working");
    expect(plain).toEqual([
      "triage_clock",
      "set_stage_setting",
      "focus_set",
      "focus_end",
      "focus_quiet",
      "meeting_skip",
      "verb",
    ]);
  });

  it("gives the owner's screen the eyes and a Slack thread the Slack mark", () => {
    expect(toolMoodOf({ name: "read_screen" })).toBe("looking");
    expect(toolMoodOf({ name: "slack_thread_after" })).toBe("slack");
    expect(toolMoodOf({ name: "code_find" })).toBe("code");
    expect(toolMoodOf({ name: "knowledge" })).toBe("recalling");
    expect(toolMoodOf({ name: "browser_open" })).toBe("browsing");
    expect(toolMoodOf({ name: "open_card" })).toBe("browsing");
    // Reading a card opens nothing, so the orb never says it is in the owner's browser for one.
    expect(toolMoodOf({ name: "read_card" })).toBe("recalling");
    expect(toolMoodOf({ name: "relay_steer" })).toBe("relaying");
    expect(toolMoodOf({ name: "triage_next" })).toBe("browsing");
    expect(toolMoodOf({ name: "triage_end" })).toBe("recalling");
    expect(["draft_edit_start", "draft_edit", "draft_restore"].map((name) => toolMoodOf({ name }))).toEqual([
      "writing",
      "writing",
      "writing",
    ]);
  });

  it("reads a Codex thread's own items and an off-table MCP tool by what they name", () => {
    expect(toolMoodOf({ name: "a command" })).toBe("code");
    expect(toolMoodOf({ name: "web search" })).toBe("recalling");
    expect(toolMoodOf({ name: "Slack_Search_Messages" })).toBe("slack");
    expect(toolMoodOf({ name: "playwright_browser_snapshot" })).toBe("browsing");
    expect(toolMoodOf({ name: "linear_get_issue" })).toBe("working");
  });
});

describe("stepMoodOf", () => {
  it("thinks while reasoning, writes while writing, and works on a hand-off nothing picked up", () => {
    expect(stepMoodOf({ step: { kind: "reasoning" } })).toBe("thinking");
    expect(stepMoodOf({ step: { kind: "writing" } })).toBe("writing");
    expect(stepMoodOf({ step: { kind: "working" } })).toBe("working");
    expect(stepMoodOf({ step: undefined })).toBe("working");
    expect(stepMoodOf({ step: { kind: "tool", name: "read_screen" } })).toBe("looking");
  });

  // Compacting is work with its own headline, never the stalled face the owner read as asleep.
  it("wears the working face and badge while the thread compacts", () => {
    const compacting = { kind: "compacting" } as const;
    expect([stepMoodOf({ step: compacting }), orbFaceOf({ busy: true, focus: compacting, phase: "working" })]).toEqual([
      "working",
      { badge: "working", mood: "working" },
    ]);
  });
});

describe("orbFaceOf", () => {
  const screen = { kind: "tool", name: "read_screen" } as const;

  it("wears the work as both mood and badge while a turn is in flight", () => {
    expect(orbFaceOf({ busy: true, focus: screen, phase: "working" })).toEqual({ badge: "looking", mood: "looking" });
    expect(orbFaceOf({ busy: true, focus: { kind: "reasoning" }, phase: "working" })).toEqual({
      badge: "thinking",
      mood: "thinking",
    });
  });

  it("keeps speaking over a tool in flight and badges it, so 'one sec' over the owner's screen shows the eyes", () => {
    expect(orbFaceOf({ busy: true, focus: screen, phase: "speaking" })).toEqual({ badge: "looking", mood: "speaking" });
    expect(orbFaceOf({ busy: true, focus: undefined, phase: "hearing" })).toEqual({
      badge: "working",
      mood: "hearing",
    });
  });

  it("puts no badge on talking or listening with nothing in flight", () => {
    expect(orbFaceOf({ busy: false, focus: undefined, phase: "speaking" })).toEqual({
      badge: undefined,
      mood: "speaking",
    });
    expect(orbFaceOf({ busy: false, focus: undefined, phase: "listening" })).toEqual({
      badge: undefined,
      mood: "idle",
    });
  });

  it("marks a stall and an error whatever was in flight, and leaves off and connecting bare", () => {
    expect(orbFaceOf({ busy: true, focus: screen, phase: "stalled" })).toEqual({ badge: "stalled", mood: "stalled" });
    expect(orbFaceOf({ busy: false, focus: undefined, phase: "error" })).toEqual({ badge: "error", mood: "error" });
    expect(orbFaceOf({ busy: true, focus: screen, phase: "off" })).toEqual({ badge: undefined, mood: "off" });
    expect(orbFaceOf({ busy: false, focus: undefined, phase: "connecting" })).toEqual({
      badge: undefined,
      mood: "connecting",
    });
  });

  it("wears its own face the moment it stops for the owner, still badging the work it holds", () => {
    expect(orbFaceOf({ busy: false, focus: undefined, phase: "yielded" })).toEqual({
      badge: undefined,
      mood: "yielded",
    });
    expect(orbFaceOf({ busy: true, focus: screen, phase: "yielded" })).toEqual({ badge: "looking", mood: "yielded" });
  });

  it("wears its own bare reconnecting face while a dropped call comes back, whatever was in flight", () => {
    expect(orbFaceOf({ busy: true, focus: screen, phase: "reconnecting" })).toEqual({
      badge: undefined,
      mood: "reconnecting",
    });
  });
});

describe("a reconnect preview", () => {
  it("draws ?orb=reconnecting under the reconnecting phase, in its own word", () => {
    const face = orbPreviewOf({ search: "?orb=reconnecting" });
    expect(face).toEqual({ badge: undefined, mood: "reconnecting" });
    expect(previewStatusOf({ face: face! })).toEqual({
      detail: "preview: ?orb=reconnecting",
      headline: "reconnecting",
      nudge: undefined,
      phase: "reconnecting",
      seconds: undefined,
    });
  });

  it("draws ?orb=yielded under the yielded phase, as the owner's turn", () => {
    const face = orbPreviewOf({ search: "?orb=yielded" });
    expect(face).toEqual({ badge: undefined, mood: "yielded" });
    expect(previewStatusOf({ face: face! })).toMatchObject({ headline: "your turn", phase: "yielded" });
  });
});

describe("orbPreviewOf", () => {
  it("draws a work mood with its own badge, and a talking mood bare", () => {
    expect(orbPreviewOf({ search: "?context=work&orb=slack" })).toEqual({ badge: "slack", mood: "slack" });
    expect(orbPreviewOf({ search: "?orb=speaking" })).toEqual({ badge: undefined, mood: "speaking" });
  });

  it("takes a badge after a comma", () => {
    expect(orbPreviewOf({ search: "?orb=speaking,looking" })).toEqual({ badge: "looking", mood: "speaking" });
  });

  it("draws nothing for no preview, an unknown mood, an unknown badge or a third name", () => {
    expect(orbPreviewOf({ search: "?context=work" })).toBeUndefined();
    expect(orbPreviewOf({ search: "?orb=dancing" })).toBeUndefined();
    expect(orbPreviewOf({ search: "?orb=speaking,dancing" })).toBeUndefined();
    expect(orbPreviewOf({ search: "?orb=speaking,looking,slack" })).toBeUndefined();
    expect(orbPreviewOf({ search: "?orb=idle,hearing" })).toBeUndefined();
  });
});

describe("previewStatusOf", () => {
  it("draws a previewed mood under the phase a live call would, in its own words", () => {
    expect(previewStatusOf({ face: { badge: "slack", mood: "slack" } })).toEqual({
      detail: "preview: ?orb=slack",
      headline: "reading Slack",
      nudge: undefined,
      phase: "working",
      seconds: undefined,
    });
    expect(previewStatusOf({ face: { badge: undefined, mood: "idle" } }).phase).toBe("listening");
    expect(previewStatusOf({ face: { badge: "looking", mood: "speaking" } }).detail).toBe(
      "preview: ?orb=speaking,looking",
    );
    expect(previewStatusOf({ face: { badge: "stalled", mood: "stalled" } }).phase).toBe("stalled");
  });
});

describe("the face registry", () => {
  it("words every mood and badges only moods it knows", () => {
    expect(ORB_MOODS.length).toBeGreaterThan(0);
    expect(ORB_MOODS.filter((mood) => MOOD_WORDS[mood] === "")).toEqual([]);
    expect(ORB_BADGES.filter((badge) => !ORB_MOODS.includes(badge))).toEqual([]);
  });
});
