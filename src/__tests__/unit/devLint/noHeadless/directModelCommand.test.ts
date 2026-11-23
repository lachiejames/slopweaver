import { describe, expect, it } from "vitest";
import { scanNoHeadless } from "../../../../devLint/noHeadless.js";

describe("NH003 — direct model command", () => {
  it("flags a model-runner basename at the start of a shell line", () => {
    const hits = scanNoHeadless({ content: 'claude -p "do the thing"', path: "scripts/run.sh" });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.kind).toBe("NH003");
  });

  it("flags every named runner, and only those", () => {
    const content = ["claude -p x", "codex exec y", "gemini z", "aider w", "opencode v"].join("\n");
    const hits = scanNoHeadless({ content, path: "scripts/run.sh" });
    expect(hits).toHaveLength(5);
  });

  it("flags after env and after nohup", () => {
    const content = ["env DEBUG=1 claude -p x", "nohup codex exec y &"].join("\n");
    const hits = scanNoHeadless({ content, path: "scripts/run.sh" });
    expect(hits).toHaveLength(2);
  });

  it("flags after a shell control operator", () => {
    const content = ["true && claude -p x", "false; codex exec y", "echo hi | claude -p z"].join("\n");
    const hits = scanNoHeadless({ content, path: "scripts/run.sh" });
    expect(hits).toHaveLength(3);
  });

  it("does NOT flag a model id — claude-3-opus is not command position", () => {
    expect(scanNoHeadless({ content: 'const MODEL = "claude-3-opus";', path: "src/x.ts" })).toEqual([]);
  });

  it("does NOT flag a URL naming a runner", () => {
    expect(scanNoHeadless({ content: "// see https://claude.ai/docs", path: "src/x.ts" })).toEqual([]);
  });

  it("does NOT flag a prose sentence naming a runner mid-line", () => {
    expect(scanNoHeadless({ content: "This function talks to claude via HTTP.", path: "src/x.ts" })).toEqual([]);
  });

  it("does NOT flag an error message that merely names a runner", () => {
    const content = 'throw new Error("cannot spawn claude: ENOENT");';
    expect(scanNoHeadless({ content, path: "src/x.ts" })).toEqual([]);
  });
});
