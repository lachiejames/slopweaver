/**
 * Read `ELECTRON_RUN_AS_NODE` as a shell a pass thread runs would see it — under the same binary, home, working
 * directory and overrides, inside Codex's own seatbelt — so `./electronGuard.ts` judges the effective environment
 * rather than the override it hoped for.
 *
 * The effectful half of `./electronSurface.ts`: one blocking `codex sandbox -- /usr/bin/printenv`, which starts no
 * model and no server. Blocking by construction, so `no-headless` NH001 has nothing to say about it. The binary is
 * the caller's to name and must be the one the pass runs (`./vendoredCli.ts`), for the reason `./browserProbe.ts`
 * gives: two builds can read one home two ways.
 */
import { spawnSync } from "node:child_process";

import { err, ok, type Result } from "#lib/result.js";

import { codexCapabilityOverrides } from "./capabilities.js";
import { codexClientEnvironment } from "./client.js";
import { type CodexCli, withCodexPathDirs } from "./vendoredCli.js";

/** How long the sandboxed read may take before the probe gives up; it is one `printenv`. */
const PROBE_TIMEOUT_MS = 15_000;

/** The sandboxed run never started: the binary is missing, say, or the spawn itself failed. */
export interface SandboxNotStartedError {
  readonly code: "SANDBOX_NOT_STARTED";
  readonly message: string;
}

/** The sandboxed run ended in a way `printenv` never does: a diagnostic, a signal, the timeout, a usage error. */
export interface SandboxFailedError {
  readonly code: "SANDBOX_FAILED";
  readonly message: string;
  readonly status: number | null;
}

/** Why the shell environment a pass would run could not be read. */
export type CodexElectronProbeError = SandboxNotStartedError | SandboxFailedError;

/** The one place a {@link CodexElectronProbeError} is built, so a test builds it the way the probe does. */
export const CodexElectronProbeErrors = {
  sandboxFailed: ({ status, stderr }: { status: number | null; stderr: string }): SandboxFailedError => ({
    code: "SANDBOX_FAILED",
    message: `codex sandbox exited ${String(status)}: ${stderr.trim()}`,
    status,
  }),
  sandboxNotStarted: ({ failure }: { failure: string }): SandboxNotStartedError => ({
    code: "SANDBOX_NOT_STARTED",
    message: `codex sandbox could not run: ${failure}`,
  }),
} as const;

/**
 * Turn one sandboxed `printenv ELECTRON_RUN_AS_NODE` run into the value it saw — pure, so every arm is a unit test.
 * `printenv` exits 1 and prints nothing for an unset variable, which is a reading (`""`), not a failure.
 *
 * @param status the exit status, null when a signal or the timeout ended it
 * @param stdout what the run printed
 * @param stderr what the run printed as diagnostics; any at all on exit 1 means the sandbox, not `printenv`, failed
 * @param failure why the run could not start, when it could not
 * @returns the variable's value (`""` when unset), or why it could not be read
 */
export function readPrintenvRun({
  status,
  stdout,
  stderr,
  failure,
}: {
  status: number | null;
  stdout: string;
  stderr: string;
  failure: string | undefined;
}): Result<string, CodexElectronProbeError> {
  if (failure !== undefined) {
    return err(CodexElectronProbeErrors.sandboxNotStarted({ failure }));
  }
  if (status === 0) {
    return ok(stdout.trim());
  }
  if (status === 1 && stdout.trim() === "" && stderr.trim() === "") {
    return ok("");
  }
  return err(CodexElectronProbeErrors.sandboxFailed({ status, stderr }));
}

/**
 * The value of `ELECTRON_RUN_AS_NODE` a pass thread's shell on this home would see, after the pass's overrides.
 *
 * @param codexHome the pass's routed home, or undefined for the ambient one
 * @param cwd the directory the thread runs in — Codex layers a trusted project's `.codex/config.toml` found from there
 * @param cli the Codex binary the pass runs, and the directories it puts in front of PATH
 * @returns the value (`""` when unset), or why it could not be read
 */
export function probeCodexElectronRunAsNode({
  codexHome,
  cwd,
  cli,
}: {
  codexHome: string | undefined;
  cwd: string;
  cli: CodexCli;
}): Result<string, CodexElectronProbeError> {
  const overrides = codexCapabilityOverrides({ runtime: "pass" }).flatMap((override) => ["-c", override]);
  const env = withCodexPathDirs({
    env: codexClientEnvironment({ codexHome, env: process.env }),
    pathDirs: cli.pathDirs,
  });
  // The directory rides the process's own cwd: `codex sandbox -C` demands `--permission-profile` beside it
  // (exit 2 on the vendored 0.157.1), and naming a profile would sandbox a shell no pass runs.
  const run = spawnSync(cli.path, ["sandbox", ...overrides, "--", "/usr/bin/printenv", "ELECTRON_RUN_AS_NODE"], {
    cwd,
    encoding: "utf8",
    env,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: PROBE_TIMEOUT_MS,
  });
  return readPrintenvRun({
    failure: run.error === undefined ? undefined : run.error.message,
    status: run.status,
    stderr: run.stderr,
    stdout: run.stdout,
  });
}
