/**
 * The import organiser in real processes, through the two committed paths that write imports: `package.json`'s
 * `format` script and `lefthook.yml`'s pre-commit commands, each read from the file and run as written against
 * the committed `biome.jsonc` and `.prettierrc`. Both sort a disordered import block, merge two imports of one
 * module, drop an unused one and leave a merged import too long for one line wrapped — which only Biome THEN
 * Prettier produces, so the order is under test too — and a second pass changes nothing. Biome replaced
 * `prettier-plugin-organize-imports`, which calls TypeScript 6's language service and, under TypeScript 7,
 * swallows the failure and returns the source unchanged; so the format script also runs under a resolve hook that
 * refuses any `typescript` module, with a negative control proving the hook sees a load.
 *
 * Subprocess, not unit: the subject is two installed binaries, the commands that call them and the files they
 * write (`.claude/rules/testing.md`).
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

import { gitInTemp } from "../../tempGitRepo.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const BIN = join(repoRoot, "node_modules", ".bin");
const PLANTED = "src/planted.ts";

/** A deadline rather than a request: a hung formatter fails loudly instead of hanging the lane. */
const RUN_DEADLINE_MS = 60_000;

/** Ten imports: out of order, two of `node:path` split apart, two of one long module split apart, one unused. */
const DISORDERED = [
  `import { z } from "zod";`,
  `import { join, dirname } from "node:path";`,
  `import { organiserWitnessSecondLongBindingName } from "./aModuleWithALongEnoughPathToWrap.js";`,
  `import type { Result } from "../lib/result.js";`,
  `import { unusedThing } from "./unused.js";`,
  `import { readFileSync } from "node:fs";`,
  `import { basename } from "node:path";`,
  `import Alpha from "./Alpha.js";`,
  `import { organiserWitnessFirstLongBindingName } from "./aModuleWithALongEnoughPathToWrap.js";`,
  `import { beta } from "./beta.js";`,
  ``,
  `export function f({ p }: { p: string }): Result<string> {`,
  `  return { ok: true, value: join(dirname(p), basename(p), z.string().parse(readFileSync(p, "utf8")), Alpha, beta) } as never;`,
  `}`,
  ``,
  `export const both = [organiserWitnessFirstLongBindingName, organiserWitnessSecondLongBindingName];`,
  ``,
].join("\n");

/** What the paths write: sorted, both modules merged, `unusedThing` gone, the long merge and the body wrapped. */
const ORGANISED = [
  `import { readFileSync } from "node:fs";`,
  `import { basename, dirname, join } from "node:path";`,
  `import { z } from "zod";`,
  `import type { Result } from "../lib/result.js";`,
  `import Alpha from "./Alpha.js";`,
  `import {`,
  `  organiserWitnessFirstLongBindingName,`,
  `  organiserWitnessSecondLongBindingName,`,
  `} from "./aModuleWithALongEnoughPathToWrap.js";`,
  `import { beta } from "./beta.js";`,
  ``,
  `export function f({ p }: { p: string }): Result<string> {`,
  `  return {`,
  `    ok: true,`,
  `    value: join(dirname(p), basename(p), z.string().parse(readFileSync(p, "utf8")), Alpha, beta),`,
  `  } as never;`,
  `}`,
  ``,
  `export const both = [organiserWitnessFirstLongBindingName, organiserWitnessSecondLongBindingName];`,
  ``,
].join("\n");

/**
 * A resolve hook that records it ran, then refuses any module under a `typescript` package (the compiler, a
 * subpath, `@typescript/typescript6`). `registerHooks` sees both `require` and `import`.
 */
const GUARD_SOURCE = [
  `import { appendFileSync } from "node:fs";`,
  `import { registerHooks } from "node:module";`,
  `appendFileSync(process.env.ORGANISER_GUARD_MARKER, "loaded\\n");`,
  `const COMPILER = /(?:^|[\\\\/])(?:typescript|@typescript[\\\\/]typescript6)(?:$|[\\\\/])/u;`,
  `registerHooks({`,
  `  resolve(specifier, context, next) {`,
  `    const resolved = next(specifier, context);`,
  `    if (COMPILER.test(specifier) || COMPILER.test(resolved.url)) {`,
  `      throw new Error("organiser-guard: a TypeScript module was loaded: " + resolved.url);`,
  `    }`,
  `    return resolved;`,
  `  },`,
  `});`,
  ``,
].join("\n");

const packageSchema = z.object({ scripts: z.object({ format: z.string() }) });
const lefthookSchema = z.object({
  "pre-commit": z.object({
    commands: z.record(z.string(), z.object({ glob: z.string().optional(), priority: z.number(), run: z.string() })),
    parallel: z.boolean().optional(),
    piped: z.boolean().optional(),
  }),
});

/** `yarn format`'s committed command line. */
function formatScript(): string {
  return packageSchema.parse(JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"))).scripts.format;
}

/** `lefthook.yml`'s committed pre-commit hook. */
function preCommitHook(): z.infer<typeof lefthookSchema>["pre-commit"] {
  return lefthookSchema.parse(parseYaml(readFileSync(join(repoRoot, "lefthook.yml"), "utf8")))["pre-commit"];
}

/**
 * The pre-commit commands that receive staged files, in priority order, by name. Lefthook runs them in that
 * order only when the hook is `piped`, which the hook test asserts beside this.
 */
function preCommitFileCommands(): readonly { name: string; run: string }[] {
  const { commands } = preCommitHook();
  return Object.entries(commands)
    .filter(([, command]) => command.run.includes("{staged_files}"))
    .toSorted(([, a], [, b]) => a.priority - b.priority)
    .map(([name, command]) => ({ name, run: command.run }));
}

const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A temp git project holding the committed configs and the disordered file, answered with its paths. */
function plantProject(): { dir: string; file: string; marker: string; guard: string } {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-organiser-"));
  fixtureDirs.push(dir);
  gitInTemp({ args: ["init", "-q"], cwd: dir });
  copyFileSync(join(repoRoot, "biome.jsonc"), join(dir, "biome.jsonc"));
  copyFileSync(join(repoRoot, ".prettierrc"), join(dir, ".prettierrc"));
  mkdirSync(join(dir, "src"));
  const file = join(dir, PLANTED);
  writeFileSync(file, DISORDERED);
  const guard = join(dir, "guard.mjs");
  writeFileSync(guard, GUARD_SOURCE);
  return { dir, file, guard, marker: join(dir, "guard-marker.txt") };
}

/**
 * Every child's environment: the repository's `node_modules/.bin` first on `PATH`, as yarn puts it for a script;
 * the guard preloaded when asked, otherwise no inherited `NODE_OPTIONS`.
 */
function childEnv({ guard, marker }: { guard?: string; marker?: string }): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${BIN}${delimiter}${process.env["PATH"]!}` };
  delete env["NODE_OPTIONS"];
  if (guard !== undefined && marker !== undefined) {
    env["NODE_OPTIONS"] = `--import=${pathToFileURL(guard).href}`;
    env["ORGANISER_GUARD_MARKER"] = marker;
  }
  return env;
}

/** One shell command line run in the project, answered with its exit code and output. */
function sh({ line, cwd, env }: { line: string; cwd: string; env: NodeJS.ProcessEnv }): {
  status: number | null;
  output: string;
} {
  const child = spawnSync("/bin/sh", ["-c", line], { cwd, encoding: "utf8", env, timeout: RUN_DEADLINE_MS });
  return { output: `${child.stdout}${child.stderr}`, status: child.status };
}

/** `yarn format`'s committed script over the project, answered with its exit code. */
function runFormatScript({ dir, env }: { dir: string; env: NodeJS.ProcessEnv }): number | null {
  return sh({ cwd: dir, env, line: formatScript() }).status;
}

/**
 * The committed pre-commit commands over the planted file as the one staged file, answered with exit codes. The
 * project has no `node_modules`, so a command's `node_modules/.bin/` prefix is dropped and the bin resolves through
 * `PATH`, where `childEnv` puts the repository's first — no absolute path is spliced into the shell line.
 */
function runPreCommit({ dir }: { dir: string }): readonly (number | null)[] {
  return preCommitFileCommands().map(
    (command) =>
      sh({
        cwd: dir,
        env: childEnv({}),
        line: command.run.replace("node_modules/.bin/", "").replace("{staged_files}", PLANTED),
      }).status,
  );
}

describe("the import organiser", () => {
  it("yarn format's script sorts, merges, drops the unused import and wraps the merge, byte for byte", () => {
    const { dir, file } = plantProject();
    expect(runFormatScript({ dir, env: childEnv({}) })).toBe(0);
    expect(readFileSync(file, "utf8")).toBe(ORGANISED);
  });

  it("the pre-commit hook pipes Biome then Prettier over a staged file, to the same bytes", () => {
    const { parallel, piped } = preCommitHook();
    expect({ parallel, piped }).toEqual({ parallel: undefined, piped: true });
    expect(preCommitFileCommands().map((command) => command.name)).toEqual(["biome-imports", "prettier"]);
    const { dir, file } = plantProject();
    expect(runPreCommit({ dir })).toEqual([0, 0]);
    expect(readFileSync(file, "utf8")).toBe(ORGANISED);
  });

  it("is a fixed point: a second pass of either path changes nothing", () => {
    const { dir, file } = plantProject();
    expect(runFormatScript({ dir, env: childEnv({}) })).toBe(0);
    expect(runFormatScript({ dir, env: childEnv({}) })).toBe(0);
    expect(runPreCommit({ dir })).toEqual([0, 0]);
    expect(readFileSync(file, "utf8")).toBe(ORGANISED);
  });

  it("loads no TypeScript module, under a hook that refuses one and that ran", () => {
    const { dir, file, guard, marker } = plantProject();
    expect(runFormatScript({ dir, env: childEnv({ guard, marker }) })).toBe(0);
    expect(readFileSync(file, "utf8")).toBe(ORGANISED);
    expect(readFileSync(marker, "utf8")).toBe("loaded\nloaded\n");
  });

  it("negative control: the same hook refuses a process that loads the compiler", () => {
    const { dir, guard, marker } = plantProject();
    const probe = join(dir, "loadsCompiler.mjs");
    const compiler = join(repoRoot, "node_modules", "typescript", "dist", "ast", "index.js");
    writeFileSync(probe, `await import(${JSON.stringify(compiler)});\n`);
    const child = spawnSync(process.execPath, [probe], {
      cwd: dir,
      encoding: "utf8",
      env: childEnv({ guard, marker }),
      timeout: RUN_DEADLINE_MS,
    });
    expect(child.status).toBe(1);
    expect(`${child.stdout}${child.stderr}`).toContain("organiser-guard: a TypeScript module was loaded");
    expect(existsSync(marker)).toBe(true);
  });
});
