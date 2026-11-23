import { describe, expect, it } from "vitest";
import {
  agentDocLineCount,
  docOffendersOf,
  docRegressionsOf,
  docWorseningsOf,
  isAgentFacingDoc,
  MAX_AGENT_DOC_LINES,
  MAX_TRACKED_MARKDOWN_LINES,
  markdownDocLimit,
  parseAgentDocBaseline,
} from "../../../devLint/agentDocSize.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

describe("agentDocLineCount", () => {
  it("counts newlines the way wc -l does", () => {
    expect(agentDocLineCount({ content: "a\nb\nc\n" })).toBe(3);
  });

  it("does not count a final line lacking a trailing newline", () => {
    expect(agentDocLineCount({ content: "a\nb\nc" })).toBe(2);
  });

  it("is zero for empty content", () => {
    expect(agentDocLineCount({ content: "" })).toBe(0);
  });
});

describe("isAgentFacingDoc", () => {
  it("covers the instruction files loaded into every session", () => {
    expect(isAgentFacingDoc({ path: "AGENTS.md" })).toBe(true);
    expect(isAgentFacingDoc({ path: "CLAUDE.md" })).toBe(true);
  });

  it("covers the rules tree and the whole skills tree, references included", () => {
    expect(isAgentFacingDoc({ path: ".claude/rules/testing.md" })).toBe(true);
    expect(isAgentFacingDoc({ path: "skills/loop/SKILL.md" })).toBe(true);
    expect(isAgentFacingDoc({ path: "skills/loop/reference/edge-cases.md" })).toBe(true);
  });

  it("excludes docs read on demand, human-facing readmes and fixtures", () => {
    expect(isAgentFacingDoc({ path: "docs/architecture.md" })).toBe(false);
    expect(isAgentFacingDoc({ path: "README.md" })).toBe(false);
    expect(isAgentFacingDoc({ path: "templates/README.md" })).toBe(false);
    expect(isAgentFacingDoc({ path: "src/__tests__/fixtures/handover/ownerAskWaived.md" })).toBe(false);
  });

  it("excludes a non-markdown file inside an in-scope tree", () => {
    expect(isAgentFacingDoc({ path: "skills/loop/scripts/run.ts" })).toBe(false);
  });
});

describe("markdownDocLimit", () => {
  it("gives an agent-facing doc the tighter cap", () => {
    expect(markdownDocLimit({ path: "AGENTS.md" })).toBe(200);
    expect(markdownDocLimit({ path: "skills/loop/reference/edge-cases.md" })).toBe(200);
  });

  it("gives every other tracked markdown file the looser cap rather than leaving it out of scope", () => {
    expect(markdownDocLimit({ path: "README.md" })).toBe(300);
    expect(markdownDocLimit({ path: "docs/store/backup.md" })).toBe(300);
    expect(markdownDocLimit({ path: "src/__tests__/fixtures/handover/ownerAskWaived.md" })).toBe(300);
  });

  it("gives a non-markdown file no cap at all", () => {
    expect(markdownDocLimit({ path: "skills/loop/scripts/run.ts" })).toBe(undefined);
  });
});

describe("docOffendersOf", () => {
  it("keeps only docs over their own cap, sorted by path", () => {
    const sizes = [
      { limit: MAX_AGENT_DOC_LINES, lines: MAX_AGENT_DOC_LINES + 1, path: "skills/b/SKILL.md" },
      { limit: MAX_AGENT_DOC_LINES, lines: MAX_AGENT_DOC_LINES, path: "skills/c/SKILL.md" },
      { limit: MAX_TRACKED_MARKDOWN_LINES, lines: MAX_TRACKED_MARKDOWN_LINES + 1, path: "docs/a.md" },
      { limit: MAX_TRACKED_MARKDOWN_LINES, lines: MAX_AGENT_DOC_LINES + 50, path: "docs/b.md" },
    ];
    expect(docOffendersOf({ sizes })).toEqual([
      { limit: 300, lines: 301, path: "docs/a.md" },
      { limit: 200, lines: 201, path: "skills/b/SKILL.md" },
    ]);
  });

  it("treats a doc exactly at either cap as compliant", () => {
    const sizes = [
      { limit: MAX_AGENT_DOC_LINES, lines: 200, path: "AGENTS.md" },
      { limit: MAX_TRACKED_MARKDOWN_LINES, lines: 300, path: "README.md" },
    ];
    expect(docOffendersOf({ sizes })).toEqual([]);
  });
});

describe("parseAgentDocBaseline", () => {
  it("decodes a committed floor", () => {
    const parsed = parseAgentDocBaseline({ text: '{"offenders":[{"path":"AGENTS.md","lines":236}]}' });
    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed).offenders).toEqual([{ lines: 236, path: "AGENTS.md" }]);
  });

  it("rejects an unexpected shape", () => {
    const parsed = parseAgentDocBaseline({ text: '{"offenders":[{"path":"AGENTS.md"}]}' });
    expect(unwrapErr(parsed).code).toBe("BASELINE_SHAPE_INVALID");
    expect(unwrapErr(parsed).message).toBe(
      "agent-doc-size baseline: unexpected shape (expected { offenders: [{ path, lines }] }, one entry per path)",
    );
  });

  it("rejects a path listed twice, whose later floor would widen the earlier one", () => {
    const text = '{"offenders":[{"path":"a.md","lines":200},{"path":"a.md","lines":201}]}';
    expect(unwrapErr(parseAgentDocBaseline({ text })).code).toBe("BASELINE_SHAPE_INVALID");
  });

  it("rejects text that is not json", () => {
    expect(unwrapErr(parseAgentDocBaseline({ text: "not json" })).message).toBe(
      "agent-doc-size baseline: invalid JSON",
    );
  });
});

describe("docRegressionsOf", () => {
  const baseline = { offenders: [{ lines: 300, path: "skills/a/SKILL.md" }] };

  it("holds when a baselined offender shrinks", () => {
    const current = [{ limit: 200, lines: 250, path: "skills/a/SKILL.md" }];
    expect(docRegressionsOf({ baseline, current })).toEqual([]);
  });

  it("refuses a baselined offender growing past its floor", () => {
    const current = [{ limit: 200, lines: 301, path: "skills/a/SKILL.md" }];
    expect(docRegressionsOf({ baseline, current })).toEqual([
      { baselineLines: 300, limit: 200, lines: 301, path: "skills/a/SKILL.md" },
    ]);
  });

  it("refuses a brand-new offender", () => {
    const current = [{ limit: 300, lines: 301, path: "docs/b.md" }];
    expect(docRegressionsOf({ baseline, current })).toEqual([
      { baselineLines: undefined, limit: 300, lines: 301, path: "docs/b.md" },
    ]);
  });

  it("refuses every offender when the baseline is empty", () => {
    const current = [{ limit: 200, lines: 201, path: "skills/b/SKILL.md" }];
    expect(docRegressionsOf({ baseline: { offenders: [] }, current })).toEqual([
      { baselineLines: undefined, limit: 200, lines: 201, path: "skills/b/SKILL.md" },
    ]);
  });
});

describe("docWorseningsOf", () => {
  it("keeps only the regressions that had a floor to grow past", () => {
    const regressions = [
      { baselineLines: 300, limit: 200, lines: 301, path: "skills/a/SKILL.md" },
      { baselineLines: undefined, limit: 200, lines: 201, path: "skills/b/SKILL.md" },
    ];
    expect(docWorseningsOf({ regressions })).toEqual([
      { baselineLines: 300, limit: 200, lines: 301, path: "skills/a/SKILL.md" },
    ]);
  });
});
