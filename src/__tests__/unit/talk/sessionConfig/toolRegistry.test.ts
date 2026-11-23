/**
 * The tool surface the Talk session is offered, asserted as data rather than observed in a browser.
 *
 * The load-bearing property is the one `talkToolSchemas.ts`'s header states: a model-callable tool either
 * READS something bounded or is the ONE relay, and there is no generic writer. So the registry guard opens
 * on a non-empty length — `filter(bad).toEqual([])` is true of an empty registry — and then names the one
 * relay tool by hand, because "one writer" is only evidence if the test can tell a writer from a reader.
 */
import { describe, expect, it } from "vitest";

import { FILE_TOOLS } from "../../../../talk/fileToolSchemas.js";
import { RECALL_TOOLS } from "../../../../talk/recallToolSchemas.js";
import { TALK_BACKEND_INSTRUCTIONS, TALK_VOICE_INSTRUCTIONS } from "../../../../talk/sessionConfig.js";
import { STEER_TOOLS } from "../../../../talk/steerToolSchemas.js";
import { TALK_TOOLS, type TalkToolKind } from "../../../../talk/talkToolSchemas.js";

/** Every kind the type has. A member added without a decision here fails to compile rather than passing. */
const EVERY_KIND: ReadonlySet<TalkToolKind> = new Set(["read", "preference", "show", "list-write", "relay", "draft"]);

describe("TALK_TOOLS", () => {
  it("offers exactly the forty-two tools the widget documents, in order", () => {
    expect(TALK_TOOLS.map((tool) => tool.name)).toEqual([
      "code_find",
      "code_read",
      "code_list",
      "file_read",
      "file_list",
      "action_items",
      "read_card",
      "open_card",
      "draft_edit_start",
      "draft_edit",
      "draft_restore",
      "triage_next",
      "triage_end",
      "triage_clock",
      "read_page",
      "read_screen",
      "focus_screen",
      "offer_copy",
      "running_list",
      "set_stage_setting",
      "focus_set",
      "focus_end",
      "focus_quiet",
      "meeting_skip",
      "board_row",
      "read_supervisor",
      "glossary",
      "origin",
      "knowledge",
      "supervisor_history",
      "recall",
      "recall_open",
      "verb",
      "browser",
      "browser_open",
      "slack_thread_after",
      "slack_unread",
      "slack_channel",
      "slack_open",
      "slack_send_outcome",
      "recent_steers",
      "relay_steer",
    ]);
  });

  // The voice once told the owner it had three tools while nine were declared, because the tool list
  // lives on the delegated backend and the voice prompt named only three of them.
  it("lists every tool, by name and one line, in BOTH prompts, so neither can claim fewer", () => {
    expect(TALK_TOOLS.length).toBeGreaterThan(0);
    const lines = TALK_TOOLS.map((tool) => `- ${tool.name}: ${tool.summary}`);
    expect(lines.filter((line) => !TALK_VOICE_INSTRUCTIONS.includes(line))).toEqual([]);
    expect(lines.filter((line) => !TALK_BACKEND_INSTRUCTIONS.includes(line))).toEqual([]);
    expect(TALK_VOICE_INSTRUCTIONS).toContain("This is the whole list");
    expect(TALK_VOICE_INSTRUCTIONS).toContain("Never answer from memory what you can do");
  });

  it("gives every tool a one-line summary for that list", () => {
    expect(TALK_TOOLS.length).toBeGreaterThan(0);
    expect(
      TALK_TOOLS.filter((tool) => tool.summary.trim() === "" || tool.summary.includes("\n")).map((tool) => tool.name),
    ).toEqual([]);
  });

  it("declares no kind outside the six the type has", () => {
    expect(TALK_TOOLS.length).toBeGreaterThan(0);
    expect(TALK_TOOLS.filter((tool) => !EVERY_KIND.has(tool.kind)).map((tool) => tool.name)).toEqual([]);
  });

  it("offers the steer tools last, the one writer among them", () => {
    expect(STEER_TOOLS.map((tool) => tool.name)).toEqual(["recent_steers", "relay_steer"]);
    expect(TALK_TOOLS.slice(-STEER_TOOLS.length)).toEqual(STEER_TOOLS);
  });

  it("relays through exactly one tool, edits the open draft through two, writes the owner's running list through one, sets a page preference through six, shows on the owner's screen through one, and every other one only reads", () => {
    expect(TALK_TOOLS.filter((tool) => tool.kind === "relay").map((tool) => tool.name)).toEqual(["relay_steer"]);
    expect(TALK_TOOLS.filter((tool) => tool.kind === "draft").map((tool) => tool.name)).toEqual([
      "draft_edit",
      "draft_restore",
    ]);
    expect(TALK_TOOLS.filter((tool) => tool.kind === "list-write").map((tool) => tool.name)).toEqual(["offer_copy"]);
    expect(TALK_TOOLS.filter((tool) => tool.kind === "preference").map((tool) => tool.name)).toEqual([
      "triage_clock",
      "set_stage_setting",
      "focus_set",
      "focus_end",
      "focus_quiet",
      "meeting_skip",
    ]);
    expect(TALK_TOOLS.filter((tool) => tool.kind === "show").map((tool) => tool.name)).toEqual(["focus_screen"]);
    expect(TALK_TOOLS.filter((tool) => tool.kind === "read").map((tool) => tool.name)).toEqual([
      "code_find",
      "code_read",
      "code_list",
      "file_read",
      "file_list",
      "action_items",
      "read_card",
      "open_card",
      "draft_edit_start",
      "triage_next",
      "triage_end",
      "read_page",
      "read_screen",
      "running_list",
      "board_row",
      "read_supervisor",
      "glossary",
      "origin",
      "knowledge",
      "supervisor_history",
      "recall",
      "recall_open",
      "verb",
      "browser",
      "browser_open",
      "slack_thread_after",
      "slack_unread",
      "slack_channel",
      "slack_open",
      "slack_send_outcome",
      "recent_steers",
    ]);
  });

  // The owner asked for the last couple of days and the voice could search only the last one.
  it("offers recall and recall_open as reads of `talk recall`, the search all-time unless days narrows it", () => {
    expect(RECALL_TOOLS.map((tool) => [tool.name, tool.kind, tool.runs, tool.parameters["required"]])).toEqual([
      ["recall", "read", { noun: "talk", verb: "recall" }, ["words"]],
      ["recall_open", "read", { noun: "talk", verb: "recall" }, ["pointer"]],
    ]);
    expect(RECALL_TOOLS[0]!.description).toContain("ALL TIME unless the owner names a window");
    expect(TALK_VOICE_INSTRUCTIONS).toContain("recall");
  });

  it("offers the two local-file tools as reads, each naming its one required path argument", () => {
    expect(FILE_TOOLS.map((tool) => [tool.name, tool.kind, tool.parameters["required"]])).toEqual([
      ["file_read", "read", ["path"]],
      ["file_list", "read", ["dir"]],
    ]);
    expect(TALK_BACKEND_INSTRUCTIONS).toContain("Never say you cannot read a local file");
  });

  // A card's briefing can be read whole across several reads, so a partial one is paged on to its end.
  it("has a card's partial briefing read on to its end through file_read's words mode, its sentence only on failure", () => {
    const fileRead = FILE_TOOLS.find((tool) => tool.name === "file_read")!;
    const readCard = TALK_TOOLS.find((tool) => tool.name === "read_card")!;
    const openCard = TALK_TOOLS.find((tool) => tool.name === "open_card")!;
    const triageNext = TALK_TOOLS.find((tool) => tool.name === "triage_next")!;
    expect(fileRead.parameters["properties"]).toMatchObject({ words: { type: "boolean" } });
    expect([
      readCard.description.includes("`from` `rest.from` and `words: true`"),
      readCard.description.includes("until `nextFrom` is null"),
      readCard.description.includes("say its `say` word for word only if one of those reads fails"),
      openCard.description.includes("through file_read from its `rest` with `words: true` before you speak"),
      triageNext.description.includes("through file_read from its `rest` with `words: true`"),
      TALK_BACKEND_INSTRUCTIONS.includes("paging a 'partial' one on per read_card"),
      TALK_BACKEND_INSTRUCTIONS.includes("never file_read one again"),
    ]).toEqual([true, true, true, true, true, true, false]);
  });

  it("gives every tool a closed parameter schema, so an invented field is refused at the model", () => {
    expect(TALK_TOOLS.length).toBeGreaterThan(0);
    expect(TALK_TOOLS.filter((tool) => tool.parameters["additionalProperties"] !== false).map((t) => t.name)).toEqual(
      [],
    );
  });
});
