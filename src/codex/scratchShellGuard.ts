/**
 * The scratch-shell guard on every `pass`-posture Codex thread: refuse to start one whose shell would not see
 * `TMPDIR` and `TMPPREFIX` pointing inside its own scratch, read inside the sandbox with every override the
 * thread carries (`./electronProbe.ts`'s `runSandboxedPassShell`).
 *
 * Why the two variables move is `./passWorkspace.ts`: the temp folder is closed to a pass's writes, so its shell
 * temp lives in `<scratch>/.tmp`. Why it is PROVED rather than assumed is the same reason as `./electronGuard.ts`:
 * Codex applies a home's `shell_environment_policy.include_only` after the pass's `set`, so a home that declares
 * one drops both without a word.
 *
 * **What a dropped value costs is the pass's shell, never the boundary.** With `TMPDIR` gone, `mktemp` and a zsh
 * heredoc reach for `/tmp`, which the sandbox refuses, so the pass runs with a broken shell rather than writing
 * outside its scratch. That is why the hatch row exists at all, and why opening it is a judgement about a
 * degraded pass rather than a widened one. A `sealed` thread is never asked: its sandbox is read-only, so there is
 * no temp to move. **A value that could not be read REFUSES**: an unread environment is not a checked one.
 */

import { hatchFor } from "../hatch/lookup.js";
import { hatchRefusal } from "../hatch/render.js";
import { err, ok, type Result } from "../lib/result.js";
import { type CodexElectronProbeError, CodexElectronProbeErrors, runSandboxedPassShell } from "./electronProbe.js";
import { passTempEnvironment } from "./passWorkspace.js";
import type { CodexCli } from "./vendoredCli.js";

/** The override for this guard, named once so the read and the notice cannot disagree. */
const ALLOW_CODEX_SCRATCH_SHELL_GUARD_ENV = "SLOPWEAVER_ALLOW_CODEX_SCRATCH_SHELL_GUARD";

/** The two variables the guard reads, in the order it names them. */
const TEMP_VARIABLES = ["TMPDIR", "TMPPREFIX"] as const;

/** What a sandboxed shell saw for each temp variable; absent when unset. */
export type ScratchShellReading = Readonly<Partial<Record<(typeof TEMP_VARIABLES)[number], string>>>;

/** What the guard decided, and the one line to print for it, if any. */
export type CodexScratchShellGuardDecision =
  | { readonly kind: "proceed"; readonly notice: string | undefined }
  | { readonly kind: "refuse"; readonly refusal: string };

/**
 * Turn one sandboxed `/usr/bin/env -0` run into the two temp variables it printed — pure, so every arm is a unit
 * test. `env` exits 0 whatever is set, so anything else is the sandbox failing. Entries are split on NUL, never
 * on a newline: a value may carry a newline, so an inherited `X="a\nTMPDIR=<scratch>/.tmp"` would otherwise
 * forge the very line the guard checks while the real `TMPDIR` was dropped, and no value can carry a NUL.
 *
 * @param run what the sandboxed `env -0` printed and how it ended
 * @returns each temp variable's value, absent when unset, or why the run could not be read
 */
export function readEnvRun({
  run,
}: {
  run: { status: number | null; stdout: string; stderr: string; failure: string | undefined };
}): Result<ScratchShellReading, CodexElectronProbeError> {
  if (run.failure !== undefined) {
    return err(CodexElectronProbeErrors.sandboxNotStarted({ failure: run.failure }));
  }
  if (run.status !== 0) {
    return err(CodexElectronProbeErrors.sandboxFailed({ status: run.status, stderr: run.stderr }));
  }
  const reading: Partial<Record<(typeof TEMP_VARIABLES)[number], string>> = {};
  for (const entry of run.stdout.split("\0")) {
    for (const name of TEMP_VARIABLES) {
      if (entry.startsWith(`${name}=`)) {
        reading[name] = entry.slice(name.length + 1);
      }
    }
  }
  return ok(reading);
}

/**
 * Decide the guard from what the sandboxed shell saw — pure, so every arm is a unit test.
 *
 * @param reading the two variables as the shell saw them, or why the read failed
 * @param workingDirectory the thread's scratch, whose `.tmp` both must point into
 * @param hatchOpen whether `SLOPWEAVER_ALLOW_CODEX_SCRATCH_SHELL_GUARD=1` was set
 * @param codexHome the home the pass runs on, named in what is printed; undefined is the ambient one
 * @returns proceed (with a notice when the hatch let a finding through), or the four-line refusal
 */
export function codexScratchShellGuardDecision({
  reading,
  workingDirectory,
  hatchOpen,
  codexHome,
}: {
  reading: Result<ScratchShellReading, CodexElectronProbeError>;
  workingDirectory: string;
  hatchOpen: boolean;
  codexHome: string | undefined;
}): CodexScratchShellGuardDecision {
  const expected = passTempEnvironment({ workingDirectory });
  if (reading.isOk() && TEMP_VARIABLES.every((name) => reading.value[name] === expected[name])) {
    return { kind: "proceed", notice: undefined };
  }
  let home = "the ambient Codex home";
  if (codexHome !== undefined) {
    home = codexHome;
  }
  let detail: string;
  if (reading.isErr()) {
    detail = `the shell environment a pass on ${home} would run could not be read (${reading.error.message}), and an unread environment is not a checked one`;
  } else {
    const seen = TEMP_VARIABLES.map((name) => `${name}=${JSON.stringify(reading.value[name])}`).join(", ");
    detail = `a shell a pass on ${home} runs would see ${seen}, not ${JSON.stringify(expected.TMPDIR)} and ${JSON.stringify(expected.TMPPREFIX)}; most likely that home's config.toml declares a shell_environment_policy.include_only that omits them, so add TMPDIR and TMPPREFIX to that list`;
  }
  if (hatchOpen) {
    return {
      kind: "proceed",
      notice: `codex pass: Codex scratch-shell guard OVERRIDDEN by ${ALLOW_CODEX_SCRATCH_SHELL_GUARD_ENV}=1 — ${detail}`,
    };
  }
  return { kind: "refuse", refusal: hatchRefusal({ detail, hatch: hatchFor({ id: "codex-scratch-shell-guard" }) }) };
}

/**
 * The two temp variables a `pass`-posture thread's shell on this home would see, after every override it carries.
 *
 * @param codexHome the pass's routed home, or undefined for the ambient one
 * @param cwd the thread's scratch
 * @param cli the Codex binary the pass runs, and the directories it puts in front of PATH
 * @returns each value, absent when unset, or why it could not be read
 */
function probeCodexScratchShell({
  codexHome,
  cwd,
  cli,
}: {
  codexHome: string | undefined;
  cwd: string;
  cli: CodexCli;
}): Result<ScratchShellReading, CodexElectronProbeError> {
  return readEnvRun({
    run: runSandboxedPassShell({ cli, codexHome, command: ["/usr/bin/env", "-0"], cwd, posture: "pass" }),
  });
}

/**
 * Probe the shell environment and decide the guard — the production half a pass's thread gate wires in.
 *
 * @param codexHome the home the pass runs on, or undefined for the ambient one
 * @param cwd the thread's scratch, whose trusted project config Codex layers over the home's
 * @param cli the Codex binary the pass itself runs, and its PATH directories
 * @param probe the reading seam; production runs `<cli> sandbox -- /usr/bin/env -0` with the thread's launch
 * @param env the environment the hatch is read from
 * @returns the decision
 */
export function applyCodexScratchShellGuard({
  codexHome,
  cwd,
  cli,
  probe = probeCodexScratchShell,
  env = process.env,
}: {
  codexHome: string | undefined;
  cwd: string;
  cli: CodexCli;
  probe?: (args: {
    codexHome: string | undefined;
    cwd: string;
    cli: CodexCli;
  }) => Result<ScratchShellReading, CodexElectronProbeError>;
  env?: NodeJS.ProcessEnv;
}): CodexScratchShellGuardDecision {
  const hatchOpen = env[ALLOW_CODEX_SCRATCH_SHELL_GUARD_ENV] === "1";
  return codexScratchShellGuardDecision({
    codexHome,
    hatchOpen,
    reading: probe({ cli, codexHome, cwd }),
    workingDirectory: cwd,
  });
}
