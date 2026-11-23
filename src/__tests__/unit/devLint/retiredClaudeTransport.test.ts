import { describe, expect, it } from "vitest";
import { isScannablePath, scanRetiredClaudeTransport } from "../../../devLint/retiredClaudeTransport.js";

describe("scanRetiredClaudeTransport (pure)", () => {
  it("flags a live door-coverage allowlist entry keyed on the deleted file", () => {
    const hits = scanRetiredClaudeTransport({
      content: '  "src/llm/claudeCli.ts": "llm-transport",',
      path: "src/admit/coverage.ts",
    });
    expect(hits).toEqual([{ excerpt: "src/llm", label: "src-llm-path", line: 1, path: "src/admit/coverage.ts" }]);
  });

  it("flags a comparator naming the claude transport by its deleted path", () => {
    const hits = scanRetiredClaudeTransport({
      content: " * `claude` transport in `src/llm/claudeCli.ts`. Passing an `env` would make the SDK inject",
      path: "src/codex/client.ts",
    });
    expect(hits).toEqual([
      { excerpt: "src/llm", label: "src-llm-path", line: 1, path: "src/codex/client.ts" },
      { excerpt: "claude` transport", label: "claude-transport-claim", line: 1, path: "src/codex/client.ts" },
    ]);
  });

  it("flags a lane description claiming a spawned claude subprocess, claude first", () => {
    const hits = scanRetiredClaudeTransport({
      content: " * The INTEGRATION lane spawns a real `claude` subprocess through Polly.",
      path: "config/vitest/integration.ts",
    });
    expect(hits).toEqual([
      { excerpt: "claude` subprocess", label: "claude-transport-claim", line: 1, path: "config/vitest/integration.ts" },
    ]);
  });

  it("flags the transport/subprocess-word-first ordering too", () => {
    const hits = scanRetiredClaudeTransport({
      content: "the subprocess wraps a real claude session",
      path: "src/x.ts",
    });
    expect(hits).toEqual([
      { excerpt: "subprocess wraps a real claude", label: "claude-transport-claim", line: 1, path: "src/x.ts" },
    ]);
  });

  it("reports the correct line number for a hit below the first line", () => {
    const hits = scanRetiredClaudeTransport({
      content: "line one\nline two\nimports from src/llm still here",
      path: "src/x.ts",
    });
    expect(hits).toEqual([{ excerpt: "src/llm", label: "src-llm-path", line: 3, path: "src/x.ts" }]);
  });

  it("allows an explicitly historical mention (now forbidden)", () => {
    const content =
      "`ask` used to compose an answer itself, spawning the keyless `claude -p` transport. That is now forbidden:";
    expect(scanRetiredClaudeTransport({ content, path: "src/cli/commands/store/read.ts" })).toEqual([]);
  });

  it("allows an explicitly historical mention (historically)", () => {
    const content = "the deleted `claude` transport was historically wired through a local gateway";
    expect(scanRetiredClaudeTransport({ content, path: "src/x.ts" })).toEqual([]);
  });

  it("allows a bare claude mention with no nearby transport/subprocess word", () => {
    const content = " * visible `claude` session `cmux spawn` opens (src/cmux/spawn.ts): a real terminal typed into";
    expect(scanRetiredClaudeTransport({ content, path: "src/codex/client.ts" })).toEqual([]);
  });

  it("allows a claude+transport pair over 60 characters apart (out of window)", () => {
    const content = `claude ${"x".repeat(70)} transport`;
    expect(scanRetiredClaudeTransport({ content, path: "src/x.ts" })).toEqual([]);
  });
});

describe("isScannablePath", () => {
  it("includes a TypeScript source under src/", () => {
    expect(isScannablePath({ path: "src/admit/coverage.ts" })).toBe(true);
  });

  it("includes a shell script under scripts/", () => {
    expect(isScannablePath({ path: "scripts/prove-hook-mirror-survives-cache-replacement.sh" })).toBe(true);
  });

  it("includes a vitest lane config under config/vitest/", () => {
    expect(isScannablePath({ path: "config/vitest/integration.ts" })).toBe(true);
    expect(isScannablePath({ path: "config/vitest/unit.ts" })).toBe(true);
  });

  it("excludes this gate's own files", () => {
    expect(isScannablePath({ path: "src/devLint/retiredClaudeTransport.ts" })).toBe(false);
    expect(isScannablePath({ path: "src/devLint/retiredClaudeTransport.entry.ts" })).toBe(false);
  });

  it("excludes tests and fixtures", () => {
    expect(isScannablePath({ path: "src/__tests__/unit/admit/coverage.test.ts" })).toBe(false);
    expect(isScannablePath({ path: "eval/fixtures/corpus.bronze.jsonl" })).toBe(false);
  });

  it("excludes Markdown and non-root, non-src/scripts paths", () => {
    expect(isScannablePath({ path: "docs/integration-coverage.md" })).toBe(false);
    expect(isScannablePath({ path: "AGENTS.md" })).toBe(false);
    expect(isScannablePath({ path: "package.json" })).toBe(false);
  });
});
