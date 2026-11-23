import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readScriptSource } from "../../../admit/scriptSourceReader.js";

describe("readScriptSource", () => {
  let dir = "";

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "slopweaver-script-reader-"));
  });

  afterEach(() => {
    rmSync(dir, { force: true, recursive: true });
  });

  it("reads a relative script against the payload cwd, and an absolute one as given", () => {
    mkdirSync(join(dir, "scripts"));
    writeFileSync(join(dir, "scripts", "watch.sh"), "#!/bin/bash\ngh pr checks 1\n");
    expect(readScriptSource({ cwd: dir, path: "scripts/watch.sh" })).toBe("#!/bin/bash\ngh pr checks 1\n");
    expect(readScriptSource({ cwd: undefined, path: join(dir, "scripts", "watch.sh") })).toBe(
      "#!/bin/bash\ngh pr checks 1\n",
    );
  });

  it("reads a relative script against the process's own directory when the payload carried no cwd", () => {
    writeFileSync(join(dir, "own.sh"), "#!/bin/bash\nsleep 1\n");
    const fromProcess = relative(process.cwd(), join(dir, "own.sh"));
    expect(readScriptSource({ cwd: undefined, path: fromProcess })).toBe("#!/bin/bash\nsleep 1\n");
  });

  it("reads nothing for a missing file, a directory, or a binary", () => {
    mkdirSync(join(dir, "adir"));
    writeFileSync(join(dir, "bin"), Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x00, 0x01]));
    expect(readScriptSource({ cwd: dir, path: "missing.sh" })).toBe(undefined);
    expect(readScriptSource({ cwd: dir, path: "adir" })).toBe(undefined);
    expect(readScriptSource({ cwd: dir, path: "bin" })).toBe(undefined);
  });

  it("reads nothing for a file past the size cap", () => {
    writeFileSync(join(dir, "big.sh"), "#".repeat(512 * 1024 + 1));
    expect(readScriptSource({ cwd: dir, path: "big.sh" })).toBe(undefined);
  });
});
