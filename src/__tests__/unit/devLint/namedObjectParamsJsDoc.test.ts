import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as ts from "#lib/tsCompiler.js";

import { scanNamedObjectParams } from "../../../devLint/namedObjectParams.js";
import { startCompiler } from "../../../devLint/namedObjectParamsProgram.js";

/**
 * One real Program over the full ESNext lib, read from disk: the same fixed cost
 * `namedObjectParams/optionsObject.test.ts` names.
 */
vi.setConfig({ testTimeout: 60_000 });

/**
 * The fixture: every place a JSDoc comment can reach a verdict or a diagnostic. An import used ONLY by a
 * `{@link}`, a malformed tag on a file that carries a finding, and a JavaScript module whose `@typedef` IS the
 * type a TypeScript signature takes.
 */
const FILES: Readonly<Record<string, string>> = {
  "consumer.ts": [
    `import type { Opts } from "./typed.js";`,
    "export function viaJs(options: Opts): string { return options.source; }",
  ].join("\n"),
  "helper.ts": "export interface Helper { name: string }",
  "linked.ts": [
    `import type { Helper } from "./helper.js";`,
    "/** Pairs two values, as {@link Helper} does. */",
    "export function pair(left: string, right: string): string { return left + right; }",
  ].join("\n"),
  "malformed.ts": [
    "/** @param {string */",
    "export function solo(value: Date): string { return value.toISOString(); }",
  ].join("\n"),
  "typed.js": [
    "/** @typedef {{ source: string }} Opts */",
    "/** @param {Opts} options */",
    "export function use(options) { return options.source; }",
  ].join("\n"),
};

const OPTIONS: ts.CompilerOptions = {
  allowJs: true,
  checkJs: true,
  // No `lib`: the ESNext target's default is the full lib, the one name `namedObjectParamsFixture.ts` says the
  // server will not load when spelled out.
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  noEmit: true,
  noUnusedLocals: true,
  strict: true,
  target: ts.ScriptTarget.ESNext,
  types: [],
};

let dir: string;

beforeAll(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "nop-jsdoc-")));
  for (const [name, text] of Object.entries(FILES)) {
    writeFileSync(join(dir, name), `${text}\n`);
  }
});

afterAll(() => {
  rmSync(dir, { force: true, recursive: true });
});

/**
 * What the gate's compiler makes of the fixture: the rule's findings over the TypeScript files, and every
 * diagnostic the violation path would read, each as `TS<code> <file>:<line>`.
 *
 * @returns the findings and the diagnostics, each in a stable order
 */
function readFixture(): { readonly findings: readonly string[]; readonly diagnostics: readonly string[] } {
  const names = Object.keys(FILES).map((name) => join(dir, name));
  const program = startCompiler({ cwd: dir }).createProgram(names, OPTIONS);
  const located = ({ code, fileName, startPosition }: ts.Diagnostic): string => {
    if (fileName === undefined || startPosition === undefined) {
      return `TS${String(code)} (global):0`;
    }
    return `TS${String(code)} ${basename(fileName)}:${String(startPosition.line + 1)}`;
  };
  const diagnostics = [
    ...program.getGlobalDiagnostics(),
    ...names.flatMap((name) => [...program.getSyntacticDiagnostics(name), ...program.getSemanticDiagnostics(name)]),
  ].map(located);
  const findings = scanNamedObjectParams({
    checker: program.getProject().checker,
    sourceFiles: names.filter((name) => name.endsWith(".ts")).map((name) => program.getSourceFile(name)!),
  }).map((v) => `${basename(v.path)}:${String(v.line)} ${v.name} ${v.rule}`);
  return { diagnostics: diagnostics.toSorted(), findings };
}

// The two controls this file compared against were TypeScript 6 compiler hosts told how much JSDoc to parse; the
// gate's own host went with them, and the 7.1 server parses every comment.
// deleted-with-code: gateCompilerHost
describe("the gate's compiler reads every JSDoc comment a verdict or a diagnostic depends on", () => {
  it("counts a `{@link}` as a use, resolves a JavaScript `@typedef`, and finds past a malformed tag", () => {
    const read = readFixture();
    // TS6133 on linked.ts:1 is what an unread `{@link}` reports, and TS2305 on consumer.ts:1 an unread `@typedef`.
    expect(read.diagnostics).toEqual([]);
    expect(read.findings).toEqual(["linked.ts:3 pair arity", "malformed.ts:2 solo not-an-options-object"]);
  });
});
