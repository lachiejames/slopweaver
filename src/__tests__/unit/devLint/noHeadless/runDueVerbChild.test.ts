/**
 * `automation run-due`'s verb child is the ONE async spawn `no-headless` passes under `src/`, by its exact call shape
 * in its one file. Every mutation that could aim it at a model, and the same call anywhere else, still refuses.
 */
import { describe, expect, it } from "vitest";

import { scanNoHeadless } from "../../../../devLint/noHeadless.js";

/** The one file the shape is recognized in. */
const PATH = "src/cli/commands/automation/runDueVerbProcess.ts";

/** The real import line, a type-only member beside the one async member it uses. */
const IMPORT = 'import { type ChildProcess, spawn } from "node:child_process";\n';

/** The recognized call, wrapped as prettier wraps it. */
const CALL =
  "const child = spawn(process.execPath, verbChildArgv({ argv, launch }), {\n  detached: launch.leadsGroup,\n  env,\n" +
  '  stdio: ["ignore", "pipe", "pipe"],\n});\n';

/** Each finding as `[kind, line]`. */
function kindsAt({ content, path }: { content: string; path: string }): (string | number)[][] {
  return scanNoHeadless({ content, path }).map((hit) => [hit.kind, hit.line]);
}

describe("no-headless — run-due's verb child", () => {
  it("passes the recognized spawn in its own file", () => {
    expect(kindsAt({ content: `${IMPORT}${CALL}`, path: PATH })).toEqual([]);
  });

  it("refuses the same call in any other src/ file", () => {
    expect(kindsAt({ content: `${IMPORT}${CALL}`, path: "src/cli/commands/automation/rowRunners.ts" })).toEqual([
      ["NH001", 1],
      ["NH002", 2],
    ]);
  });

  it("refuses the file's spawn once its executable is claude, a parameter or another binary", () => {
    const mutations = [
      CALL.replace("process.execPath", '"claude"'),
      CALL.replace("process.execPath", "launch.executable"),
      CALL.replace("process.execPath", '"/usr/bin/env"'),
      CALL.replace("verbChildArgv({ argv, launch })", '["-p", prompt]'),
    ];
    expect(mutations.every((mutated) => mutated !== CALL)).toBe(true);
    expect(mutations.map((call) => kindsAt({ content: `${IMPORT}${call}`, path: PATH }))).toEqual(
      mutations.map(() => [
        ["NH001", 1],
        ["NH008", 2],
      ]),
    );
  });

  it("refuses a second, unrecognized spawn beside the recognized one", () => {
    const content = `${IMPORT}${CALL}spawn("codex", ["exec", prompt]);\n`;
    expect(kindsAt({ content, path: PATH })).toEqual([
      ["NH001", 1],
      ["NH008", 7],
    ]);
  });
});
