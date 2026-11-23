import { describe, expect, it } from "vitest";
import type { CodexActivity } from "../../../codex/progress.js";
import { foldCodexEvent, initialCodexActivity } from "../../../codex/progress.js";
import { formatSalvage, salvageFromActivity } from "../../../codex/salvage.js";
import type { CodexObservedEvent } from "../../../codex/types.js";

/** Fold a sequence of observed events, as the stream would. */
function fold({ events }: { events: readonly CodexObservedEvent[] }): CodexActivity {
  return events.reduce((activity, event) => foldCodexEvent({ activity, event }), initialCodexActivity());
}

function command({ line, exitCode }: { line: string; exitCode: number }): CodexObservedEvent {
  return { item: { command: line, exitCode, itemKind: "command_execution" }, kind: "item" };
}

function message({ text }: { text: string }): CodexObservedEvent {
  return { item: { itemKind: "agent_message", text }, kind: "item" };
}

describe("salvageFromActivity", () => {
  it("keeps the observed counts of a pass that ran commands and then stopped", () => {
    const salvage = salvageFromActivity({
      activity: fold({
        events: [
          command({ exitCode: 0, line: "nl -ba src/a.ts" }),
          command({ exitCode: 1, line: "rg nothing src" }),
          command({ exitCode: 0, line: "git log --oneline -5" }),
        ],
      }),
    });

    expect(salvage).toEqual({
      commands: 3,
      failedCommands: 1,
      fileChanges: 0,
      lastAgentMessage: null,
      recentCommands: ["nl -ba src/a.ts", "rg nothing src", "git log --oneline -5"],
      searches: 0,
    });
  });

  it("keeps the last message a pass emitted before it stopped", () => {
    const salvage = salvageFromActivity({
      activity: fold({
        events: [message({ text: "first thought" }), command({ exitCode: 0, line: "ls" }), message({ text: "second" })],
      }),
    });

    expect(salvage?.lastAgentMessage).toBe("second");
  });

  it("does not let a blank later message erase the last real one", () => {
    const salvage = salvageFromActivity({
      activity: fold({ events: [message({ text: "the real thing" }), message({ text: "" })] }),
    });

    expect(salvage?.lastAgentMessage).toBe("the real thing");
  });

  it("returns null when the pass genuinely produced nothing", () => {
    expect(salvageFromActivity({ activity: initialCodexActivity() })).toBe(null);
  });

  it("counts web searches and scratch writes as work worth keeping", () => {
    const salvage = salvageFromActivity({
      activity: fold({
        events: [
          { item: { itemKind: "web_search", query: "slack rich_text" }, kind: "item" },
          { item: { changedPaths: ["/scratch/notes.md"], itemKind: "file_change" }, kind: "item" },
        ],
      }),
    });

    expect(salvage).toEqual({
      commands: 0,
      failedCommands: 0,
      fileChanges: 1,
      lastAgentMessage: null,
      recentCommands: [],
      searches: 1,
      // The counts above are the whole record: no token spend, because an aborted turn never reported any.
    });
  });
});

describe("formatSalvage", () => {
  const SALVAGE = {
    commands: 92,
    failedCommands: 4,
    fileChanges: 2,
    lastAgentMessage: "I have read the connector and the two cursor layers disagree.",
    recentCommands: ["rg -n cursor src/corpus", "nl -ba src/corpus/refresh.ts | sed -n '1,80p'"],
    searches: 1,
  };

  it("states the counts and their provenance", () => {
    const text = formatSalvage({ salvage: SALVAGE }).join("\n");

    expect(text).toContain("commands observed: 92 (4 exited non-zero)");
    expect(text).toContain("web searches: 1");
    expect(text).toContain("scratch files written: 2");
    expect(text).toContain("OBSERVED from the event stream, not measured by the SDK");
  });

  it("says token spend is unknown rather than printing a zero", () => {
    expect(formatSalvage({ salvage: SALVAGE }).join("\n")).toContain(
      "Token spend is absent because it is genuinely unknown",
    );
  });

  it("fences the command lines so a pipe cannot break the markdown", () => {
    const lines = formatSalvage({ salvage: { ...SALVAGE, recentCommands: ["rg foo src | head -3"] } });

    expect(lines).toContain("```");
    expect(lines).toContain("rg foo src | head -3");
  });

  it("refuses to present the last message as a verdict", () => {
    const text = formatSalvage({ salvage: SALVAGE }).join("\n");

    expect(text).toContain("This is NOT a verdict");
    expect(text).toContain("I have read the connector and the two cursor layers disagree.");
  });

  it("says so explicitly when the pass emitted no message", () => {
    expect(formatSalvage({ salvage: { ...SALVAGE, lastAgentMessage: null } }).join("\n")).toContain(
      "The pass emitted no message before it stopped.",
    );
  });

  it("distinguishes nothing-to-keep from nothing-was-kept", () => {
    const text = formatSalvage({ salvage: null }).join("\n");

    expect(text).toContain("Nothing was observed on the stream before the stop");
    expect(text).toContain("That is a real observation, not a gap in the record.");
  });
});
