/**
 * The decision stream over a FIXED SUBJECT TREE: a throwaway git checkout with its own lint config, judged
 * by the real subject-mode run. Real git and a real Program, per `.claude/rules/testing.md`'s fixture
 * allowance — the subject's own listing and config are what the run is about, and a fake of either would only
 * prove this file agrees with itself.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { EXEMPT_MARKER } from "../../../devLint/namedObjectParamsMarkers.js";
import { isInsideSubject } from "../../../devLint/namedObjectParamsOracle.js";
import { clearDecisionStream } from "../../../devLint/namedObjectParamsProgram.js";
import { runNamedObjectParamsForSubject } from "../../../devLint/namedObjectParamsRun.js";
import { gitInTemp } from "../../tempGitRepo.js";

/** Each run builds a real Program over the full ESNext lib — the fixed cost `namedObjectParamsFixture.ts` names. */
vi.setConfig({ testTimeout: 60_000 });

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A fresh directory under the per-file temp root, removed after the test. */
function scratch({ label }: { label: string }): string {
  const dir = mkdtempSync(join(tmpdir(), `sw-nop-${label}-`));
  dirs.push(dir);
  return dir;
}

/** The subject's lint config: the gate reads `config/typescript/tsconfig.lint.json` inside whatever root it is handed. */
const LINT_CONFIG = JSON.stringify({
  compilerOptions: {
    lib: ["ESNext"],
    module: "ESNext",
    moduleResolution: "Bundler",
    noEmit: true,
    skipLibCheck: true,
    strict: true,
    target: "ESNext",
    types: [],
  },
  include: ["../../src/**/*.ts"],
});

/** The subject's sources. `src/Z.ts` sorts BEFORE `src/a.ts` in byte order and AFTER it in locale order. */
const SUBJECT_FILES: Readonly<Record<string, string>> = {
  "config/typescript/tsconfig.lint.json": LINT_CONFIG,
  "src/a.ts": ["export function now(): number {", "  return [1].map((n) => n + 1).length;", "}", ""].join("\n"),
  "src/Z.ts": [
    `// ${EXEMPT_MARKER}: a library dictates this shape`,
    "export function pair(a: string, b: string): void {}",
    "",
  ].join("\n"),
};

/** The whole stream that subject must produce, line for line. */
const EXPECTED_STREAM = [
  '{"column":1,"decision":"marker-accounted-arity","kind":"signature","line":2,"name":"pair","path":"src/Z.ts","signature":"(a: string, b: string)"}',
  '{"column":1,"decision":"compliant-zero-parameters","kind":"signature","line":1,"name":"now","path":"src/a.ts","signature":"()"}',
  '{"column":18,"decision":"exempt-inherited","kind":"signature","line":2,"name":"(anonymous)","path":"src/a.ts","signature":"(n)"}',
  "",
].join("\n");

/** A git checkout holding the subject files plus any extras, built with the sanctioned git runner. */
function subjectRepo({ extra }: { extra?: Readonly<Record<string, string>> }): string {
  const root = scratch({ label: "subject" });
  gitInTemp({ args: ["init", "--initial-branch=main"], cwd: root });
  for (const [path, text] of Object.entries({ ...SUBJECT_FILES, ...extra })) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

describe("the decision stream over a fixed subject", () => {
  it("writes byte-identical streams on two TS6 runs over one fixed subject", () => {
    const subjectRoot = subjectRepo({});
    const out = scratch({ label: "streams" });
    const first = join(out, "first.jsonl");
    const second = join(out, "second.jsonl");
    expect(runNamedObjectParamsForSubject({ decisionStreamPath: first, subjectRoot })).toBe(0);
    expect(runNamedObjectParamsForSubject({ decisionStreamPath: second, subjectRoot })).toBe(0);
    expect(readFileSync(second).equals(readFileSync(first))).toBe(true);
  });

  it("writes exactly one row per decision, files in byte order of their subject-relative path", () => {
    const subjectRoot = subjectRepo({});
    const stream = join(scratch({ label: "stream" }), "decisions.jsonl");
    expect(runNamedObjectParamsForSubject({ decisionStreamPath: stream, subjectRoot })).toBe(0);
    expect(readFileSync(stream, "utf8")).toBe(EXPECTED_STREAM);
  });

  it("orders by UTF-8 bytes, not UTF-16 code units, past U+FFFF", () => {
    // U+E000 is `EE 80 80` and U+10000 `F0 90 80 80`, so bytes put U+E000 first; UTF-16 compares U+10000's
    // leading surrogate `D800` against `E000` and puts it first instead.
    const privateUse = "src/\u{E000}.ts";
    const astral = "src/\u{10000}.ts";
    const subjectRoot = subjectRepo({
      extra: { [astral]: "export function k(): void {}\n", [privateUse]: "export function k(): void {}\n" },
    });
    const stream = join(scratch({ label: "stream" }), "decisions.jsonl");
    expect(runNamedObjectParamsForSubject({ decisionStreamPath: stream, subjectRoot })).toBe(0);
    const paths = readFileSync(stream, "utf8")
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => (JSON.parse(line) as { path: string }).path);
    expect(paths).toEqual(["src/Z.ts", "src/a.ts", "src/a.ts", privateUse, astral]);
  });

  it("carries no absolute path, so the stream is the same wherever the subject is checked out", () => {
    const subjectRoot = subjectRepo({});
    const stream = join(scratch({ label: "stream" }), "decisions.jsonl");
    expect(runNamedObjectParamsForSubject({ decisionStreamPath: stream, subjectRoot })).toBe(0);
    const text = readFileSync(stream, "utf8");
    expect(text).toContain('"path":"src/a.ts"');
    expect(text).not.toContain(subjectRoot);
    expect(text).not.toContain('"path":"/');
  });

  it("checks coverage against the SUBJECT's git, and writes no stream when it fails", () => {
    // `src/ignored.ts` is in the subject's lint `include` but ignored by its git, so the Program loads a file
    // the listing does not report: the subject run refuses exactly as the gate run would over this checkout.
    const subjectRoot = subjectRepo({
      extra: { ".gitignore": "src/ignored.ts\n", "src/ignored.ts": "export const ignored = 1;\n" },
    });
    const stream = join(scratch({ label: "stream" }), "decisions.jsonl");
    // An earlier run's truncated file sits at the path, so "no stream" proves the failed run removed it.
    writeFileSync(stream, '{"column":1');
    expect(existsSync(stream)).toBe(true);
    expect(runNamedObjectParamsForSubject({ decisionStreamPath: stream, subjectRoot })).toBe(1);
    expect(existsSync(stream)).toBe(false);
  });

  it("keeps the whole stream when the rule refuses findings over types that compile", () => {
    const subjectRoot = subjectRepo({
      extra: { "src/bad.ts": "export function bad(a: string, b: string): void {}\n" },
    });
    const stream = join(scratch({ label: "stream" }), "decisions.jsonl");
    expect(runNamedObjectParamsForSubject({ decisionStreamPath: stream, subjectRoot })).toBe(1);
    expect(readFileSync(stream, "utf8")).toContain(
      '"decision":"violation-arity","kind":"signature","line":1,"name":"bad"',
    );
  });

  it("discards the stream when the violating file's types do not compile", () => {
    // The semantic pass runs only on the violation path, AFTER the stream is written.
    const bad = 'export function bad(a: string, b: string): void { const n: number = "x"; void n; }\n';
    const subjectRoot = subjectRepo({ extra: { "src/bad.ts": bad } });
    const stream = join(scratch({ label: "stream" }), "decisions.jsonl");
    expect(runNamedObjectParamsForSubject({ decisionStreamPath: stream, subjectRoot })).toBe(1);
    expect(existsSync(stream)).toBe(false);
  });

  it("refuses a stream path inside the subject", () => {
    const subjectRoot = subjectRepo({});
    const inside = join(subjectRoot, "decisions.jsonl");
    expect(runNamedObjectParamsForSubject({ decisionStreamPath: inside, subjectRoot })).toBe(1);
    expect(existsSync(inside)).toBe(false);
  });

  it("removes an earlier stream when the named subject is not a git checkout at all", () => {
    // The git failure returned before the clear, so an earlier stream outlived it.
    const subjectRoot = scratch({ label: "not-git" });
    const stream = join(scratch({ label: "stream" }), "decisions.jsonl");
    writeFileSync(stream, EXPECTED_STREAM);
    expect(runNamedObjectParamsForSubject({ decisionStreamPath: stream, subjectRoot })).toBe(1);
    expect(existsSync(stream)).toBe(false);
  });

  it("leaves a file inside the named directory alone when that directory is not a git checkout", () => {
    const subjectRoot = scratch({ label: "not-git" });
    const inside = join(subjectRoot, "decisions.jsonl");
    writeFileSync(inside, "a file of the directory's own\n");
    expect(runNamedObjectParamsForSubject({ decisionStreamPath: inside, subjectRoot })).toBe(1);
    expect(readFileSync(inside, "utf8")).toBe("a file of the directory's own\n");
  });
});

describe("clearDecisionStream", () => {
  it("removes the file at the path when no subject was named", () => {
    const stream = join(scratch({ label: "stream" }), "decisions.jsonl");
    writeFileSync(stream, EXPECTED_STREAM);
    const lines: string[] = [];
    expect(clearDecisionStream({ decisionStreamPath: stream, write: (text) => lines.push(text) })).toBe(true);
    expect(existsSync(stream)).toBe(false);
    expect(lines).toEqual([]);
  });

  it("refuses, and removes nothing, when a directory stands at the path", () => {
    const stream = scratch({ label: "a-directory" });
    const lines: string[] = [];
    expect(clearDecisionStream({ decisionStreamPath: stream, write: (text) => lines.push(text) })).toBe(false);
    expect(existsSync(stream)).toBe(true);
    expect(lines).toEqual([`named-object-params: the decision stream ${stream} could not be cleared\n`]);
  });
});

describe("isInsideSubject", () => {
  it("is true for the root itself and anything under it", () => {
    expect(isInsideSubject({ path: "/x/subject", root: "/x/subject" })).toBe(true);
    expect(isInsideSubject({ path: "/x/subject/out/a.jsonl", root: "/x/subject" })).toBe(true);
  });

  it("is false for a sibling, a parent and a name that merely shares the root's prefix", () => {
    expect(isInsideSubject({ path: "/x/other/a.jsonl", root: "/x/subject" })).toBe(false);
    expect(isInsideSubject({ path: "/x/a.jsonl", root: "/x/subject" })).toBe(false);
    expect(isInsideSubject({ path: "/x/subject-streams/a.jsonl", root: "/x/subject" })).toBe(false);
  });
});
