import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readTextAhead } from "../../../lib/readAhead.js";
import { scanTextFiles } from "../../../lib/textFileScan.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "read-ahead-"));
  mkdirSync(join(root, "nested"));
  writeFileSync(join(root, "a.ts"), "alpha\n");
  writeFileSync(join(root, "nested", "b.ts"), "beta\n");
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

describe("readTextAhead", () => {
  it("serves every path's text exactly as it was on disk", async () => {
    const readText = await readTextAhead({ paths: ["a.ts", "nested/b.ts"], root });

    expect(readText({ path: "a.ts" })).toBe("alpha\n");
    expect(readText({ path: "nested/b.ts" })).toBe("beta\n");
  });

  it("serves more paths than it keeps in flight at once", async () => {
    const paths = Array.from({ length: 70 }, (_, index) => `many-${String(index)}.ts`);
    for (const path of paths) {
      writeFileSync(join(root, path), path);
    }

    const readText = await readTextAhead({ paths, root });

    expect(paths.map((path) => readText({ path }))).toEqual(paths);
  });

  it("rethrows the very error a failed read raised, so a scan still names its errno", async () => {
    const readText = await readTextAhead({ paths: ["a.ts", "gone.ts"], root });

    expect(() => readText({ path: "gone.ts" })).toThrow(/ENOENT/);
    const scanned = scanTextFiles<string>({
      paths: ["a.ts", "gone.ts"],
      readText,
      scan: ({ content }) => [content],
    });
    expect(scanned.hits).toEqual(["alpha\n"]);
    expect(scanned.unreadable.map((entry) => entry.path)).toEqual(["gone.ts"]);
    expect(scanned.unreadable.map((entry) => entry.reason)).toEqual(["ENOENT"]);
  });

  it("refuses a path it was never asked to read rather than reading it late", async () => {
    const readText = await readTextAhead({ paths: ["a.ts"], root });

    expect(() => readText({ path: "nested/b.ts" })).toThrow("nested/b.ts was not among the paths read ahead");
  });

  it("answers a reader over nothing for an empty path list", async () => {
    const readText = await readTextAhead({ paths: [], root });

    expect(() => readText({ path: "a.ts" })).toThrow("a.ts was not among the paths read ahead");
  });
});
