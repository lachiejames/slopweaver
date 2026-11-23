/**
 * Every platform registration stays cheap to import, and this is the only thing that says so.
 *
 * `registry.ts` imports all of them EAGERLY, on purpose: a row is strings and `import()` thunks, so
 * building a manifest or answering `atlas vanta --help` costs a few object literals. A single static
 * `import { JAM_STORE_SPEC } from "./store.js"` added to one registration silently drags that platform's
 * whole Zod model, its transport and its browser plumbing onto every invocation of every unrelated verb —
 * and NOTHING FAILS. No test goes red, no gate fires, the CLI just gets slower for everyone.
 *
 * So the witness is the source text rather than behaviour: a platform registration's top-level imports are
 * all `import type`, which TypeScript erases entirely. That is exactly true of every one today, which is
 * what makes it a bar rather than a hope. A registration that genuinely needs a value imports it INSIDE a
 * thunk, as `readReset` and `readDescriptor` both do.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/** The `src/atlas` directory, resolved from this file rather than from the process's working directory. */
const ATLAS_DIR = fileURLToPath(new URL("../../../atlas", import.meta.url));

/** One platform's registration source, read off disk. */
function platformRegistrationSources(): readonly { platform: string; source: string }[] {
  const directories = readdirSync(ATLAS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "kit")
    .map((entry) => ({ file: join(ATLAS_DIR, entry.name, "registration.ts"), platform: entry.name }));
  return directories
    .filter((entry) => existsSync(entry.file))
    .map((entry) => ({ platform: entry.platform, source: readFileSync(entry.file, "utf8") }));
}

/** The top-level `import` statements of one file, one per line. */
function topLevelImportLines({ source }: { source: string }): readonly string[] {
  return source.split("\n").filter((line) => line.startsWith("import "));
}

describe("a platform registration imports no VALUE at the top level", () => {
  const files = platformRegistrationSources();

  it("there are registrations to check", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files.map((entry) => [entry.platform, entry.source] as const))("%s", (_platform, source) => {
    const valueImports = topLevelImportLines({ source }).filter((line) => !line.startsWith("import type "));
    expect(valueImports).toEqual([]);
  });

  it("the check can see an import at all, so an empty result is not the reason it passes", () => {
    const everyImport = files.flatMap((entry) => topLevelImportLines({ source: entry.source }));
    expect(everyImport.length).toBe(files.length);
  });
});
