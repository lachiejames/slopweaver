/**
 * Unit: the Make SDK has one way in. Only `atlas/make/client.ts` may import `@makehq/sdk`, because that file's
 * subclass is where every write and run is refused; a second importer would construct an unrailed client.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const SRC = join(import.meta.dirname, "../../../..");

/** Every TypeScript source file under `src/`, test trees excluded. */
function sourceFiles(): readonly string[] {
  return readdirSync(SRC, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => relative(SRC, join(entry.parentPath, entry.name)))
    .filter((path) => !path.startsWith("__tests__"));
}

describe("the Make SDK's one importer", () => {
  it("is the railed client and nothing else", () => {
    const files = sourceFiles();
    expect(files.length).toBeGreaterThan(0);
    const importers = files.filter((path) => /from "@makehq\/sdk/.test(readFileSync(join(SRC, path), "utf8")));
    expect(importers).toStrictEqual(["atlas/make/client.ts"]);
  });
});
