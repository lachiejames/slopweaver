/**
 * The Gmail write guard holds only if every Gmail SDK client is built through `src/live/gmail/client.ts`, whose
 * `guardedGmailSdk` installs the guarded transport. This census reads every production `.ts` file under `src/` and
 * asserts that the one VALUE import of `@googleapis/gmail` — the `gmail(...)` factory, a `new gmail_v1.Gmail(...)`, a
 * dynamic `import(...)` or a `require(...)` — sits in that file alone. A type-only import (`import type { gmail_v1 }`)
 * builds nothing and is allowed anywhere. Comment lines are skipped, so a repro command in a JSDoc block is not a
 * construction. Residue: a construction reached through a re-export under another name, or through `googleapis`'s
 * umbrella package if one is ever added, is not seen here.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(import.meta.dirname, "..", "..", "..", "..");
const THE_ONE_FILE = "live/gmail/client.ts";

/** Every production TypeScript file under `src/`, relative to it, tests and declaration files excluded. */
function productionFiles(): readonly string[] {
  return readdirSync(SRC, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts"))
    .map((entry) => relative(SRC, join(entry.parentPath, entry.name)))
    .filter((path) => !path.startsWith("__tests__"));
}

/** A line that builds or loads the Gmail SDK as a value. */
const CONSTRUCTION = [
  /^import\s(?!\s*type\b)[^;]*["']@googleapis\/gmail["']/u,
  /\b(?:import|require)\(\s*["']@googleapis\/gmail["']\s*\)/u,
  /\bnew\s+gmail_v1\.Gmail\s*\(/u,
];

/** Whether a line is a comment rather than code. */
const isComment = ({ line }: { line: string }): boolean => /^(?:\*|\/\*|\/\/)/u.test(line.trim());

/** The files holding at least one code line that constructs the Gmail SDK. */
function constructingFiles({ files }: { files: readonly string[] }): readonly string[] {
  return files.filter((path) =>
    readFileSync(join(SRC, path), "utf8")
      .split("\n")
      .some((line) => !isComment({ line }) && CONSTRUCTION.some((pattern) => pattern.test(line.trim()))),
  );
}

describe("Gmail SDK construction census", () => {
  it("finds the production tree, and the one file constructing the Gmail SDK is the guarded client", () => {
    const files = productionFiles();
    expect(files.length).toBeGreaterThan(0);
    expect(files).toContain(THE_ONE_FILE);
    expect(constructingFiles({ files })).toEqual([THE_ONE_FILE]);
  });

  it("would catch each construction shape, and lets a type-only import and a comment through", () => {
    const shapes = [
      'import { gmail } from "@googleapis/gmail";',
      'const { gmail } = await import("@googleapis/gmail");',
      "const client = new gmail_v1.Gmail({ auth });",
    ];
    const allowed = [
      'import type { gmail_v1 } from "@googleapis/gmail";',
      ' *       const {gmail}=await import("@googleapis/gmail");',
    ];
    expect(shapes.map((line) => CONSTRUCTION.some((pattern) => pattern.test(line.trim())))).toEqual([true, true, true]);
    expect(
      allowed.map((line) => !isComment({ line }) && CONSTRUCTION.some((pattern) => pattern.test(line.trim()))),
    ).toEqual([false, false]);
  });
});
