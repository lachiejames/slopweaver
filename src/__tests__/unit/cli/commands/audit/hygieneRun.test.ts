/**
 * The `audit hygiene` shell: the parse, and the exit code that IS the gate's contract.
 *
 * Every case here runs against a home with no corpus at all, which is deliberate: what is under test is
 * the dispatch and the verdict, and {@link ../../../../hygiene/corpusScan} already owns the classification
 * against a synthetic bronze tree.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { auditArgsErrorLines } from "../../../../../cli/commands/audit/errors.js";
import { parseAuditHygieneArgs, runAuditHygiene } from "../../../../../cli/commands/audit/hygieneRun.js";
import { EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

const EMPTY_HOME = mkdtempSync(join(tmpdir(), "slopweaver-audit-hygiene-"));

afterAll(() => {
  rmSync(EMPTY_HOME, { force: true, recursive: true });
});

/** Run the shell, capturing both lanes. */
function run({ rest }: { rest: readonly string[] }): { code: number; out: string[]; diagnostics: string[] } {
  const out: string[] = [];
  const diagnostics: string[] = [];
  const code = runAuditHygiene({
    rest,
    writeDiagnostic: (line) => diagnostics.push(line),
    writeOut: (line) => out.push(line),
  });
  return { code, diagnostics, out };
}

describe("parseAuditHygieneArgs", () => {
  it("defaults to every source", () => {
    expect(unwrap(parseAuditHygieneArgs({ rest: [] })).source).toBe(undefined);
  });

  it("accepts a real corpus source", () => {
    expect(unwrap(parseAuditHygieneArgs({ rest: ["--source", "gmail"] })).source).toBe("gmail");
  });

  it("refuses a source that is not in the union, naming every one that is", () => {
    const refusal = unwrapErr(parseAuditHygieneArgs({ rest: ["--source", "email"] }));
    expect(refusal.code).toBe("SOURCE_UNKNOWN");
    const problems = auditArgsErrorLines({ error: refusal });
    expect(problems[0]).toContain("unrecognised source: email");
    expect(problems[0]).toContain("gmail");
    expect(problems.at(-1)).toContain("usage: slopweaver audit hygiene");
  });
});

describe("runAuditHygiene", () => {
  it("reports a clean scan and exits zero on a home with no corpus", () => {
    const result = run({ rest: ["--home", EMPTY_HOME, "--source", "gmail"] });

    expect(result.code).toBe(EXIT_OK);
    expect(result.diagnostics.join("\n")).toContain("secrets: none");
  });

  it("puts the human report on the DIAGNOSTIC lane, leaving stdout clean for a pipe", () => {
    const result = run({ rest: ["--home", EMPTY_HOME] });

    expect(result.out).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("emits the whole scan as one document under --json, on stdout", () => {
    const result = run({ rest: ["--home", EMPTY_HOME, "--json"] });
    const parsed: unknown = JSON.parse(result.out[0]!);

    expect(result.out.length).toBe(1);
    expect(parsed).toEqual({
      denylistLoaded: false,
      denylistWords: 0,
      filesScanned: 0,
      identifiers: { byLabel: {}, sample: [], total: 0 },
      leaks: [],
      linesScanned: 0,
      protectedSkipped: [],
      unreadable: [],
    });
  });

  it("refuses a bad flag before it reads anything", () => {
    const result = run({ rest: ["--source", "email"] });

    expect(result.code).toBe(EXIT_USAGE);
    expect(result.out).toEqual([]);
  });
});
