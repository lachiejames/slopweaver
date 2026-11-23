/**
 * `github stack push --dry-run`: the preview touches no Git write and no API, shows the body exactly as it will
 * be sent, and names the walkthrough a confirmed create would post. Split from `stackPushRun.test.ts` by behaviour.
 */
import { describe, expect, it } from "vitest";

import { runGithubStackPush } from "../../../../../../cli/commands/github/stackPushRun.js";
import { EXIT_OK } from "../../../../../../cli/exitCodes.js";
import type { GithubWriteApi } from "../../../../../../corpus/github/write.js";
import { baseForm, PREFIX } from "./fixtures.js";
import { harness, tempHome, useTempHomes } from "./harness.js";

useTempHomes();

describe("runGithubStackPush", () => {
  it("dry-runs without touching Git or the API", async () => {
    const api = {} as GithubWriteApi;
    const { deps, lines, pins, reads, writes } = harness({ api });
    const code = await runGithubStackPush({
      argv: [...PREFIX, "--form", baseForm(), "--dry-run", "--home", tempHome()],
      deps,
    });
    expect(code).toBe(EXIT_OK);
    expect(writes).toEqual([]);
    expect(pins).toEqual([]);
    expect(reads.filter((read) => read === "add --all" || read === "write-tree")).toEqual([]);
    expect(lines).toContain("dry run: no git add/amend, no door record, no push, no create, no network.");
  });

  it("shows the linkified body in the dry-run preview — a bare issue reference is already a real link", async () => {
    const api = {} as GithubWriteApi;
    const { deps, lines } = harness({ api });
    const code = await runGithubStackPush({
      argv: [...PREFIX, "--form", baseForm({ explainerText: "caused by #123" }), "--dry-run", "--home", tempHome()],
      deps,
    });
    expect(code).toBe(EXIT_OK);
    expect(lines.some((line) => line.includes('<a href="https://github.com/o/r/issues/123">#123</a>'))).toBe(true);
    expect(lines.some((line) => line.includes("caused by #123"))).toBe(false);
  });

  it("previews the walkthrough that will follow a confirmed stack create", async () => {
    const api = {} as GithubWriteApi;
    const { deps, lines, writes } = harness({ api });
    const review = JSON.stringify({
      comments: [
        { body: "This explains the stack-specific seam in place.", kind: "explanation", line: 12, path: "src/a.ts" },
      ],
    });
    const code = await runGithubStackPush({
      argv: [...PREFIX, "--form", baseForm(), "--self-review", review, "--home", tempHome(), "--dry-run"],
      deps,
    });
    expect(code).toBe(EXIT_OK);
    expect(writes).toEqual([]);
    expect(lines).toContain("would post 1 inline self-review comment(s) once created");
  });
});
