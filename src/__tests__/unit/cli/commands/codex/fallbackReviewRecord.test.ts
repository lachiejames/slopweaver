import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { readFallbackAnswerFile } from "../../../../../cli/commands/codex/fallbackReviewRecord.js";
import { EXIT_ERROR } from "../../../../../cli/exitCodes.js";

let dir: string | undefined;

afterEach(() => {
  if (dir !== undefined) {
    rmSync(dir, { force: true, recursive: true });
  }
  dir = undefined;
});

describe("readFallbackAnswerFile", () => {
  it("returns the answer file's text byte for byte", () => {
    dir = mkdtempSync(join(tmpdir(), "sw-fbanswer-"));
    const path = join(dir, "answer.json");
    writeFileSync(path, '{"verdict":"CLEAN"}\n');
    expect(readFallbackAnswerFile({ path, verb: "codex review-fallback record" })).toBe('{"verdict":"CLEAN"}\n');
  });

  it("returns the error exit code for a file that is not there", () => {
    dir = mkdtempSync(join(tmpdir(), "sw-fbanswer-"));
    expect(readFallbackAnswerFile({ path: join(dir, "missing.json"), verb: "codex review-fallback record" })).toBe(
      EXIT_ERROR,
    );
  });
});
