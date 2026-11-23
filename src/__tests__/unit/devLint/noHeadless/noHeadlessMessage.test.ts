import { describe, expect, it } from "vitest";
import { noHeadlessMessage } from "../../../../devLint/noHeadless.js";

describe("noHeadlessMessage", () => {
  it("names the path, line, rule and excerpt", () => {
    const message = noHeadlessMessage({
      finding: { excerpt: "spawn", kind: "NH001", line: 4, path: "src/llm/claudeCli.ts" },
    });
    expect(message).toContain("src/llm/claudeCli.ts:4");
    expect(message).toContain("[NH001]");
    expect(message).toContain("spawn");
    expect(message).toContain("AGENTS.md rule 2");
  });
});
