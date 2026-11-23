/**
 * `draftToolSchemas.ts` — the three tools the voice edits the open parked draft with, and the lines both prompts carry
 * about them.
 */
import { describe, expect, it } from "vitest";

import { REVISION_READING_MAX_CHARS, REVISION_READING_MAX_ITEMS } from "../../../outbound/slack/draftRevision.js";
import { DRAFT_EDIT_BACKEND_LINES, DRAFT_EDIT_VOICE_LINES, DRAFT_TOOLS } from "../../../talk/draftToolSchemas.js";
import { TALK_BACKEND_INSTRUCTIONS, TALK_VOICE_INSTRUCTIONS } from "../../../talk/sessionConfig.js";
import { TALK_TOOLS } from "../../../talk/talkToolSchemas.js";

describe("the draft tools", () => {
  it("start by reading, then write through the two draft-kind tools, in the order a call uses them", () => {
    expect(DRAFT_TOOLS.map((tool) => [tool.name, tool.kind])).toEqual([
      ["draft_edit_start", "read"],
      ["draft_edit", "draft"],
      ["draft_restore", "draft"],
    ]);
  });

  it("are carried in the voice's tool list exactly once, together", () => {
    const names = TALK_TOOLS.map((tool) => tool.name);
    const at = names.indexOf("draft_edit_start");
    expect(names.slice(at, at + 3)).toEqual(["draft_edit_start", "draft_edit", "draft_restore"]);
    expect(names.filter((name) => name.startsWith("draft_"))).toEqual([
      "draft_edit_start",
      "draft_edit",
      "draft_restore",
    ]);
  });

  it("bound the reading the way the register reads it back", () => {
    expect(DRAFT_TOOLS[0]!.parameters).toMatchObject({
      properties: {
        reading: {
          items: { maxLength: REVISION_READING_MAX_CHARS, minLength: 1, type: "string" },
          maxItems: REVISION_READING_MAX_ITEMS,
          minItems: 1,
        },
      },
    });
  });

  it("put the voice's line in the voice prompt and the thinking model's bullet in the backend prompt", () => {
    expect(TALK_VOICE_INSTRUCTIONS).toContain(DRAFT_EDIT_VOICE_LINES.join("\n"));
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(DRAFT_EDIT_BACKEND_LINES.join("\n"));
    expect(TALK_VOICE_INSTRUCTIONS).not.toContain(DRAFT_EDIT_BACKEND_LINES[0]!);
  });
});
