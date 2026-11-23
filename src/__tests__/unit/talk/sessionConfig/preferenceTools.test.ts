/**
 * The preference tools a page setting is flipped through: the stage's switches, the owner's stated plan and a meeting
 * skipped only on the owner's word, each carried in its place in the tool list.
 */
import { describe, expect, it } from "vitest";

import { FOCUS_BACKEND_LINES, FOCUS_VOICE_LINES } from "../../../../talk/focusLines.js";
import { FOCUS_TOOLS } from "../../../../talk/focusToolSchemas.js";
import {
  MEETING_SKIP_BACKEND_LINES,
  MEETING_SKIP_TOOLS,
  MEETING_SKIP_VOICE_LINES,
} from "../../../../talk/meetingSkipToolSchemas.js";
import { PREFERENCE_BACKEND_LINES, PREFERENCE_VOICE_LINES } from "../../../../talk/preferenceLines.js";
import { TALK_BACKEND_INSTRUCTIONS, TALK_VOICE_INSTRUCTIONS } from "../../../../talk/sessionConfig.js";
import { TALK_TOOLS } from "../../../../talk/talkToolSchemas.js";

describe("TALK_TOOLS", () => {
  // The stage's live caption is gone, so its switch is. The edge glow stays constant, so it has no switch either.
  it("sets only the stage's three switches, live captions retired and the edge glow constant", () => {
    const stage = TALK_TOOLS.find((tool) => tool.name === "set_stage_setting")!;
    expect(stage.parameters["properties"]).toMatchObject({
      setting: { enum: ["activity", "previews", "openCards"] },
    });
    expect(stage.description).not.toContain("captions");
    expect(stage.description).not.toContain("edgeGlow");
    expect(stage.description).toContain(
      "The glow round the screen's edge has no switch: it stays on through every call.",
    );
  });

  // The voice must act on the plan it said it would carry out, not on a different one.
  it("holds the owner's stated plan as three preference tools carried after set_stage_setting, a browser never an app", () => {
    const names = TALK_TOOLS.map((tool) => tool.name);
    const after = names.indexOf("set_stage_setting") + 1;
    expect(names.slice(after, after + FOCUS_TOOLS.length)).toEqual(["focus_set", "focus_end", "focus_quiet"]);
    expect(FOCUS_TOOLS.map((tool) => tool.kind)).toEqual(["preference", "preference", "preference"]);
    const set = FOCUS_TOOLS[0]!;
    expect(set.parameters["required"]).toEqual(["plan", "apps", "keywords"]);
    expect(set.description).toContain("never a browser, since a browser holds anything");
    expect(FOCUS_TOOLS[2]!.description).toContain("the plan stays");
  });

  // A skip that the owner's explicit words contradicted must take effect only on those words.
  it("skips a meeting only on the owner's word, by the exact calendar instance a read printed, carried after the focus tools", () => {
    const names = TALK_TOOLS.map((tool) => tool.name);
    const after = names.indexOf("focus_quiet") + 1;
    expect(names.slice(after, after + MEETING_SKIP_TOOLS.length)).toEqual(["meeting_skip"]);
    const skip = MEETING_SKIP_TOOLS[0]!;
    expect(skip.kind).toBe("preference");
    expect(skip.parameters["required"]).toEqual(["meetings"]);
    expect(skip.parameters["properties"]).toMatchObject({
      meetings: {
        items: { additionalProperties: false, required: ["calendarId", "eventId", "title"] },
        maxItems: 8,
        minItems: 1,
      },
    });
    expect(skip.description).toContain("Read the owner's calendar first, every time, even when they name the meeting");
    expect(skip.description).toContain("finishing one meeting never skips a different one");
    expect(TALK_VOICE_INSTRUCTIONS).toContain(`${MEETING_SKIP_VOICE_LINES.join("\n")}\n\n${FOCUS_VOICE_LINES[0]!}`);
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(`${MEETING_SKIP_BACKEND_LINES.join("\n")}\n${FOCUS_BACKEND_LINES[0]!}`);
    expect(TALK_VOICE_INSTRUCTIONS).not.toContain(MEETING_SKIP_BACKEND_LINES[0]!);
    // The skip fires on the owner having had the meeting or not going, never on it merely having happened.
    expect(MEETING_SKIP_VOICE_LINES[0]).toBe(
      "The owner goes to every meeting unless they say otherwise. When they say they already had one, or are not going",
    );
    // The summary both prompts' inventories carry holds the same condition.
    expect(skip.summary).toBe("hold a meeting the owner said they had or will skip, so no join heads-up comes for it");
    expect([PREFERENCE_VOICE_LINES, PREFERENCE_BACKEND_LINES]).toEqual([
      [...MEETING_SKIP_VOICE_LINES, "", ...FOCUS_VOICE_LINES],
      [...MEETING_SKIP_BACKEND_LINES, ...FOCUS_BACKEND_LINES],
    ]);
  });
});
