/**
 * The Electron guard on every `codex plan` / `codex review` pass thread: refuse to start one whose shell would not
 * see `ELECTRON_RUN_AS_NODE=1`, read inside the sandbox with every override the pass carries (`./electronProbe.ts`).
 *
 * Why the variable matters is `./electronSurface.ts`. Why it is PROVED rather than assumed: Codex applies a home's
 * `shell_environment_policy.include_only` after the pass's `set`, so a home that declares one drops the variable
 * without a word. Wired beside the browser door in `./browserDoor.ts`'s
 * `codexThreadAdmit`, so it is asked per thread in the working directory the pass minted. A visible seat does not
 * ask it: the owner watches a seat, and one may legitimately run the desktop app.
 *
 * **A value that could not be read REFUSES**, as the browser door does: an unread environment is not a guarded one.
 */

import { hatchFor } from "../hatch/lookup.js";
import { hatchRefusal } from "../hatch/render.js";
import type { Result } from "../lib/result.js";
import type { CodexThreadPosture } from "./client.js";
import { type CodexElectronProbeError, probeCodexElectronRunAsNode } from "./electronProbe.js";
import type { CodexCli } from "./vendoredCli.js";

/** The override for this guard, named once so the read and the notice cannot disagree. */
const ALLOW_CODEX_ELECTRON_GUARD_ENV = "SLOPWEAVER_ALLOW_CODEX_ELECTRON_GUARD";

/** What the guard decided, and the one line to print for it, if any. */
export type CodexElectronGuardDecision =
  | { readonly kind: "proceed"; readonly notice: string | undefined }
  | { readonly kind: "refuse"; readonly refusal: string };

/**
 * Decide the guard from what the sandboxed shell saw — pure, so every arm is a unit test.
 *
 * @param printed the variable's value in a shell the thread would run, `""` when unset, or why the read failed
 * @param hatchOpen whether `SLOPWEAVER_ALLOW_CODEX_ELECTRON_GUARD=1` was set
 * @param codexHome the home the pass runs on, named in what is printed; undefined is the ambient one
 * @returns proceed (with a notice when the hatch let a finding through), or the four-line refusal
 */
export function codexElectronGuardDecision({
  printed,
  hatchOpen,
  codexHome,
}: {
  printed: Result<string, CodexElectronProbeError>;
  hatchOpen: boolean;
  codexHome: string | undefined;
}): CodexElectronGuardDecision {
  if (printed.isOk() && printed.value === "1") {
    return { kind: "proceed", notice: undefined };
  }
  let home = "the ambient Codex home";
  if (codexHome !== undefined) {
    home = codexHome;
  }
  const detail = printed.isErr()
    ? `the shell environment a pass on ${home} would run could not be read (${printed.error.message}), and an unread environment is not a guarded one`
    : `a shell a pass on ${home} runs would see ELECTRON_RUN_AS_NODE=${JSON.stringify(printed.value)}, not "1"; most likely that home's config.toml declares a shell_environment_policy.include_only that omits it, so add ELECTRON_RUN_AS_NODE to that list`;
  if (hatchOpen) {
    return {
      kind: "proceed",
      notice: `codex pass: Codex Electron guard OVERRIDDEN by ${ALLOW_CODEX_ELECTRON_GUARD_ENV}=1 — ${detail}`,
    };
  }
  return { kind: "refuse", refusal: hatchRefusal({ detail, hatch: hatchFor({ id: "codex-electron-guard" }) }) };
}

/**
 * Probe the shell environment and decide the guard — the production half a pass's thread gate wires in.
 *
 * @param codexHome the home the pass runs on, or undefined for the ambient one
 * @param cwd the directory the thread runs in, whose trusted project config Codex layers over the home's
 * @param cli the Codex binary the pass itself runs, and its PATH directories
 * @param posture which locked policy the thread carries, so the probe launches as the thread does
 * @param probe the reading seam; production runs `<cli> sandbox -- /usr/bin/printenv` with the pass's overrides
 * @param env the environment the hatch is read from
 * @returns the decision
 */
export function applyCodexElectronGuard({
  codexHome,
  cwd,
  cli,
  posture,
  probe = probeCodexElectronRunAsNode,
  env = process.env,
}: {
  codexHome: string | undefined;
  cwd: string;
  cli: CodexCli;
  posture: CodexThreadPosture;
  probe?: (args: {
    codexHome: string | undefined;
    cwd: string;
    cli: CodexCli;
    posture: CodexThreadPosture;
  }) => Result<string, CodexElectronProbeError>;
  env?: NodeJS.ProcessEnv;
}): CodexElectronGuardDecision {
  const hatchOpen = env[ALLOW_CODEX_ELECTRON_GUARD_ENV] === "1";
  return codexElectronGuardDecision({ codexHome, hatchOpen, printed: probe({ cli, codexHome, cwd, posture }) });
}
