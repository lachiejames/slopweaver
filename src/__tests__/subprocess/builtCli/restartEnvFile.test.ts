/**
 * Why a restart EMPTIES the console marker instead of deleting it, measured on the real Node binary: an
 * `--env-file` naming the marker, carried in the execArgv a restart keeps, fills in a variable the environment lacks
 * but leaves one the environment carries alone — even an empty one. So a deleted marker comes back from the file and a
 * restarted image could start a second console wait; an emptied one stays closed.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { CONSOLE_CHILD_ENV } from "../../../builtCli/consoleRebuildWait.js";
import { restartEnv } from "../../../builtCli/restart.js";

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length > 0) {
    rmSync(dirs.pop()!, { force: true, recursive: true });
  }
});

/**
 * What a Node started with `--env-file` naming the marker sees for it, under the environment given.
 *
 * @param env the environment the Node is started under
 * @returns the marker's value as that Node reads it, JSON-encoded so an absent one is distinguishable
 */
function markerSeenUnderEnvFile({ env }: { env: NodeJS.ProcessEnv }): string {
  const dir = mkdtempSync(join(tmpdir(), "restart-env-file-"));
  dirs.push(dir);
  const envFile = join(dir, "console.env");
  const script = join(dir, "print.mjs");
  writeFileSync(envFile, `${CONSOLE_CHILD_ENV}=1\n`);
  // An absent marker drops out of the object, so `{}` and `{"marker":""}` stay distinguishable.
  writeFileSync(script, `process.stdout.write(JSON.stringify({ marker: process.env.${CONSOLE_CHILD_ENV} }));\n`);
  const run = spawnSync(process.execPath, [`--env-file=${envFile}`, script], { encoding: "utf8", env });
  return run.stdout;
}

describe("a restart's environment under a preserved --env-file", () => {
  it("lets the env file restore a DELETED marker — the shape a restart must not take", () => {
    const deleted: NodeJS.ProcessEnv = { ...process.env };
    delete deleted[CONSOLE_CHILD_ENV];

    expect(markerSeenUnderEnvFile({ env: deleted })).toBe('{"marker":"1"}');
  });

  it("keeps the marker restartEnv hands over closed, whatever the env file says", () => {
    const env = restartEnv({ env: { ...process.env, [CONSOLE_CHILD_ENV]: "1" } });

    expect(markerSeenUnderEnvFile({ env })).toBe('{"marker":""}');
  });
});
