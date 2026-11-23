import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runCodexReviewFallback } from "../../../../../cli/commands/codex/fallbackReviewRun.js";
import { EXIT_USAGE } from "../../../../../cli/exitCodes.js";

let home: string | undefined;

afterEach(() => {
  if (home !== undefined) {
    rmSync(home, { force: true, recursive: true });
  }
  home = undefined;
});

describe("codex review-fallback prepare --after-refusal", () => {
  it("refuses a blank --after-refusal as a usage error and writes nothing, never falling to the cap path", async () => {
    home = mkdtempSync(join(tmpdir(), "sw-fbrun-"));
    const argv = ["node", "slopweaver", "codex", "review-fallback", "prepare", "--pass", "r2"];
    const exit = await runCodexReviewFallback([
      ...argv,
      "--property-id",
      "r2-01",
      "--property",
      "a claim",
      "--base",
      "HEAD",
      "--max-diff-bytes",
      "1000",
      "--after-refusal",
      "",
      "--home",
      home,
    ]);
    expect(exit).toBe(EXIT_USAGE);
    expect(readdirSync(home)).toEqual([]);
  });
});
