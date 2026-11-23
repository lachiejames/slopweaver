import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { entryLifecycleViolations } from "../../../devLint/gateEntryLifecycle.js";

const PATH = "src/devLint/probe.entry.ts";

/** The clauses a source breaks, judged as the planted entry. */
function violations({ lines }: { lines: readonly string[] }): readonly string[] {
  return entryLifecycleViolations({ path: PATH, text: lines.join("\n") });
}

/** The one wrapper call, with `body` run inside `run` — where an entry's work belongs. */
function wrapperRunning({ body }: { body: string }): string {
  return `await runGateEntry({ run: async () => { ${body} return 0; } });`;
}

const IMPORT = 'import { runGateEntry } from "./gateEntry.js";';
const RUN_IMPORT = 'import { runProbe } from "./probeRun.js";';
const NOT_IMPORTED = `${PATH}: does not import runGateEntry from ./gateEntry.js exactly once`;
const NOT_ONE_CALL = `${PATH}: is not exactly one top-level \`await runGateEntry({ run })\``;
const STRAY_ONCE = `${PATH}: runs code at its top level outside the wrapper (1 statement(s))`;
const ENDS_ONCE = `${PATH}: could end the process outside the wrapper (1 site(s))`;

describe("entryLifecycleViolations", () => {
  it("accepts the canonical entry, and a zero-argument closure as run", () => {
    expect(violations({ lines: [IMPORT, RUN_IMPORT, "await runGateEntry({ run: runProbe });"] })).toEqual([]);
    expect(
      violations({
        lines: [IMPORT, RUN_IMPORT, "await runGateEntry({ run: () => runProbe({ argv: process.argv }) });"],
      }),
    ).toEqual([]);
  });

  it("refuses a direct process.exit at the top level as both stray code and an ending site", () => {
    expect(
      violations({ lines: [IMPORT, RUN_IMPORT, "await runGateEntry({ run: runProbe });", "process.exit(0);"] }),
    ).toEqual([STRAY_ONCE, ENDS_ONCE]);
  });

  it("refuses a top-level throw before the wrapper, which ends the process before any close", () => {
    expect(
      violations({
        lines: [IMPORT, RUN_IMPORT, 'throw new Error("stop before close");', "await runGateEntry({ run: runProbe });"],
      }),
    ).toEqual([STRAY_ONCE]);
  });

  it.each([
    ["process.exit(1);", "process.exit itself"],
    ['process["exit"](1);', "a string-keyed element access"],
    ["const key = 'exit'; process[key](1);", "a computed element access"],
    ["const end = process.exit; end(1);", "an alias that never calls through process"],
    ["const { exit } = process; exit(1);", "a destructure"],
    ["const { exit: end } = process; end(1);", "a renamed destructure"],
    ["globalThis.process.exit(1);", "globalThis.process"],
    ["global.process.exit(1);", "Node's global alias"],
    ["const g = global; g.process.exit(1);", "Node's global bound to another name"],
    ["process.abort();", "abort"],
    ["process.kill(1);", "kill"],
    ["process.reallyExit(1);", "reallyExit"],
    ["const p = process.valueOf(); p.exit(1);", "a member that hands process back"],
    ["process.mainModule.require(name).exit(1);", "a member outside the allowlist"],
    ["const p = process; p.exit(1);", "process bound to another name"],
    ["const end = (target) => target.exit(1); end(process);", "process passed as a value"],
    ["const g = globalThis; g.process.exit(1);", "globalThis bound to another name"],
    ['const loaded = await import("node:process"); loaded.default.exit(1);', "a dynamic import of node:process"],
    ['const load = createRequire(import.meta.url); load("node:process").exit(17);', "a createRequire load"],
    ['require("process").exit(1);', "a require"],
    ['loader.getBuiltinModule("node:process").exit(1);', "getBuiltinModule reached without naming process"],
    ["const name = `node:process`; load(name).exit(1);", "the module name bound first, as a template"],
  ])("refuses %s inside run (%s)", (body) => {
    expect(violations({ lines: [IMPORT, RUN_IMPORT, wrapperRunning({ body })] })).toEqual([ENDS_ONCE]);
  });

  it.each([
    ['import proc from "node:process";', "a default import"],
    ['import * as proc from "node:process";', "a namespace import"],
    ['import { argv } from "process";', "a named import of a member that ends nothing"],
    ['import { exit } from "node:process";', "exit imported by name"],
    ['import { exit as end } from "process";', "exit imported under another name"],
  ])("refuses %s of the process module, whatever it binds (%s)", (line) => {
    expect(violations({ lines: [IMPORT, line, RUN_IMPORT, wrapperRunning({ body: "proc.exit(7);" })] })).toEqual([
      ENDS_ONCE,
    ]);
  });

  it("accepts the allowlisted process members", () => {
    expect(
      violations({
        lines: [
          IMPORT,
          RUN_IMPORT,
          'await runGateEntry({ run: () => runProbe({ argv: process.argv, cwd: process.cwd(), home: process.env["HOME"] }) });',
        ],
      }),
    ).toEqual([]);
  });

  it("reads process as a member NAME or a property key as no reference at all", () => {
    expect(
      violations({
        lines: [
          IMPORT,
          RUN_IMPORT,
          wrapperRunning({
            body: 'const report = { process: 1, "node:process": 2 }; runProbe({ owner: report.process });',
          }),
        ],
      }),
    ).toEqual([]);
  });

  it("refuses the old shape, which neither imports nor calls the wrapper", () => {
    expect(violations({ lines: [RUN_IMPORT, "process.exit(runProbe());"] })).toEqual([
      NOT_IMPORTED,
      NOT_ONE_CALL,
      STRAY_ONCE,
      ENDS_ONCE,
    ]);
  });

  it.each([
    ['import { type runGateEntry } from "./gateEntry.js";', "a type-only specifier, erased at run time"],
    ['import type { runGateEntry } from "./gateEntry.js";', "a type-only clause, erased at run time"],
    ['import { closeAll as runGateEntry } from "./gateEntry.js";', "another export bound to the wrapper's name"],
  ])("refuses %s as the wrapper's import (%s)", (line) => {
    expect(violations({ lines: [line, RUN_IMPORT, "await runGateEntry({ run: runProbe });"] })).toEqual([NOT_IMPORTED]);
  });

  it("refuses the wrapper imported from another module", () => {
    expect(
      violations({
        lines: [
          'import { runGateEntry } from "../gateEntry.js";',
          RUN_IMPORT,
          "await runGateEntry({ run: runProbe });",
        ],
      }),
    ).toEqual([NOT_IMPORTED]);
  });

  it("refuses a wrapper call nested inside a function rather than at the top level", () => {
    expect(
      violations({
        lines: [IMPORT, RUN_IMPORT, "async function go() {", "  await runGateEntry({ run: runProbe });", "}"],
      }),
    ).toEqual([NOT_ONE_CALL, STRAY_ONCE]);
  });

  it("refuses a wrapper that is not awaited", () => {
    expect(violations({ lines: [IMPORT, RUN_IMPORT, "void runGateEntry({ run: runProbe });"] })).toEqual([
      NOT_ONE_CALL,
      STRAY_ONCE,
    ]);
  });

  it("refuses zero wrapper calls and two", () => {
    expect(violations({ lines: [IMPORT, RUN_IMPORT] })).toEqual([NOT_ONE_CALL]);
    expect(
      violations({
        lines: [IMPORT, RUN_IMPORT, "await runGateEntry({ run: runProbe });", "await runGateEntry({ run: runProbe });"],
      }),
    ).toEqual([NOT_ONE_CALL]);
  });

  it("refuses an argument that does not name run", () => {
    expect(violations({ lines: [IMPORT, RUN_IMPORT, "await runGateEntry({ go: runProbe });"] })).toEqual([
      NOT_ONE_CALL,
      STRAY_ONCE,
    ]);
  });

  it.each([
    ["await runGateEntry({ run: buildRun() });", "run computed by a call the wrapper never wraps"],
    ["await runGateEntry({ run: runProbe, extra: prepare() });", "a second property"],
    ["await runGateEntry({ ...options });", "a spread"],
  ])("refuses %s, evaluated before the wrapper runs (%s)", (line) => {
    expect(violations({ lines: [IMPORT, RUN_IMPORT, line] })).toEqual([NOT_ONE_CALL, STRAY_ONCE]);
  });

  it("accepts run as a shorthand name and as a function expression", () => {
    expect(
      violations({ lines: [IMPORT, 'import { run } from "./probeRun.js";', "await runGateEntry({ run });"] }),
    ).toEqual([]);
    expect(
      violations({ lines: [IMPORT, RUN_IMPORT, "await runGateEntry({ run: function () { return runProbe(); } });"] }),
    ).toEqual([]);
  });

  it("reads process.exit in a comment or a string as no call at all", () => {
    expect(
      violations({
        lines: [
          IMPORT,
          RUN_IMPORT,
          "// process.exit(1) used to sit here",
          wrapperRunning({ body: 'const note = "process.exit(1)"; runProbe({ note });' }),
        ],
      }),
    ).toEqual([]);
  });
});

describe("every gate entry on disk runs through the wrapper", () => {
  it("finds no broken clause in any entry", () => {
    const devLint = fileURLToPath(new URL("../../../devLint/", import.meta.url));
    const entries = readdirSync(devLint).filter((name) => name.endsWith(".entry.ts"));

    expect(entries.length).toBeGreaterThan(0);
    expect(
      entries.flatMap((name) =>
        entryLifecycleViolations({ path: `src/devLint/${name}`, text: readFileSync(join(devLint, name), "utf8") }),
      ),
    ).toEqual([]);
  });
});
