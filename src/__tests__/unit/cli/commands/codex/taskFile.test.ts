import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readTaskFile } from "../../../../../cli/commands/codex/taskFile.js";
import { EXIT_ERROR, EXIT_USAGE } from "../../../../../cli/exitCodes.js";

describe("readTaskFile", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "task-file-"));
  });

  afterEach(() => {
    rmSync(dir, { force: true, recursive: true });
  });

  it("returns the text of a task file that names a task", () => {
    const path = join(dir, "task.md");
    writeFileSync(path, "plan the migration\n");

    expect(readTaskFile({ path, verb: "codex plan" })).toBe("plan the migration\n");
  });

  it("exits as a failure, not a usage error, when the file cannot be read", () => {
    expect(readTaskFile({ path: join(dir, "missing.md"), verb: "codex plan" })).toBe(EXIT_ERROR);
  });

  it("exits as a usage error when the file reads but is blank", () => {
    const path = join(dir, "blank.md");
    writeFileSync(path, "  \n\t\n");

    expect(readTaskFile({ path, verb: "codex plan" })).toBe(EXIT_USAGE);
  });
});
