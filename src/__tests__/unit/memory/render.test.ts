/**
 * The memory checker's three renderings from one finding array: the human report (a clean line, or a count
 * header over one line per finding, file-level findings carrying no line number), the pretty JSON, and the
 * hook payload — `null` when there is nothing to say, otherwise the corpus report, the directive report, or
 * both separated by exactly one blank line, echoing the hook's own event name.
 */
import { describe, expect, it } from "vitest";

import { renderMemoryHookOutput, renderMemoryHuman, renderMemoryJson } from "../../../memory/render.js";
import type { MemoryFinding } from "../../../memory/types.js";

const FILE_FINDING: MemoryFinding = {
  check: "orphan",
  file: "stale-note.md",
  line: null,
  message: "no index routes this memory",
};

const LINE_FINDING: MemoryFinding = {
  check: "dead-pointer",
  file: "MEMORY.md",
  line: 12,
  message: "points at gone.md, which does not exist",
};

describe("renderMemoryHuman", () => {
  it("is the single clean line for no findings", () => {
    expect(renderMemoryHuman({ findings: [] })).toEqual(["memory: clean"]);
  });

  it("is a count header over one line per finding, a file-level finding carrying no line number", () => {
    expect(renderMemoryHuman({ findings: [FILE_FINDING, LINE_FINDING] })).toEqual([
      "memory: 2 problem(s)",
      "  [orphan] stale-note.md — no index routes this memory",
      "  [dead-pointer] MEMORY.md:12 — points at gone.md, which does not exist",
    ]);
  });
});

describe("renderMemoryJson", () => {
  it("is the findings array pretty-printed at two spaces", () => {
    expect(renderMemoryJson({ findings: [LINE_FINDING] })).toBe(
      [
        "[",
        "  {",
        '    "check": "dead-pointer",',
        '    "file": "MEMORY.md",',
        '    "line": 12,',
        '    "message": "points at gone.md, which does not exist"',
        "  }",
        "]",
      ].join("\n"),
    );
  });

  it("is an empty array for no findings", () => {
    expect(renderMemoryJson({ findings: [] })).toBe("[]");
  });
});

describe("renderMemoryHookOutput", () => {
  it("is null when there are neither findings nor problems", () => {
    expect(renderMemoryHookOutput({ event: "SessionStart", findings: [], problems: [] })).toBe(null);
  });

  it("carries only the corpus report when there are findings and no problems", () => {
    const output = renderMemoryHookOutput({ event: "PostToolUse", findings: [FILE_FINDING] });

    expect(JSON.parse(output!)).toEqual({
      hookSpecificOutput: {
        additionalContext: [
          "The memory corpus has integrity problems. Fix these before moving on:",
          "",
          "memory: 1 problem(s)",
          "  [orphan] stale-note.md — no index routes this memory",
        ].join("\n"),
        hookEventName: "PostToolUse",
      },
    });
  });

  it("carries only the directive report when there are problems and no findings", () => {
    const output = renderMemoryHookOutput({
      event: "SessionStart",
      findings: [],
      problems: ["directive cache unreadable"],
    });

    expect(JSON.parse(output!)).toEqual({
      hookSpecificOutput: {
        additionalContext: [
          "The current-owner directive fast path failed. Fix this before relying on the next live turn:",
          "",
          "  directive cache unreadable",
        ].join("\n"),
        hookEventName: "SessionStart",
      },
    });
  });

  it("separates the corpus report from the directive report by exactly one blank line", () => {
    const output = renderMemoryHookOutput({
      event: "SessionStart",
      findings: [LINE_FINDING],
      problems: ["directive cache unreadable"],
    });

    expect(JSON.parse(output!)).toEqual({
      hookSpecificOutput: {
        additionalContext: [
          "The memory corpus has integrity problems. Fix these before moving on:",
          "",
          "memory: 1 problem(s)",
          "  [dead-pointer] MEMORY.md:12 — points at gone.md, which does not exist",
          "",
          "The current-owner directive fast path failed. Fix this before relying on the next live turn:",
          "",
          "  directive cache unreadable",
        ].join("\n"),
        hookEventName: "SessionStart",
      },
    });
  });
});
