import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { commandProbeFailure, commandProbeRunner } from "../../../handover/commandProbe.js";

const dirs: string[] = [];

/** A throwaway directory for one case's fixtures, removed in `afterEach`. */
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "cmdprobe-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe("commandProbeFailure", () => {
  it("reports the exit status the command chose", () => {
    expect(commandProbeFailure({ budgetMs: 30_000, error: { signal: null, status: 3 } })).toEqual({
      launchFailure: undefined,
      signal: undefined,
      status: 3,
      timedOutAfterMs: undefined,
    });
  });

  it("reports a timeout off the error code, even when the child trapped SIGTERM and chose its own status", () => {
    // The measured shape: `yarn lint` past the budget, trapping SIGTERM and exiting 143.
    expect(commandProbeFailure({ budgetMs: 30_000, error: { code: "ETIMEDOUT", signal: null, status: 143 } })).toEqual({
      launchFailure: undefined,
      signal: undefined,
      status: 143,
      timedOutAfterMs: 30_000,
    });
  });

  it("reports a timeout the child did not trap as a timeout too, keeping the signal it observed", () => {
    expect(
      commandProbeFailure({ budgetMs: 500, error: { code: "ETIMEDOUT", signal: "SIGTERM", status: null } }),
    ).toEqual({ launchFailure: undefined, signal: "SIGTERM", status: undefined, timedOutAfterMs: 500 });
  });

  it("reports the signal that killed it when the runner's budget did not", () => {
    expect(commandProbeFailure({ budgetMs: 30_000, error: { signal: "SIGTERM", status: null } })).toEqual({
      launchFailure: undefined,
      signal: "SIGTERM",
      status: undefined,
      timedOutAfterMs: undefined,
    });
  });

  it("reports a launch failure when neither a status nor a signal is present", () => {
    expect(
      commandProbeFailure({ budgetMs: 30_000, error: { message: "spawn /bin/sh ENOENT", signal: null, status: null } }),
    ).toEqual({
      launchFailure: "spawn /bin/sh ENOENT",
      signal: undefined,
      status: undefined,
      timedOutAfterMs: undefined,
    });
  });

  it("names the absence rather than inventing a status when the thrown value says nothing", () => {
    expect(commandProbeFailure({ budgetMs: 30_000, error: {} })).toEqual({
      launchFailure: "no reason reported",
      signal: undefined,
      status: undefined,
      timedOutAfterMs: undefined,
    });
  });
});

describe("commandProbeRunner", () => {
  it("reports exit 0 for a command that succeeds", () => {
    expect(commandProbeRunner({ repo: tempDir() })({ command: "true" })).toEqual({
      launchFailure: undefined,
      signal: undefined,
      status: 0,
      timedOutAfterMs: undefined,
    });
  });

  it("carries the exact non-zero status through, so a refusal can print it", () => {
    expect(commandProbeRunner({ repo: tempDir() })({ command: "exit 42" })).toEqual({
      launchFailure: undefined,
      signal: undefined,
      status: 42,
      timedOutAfterMs: undefined,
    });
  });

  it("reports a command killed by a signal as the supervisor's 128-plus status, since the shell runs supervised", () => {
    expect(commandProbeRunner({ repo: tempDir() })({ command: "kill -KILL $$" })).toEqual({
      launchFailure: undefined,
      signal: undefined,
      status: 137,
      timedOutAfterMs: undefined,
    });
  });

  it("runs the command in the repository it was scoped to", () => {
    const dir = tempDir();

    commandProbeRunner({ repo: dir })({ command: 'printf "%s" ran > here.txt' });

    expect(readFileSync(join(dir, "here.txt"), "utf8")).toBe("ran");
  });

  it("marks the child quiet, so a nested launcher's advisory cannot become a probe pipeline's first line", () => {
    const dir = tempDir();

    commandProbeRunner({ repo: dir })({ command: 'printf "%s" "${SLOPWEAVER_LAUNCHER_QUIET-unset}" > quiet.txt' });

    expect(readFileSync(join(dir, "quiet.txt"), "utf8")).toBe("1");
  });

  it("leaves the launcher's own code root alone, so a probe still tests the tree the session is on", () => {
    // Falsifiable on purpose: this process's environment CARRIES the variable, so a scrub added here — the
    // refuted first shape of the fix, `src/lib/launcherEnv.ts` — reddens this rather than passing silently.
    const dir = tempDir();
    process.env["PLUGIN_ROOT"] = "/a/worktree";

    commandProbeRunner({ repo: dir })({ command: 'printf "%s" "${PLUGIN_ROOT-unset}" > root.txt' });
    delete process.env["PLUGIN_ROOT"];

    expect(readFileSync(join(dir, "root.txt"), "utf8")).toBe("/a/worktree");
  });
});
