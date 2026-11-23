import { describe, expect, it } from "vitest";

import { classifyArtifactTool } from "../../../admit/artifactTool.js";
import { evaluateHookPayload } from "../../../admit/hookPayload.js";
import { JUDGEMENT_NOTE } from "../../../hatch/render.js";

/** One `Artifact` tool call, as the harness shapes a PreToolUse payload. */
function artifact({ input }: { input: Record<string, unknown> }): unknown {
  return { session_id: "s1", tool_input: input, tool_name: "Artifact" };
}

describe("classifyArtifactTool", () => {
  it("refuses a publish, and the refusal names the verb that replaces it", () => {
    const verdict = classifyArtifactTool({
      allowArtifact: false,
      payload: artifact({ input: { file_path: "p.html" } }),
    });
    expect(verdict.blocked).toBe(true);
    const lines = verdict.blocked ? verdict.message.split("\n") : [];
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain("a call of the Artifact tool blocked because");
    expect(lines[0]).toContain("slopweaver page publish <slug> --page <html>");
    expect(lines[1]).toContain("Legitimate exceptions may include");
    expect(lines[2]).toBe(
      "To override use the designated escape hatch SLOPWEAVER_ALLOW_ARTIFACT=1 a call of the Artifact tool.",
    );
    expect(lines[3]).toBe(JUDGEMENT_NOTE);
  });

  it("refuses a READ as well, because the rule is about where a page lives", () => {
    expect(
      classifyArtifactTool({ allowArtifact: false, payload: artifact({ input: { action: "read", url: "u" } }) })
        .blocked,
    ).toBe(true);
    expect(
      classifyArtifactTool({ allowArtifact: false, payload: artifact({ input: { action: "list" } }) }).blocked,
    ).toBe(true);
  });

  it("refuses a call carrying no input at all", () => {
    expect(classifyArtifactTool({ allowArtifact: false, payload: { tool_name: "Artifact" } }).blocked).toBe(true);
  });

  it("is opened by its own hatch", () => {
    expect(classifyArtifactTool({ allowArtifact: true, payload: artifact({ input: {} }) }).blocked).toBe(false);
  });

  it("allows every other tool, and anything that is not an object", () => {
    expect(classifyArtifactTool({ allowArtifact: false, payload: { tool_name: "Bash" } }).blocked).toBe(false);
    expect(classifyArtifactTool({ allowArtifact: false, payload: { tool_name: "ArtifactComments" } }).blocked).toBe(
      false,
    );
    expect(classifyArtifactTool({ allowArtifact: false, payload: "not-an-object" }).blocked).toBe(false);
  });
});

describe("the evaluator asks the Artifact walk first", () => {
  it("refuses an Artifact call, which no shell classifier would ever have seen", () => {
    const decision = evaluateHookPayload({
      allowArtifact: false,
      allowPython: false,
      allowRaw: false,
      payload: artifact({ input: { file_path: "p.html" } }),
    });
    expect(decision.block).toBe(true);
    expect(decision.block ? decision.message : "").toContain("SLOPWEAVER_ALLOW_ARTIFACT=1");
  });

  it("is not opened by the raw or the Python hatch", () => {
    const decision = evaluateHookPayload({
      allowArtifact: false,
      allowPython: true,
      allowRaw: true,
      payload: artifact({ input: {} }),
    });
    expect(decision.block).toBe(true);
  });

  it("and its own hatch opens neither of theirs", () => {
    const python = evaluateHookPayload({
      allowArtifact: true,
      allowPython: false,
      allowRaw: false,
      payload: { session_id: "s1", tool_input: { command: "python3 -V" }, tool_name: "Bash" },
    });
    expect(python.block).toBe(true);
    expect(python.block ? python.message : "").toContain("SLOPWEAVER_ALLOW_PYTHON=1");
  });

  it("leaves an ordinary shell call alone", () => {
    expect(
      evaluateHookPayload({
        allowArtifact: false,
        allowPython: false,
        allowRaw: false,
        payload: { session_id: "s1", tool_input: { command: "ls -la" }, tool_name: "Bash" },
      }).block,
    ).toBe(false);
  });

  it("still fails closed on a malformed payload", () => {
    expect(
      evaluateHookPayload({ allowArtifact: false, allowPython: false, allowRaw: false, payload: "not-an-object" })
        .block,
    ).toBe(true);
  });
});
