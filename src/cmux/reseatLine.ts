/**
 * The exact line `cmux reseat` types into a workspace whose `claude` it has just stopped — a pure composer, no
 * cmux client and no I/O.
 *
 * It is `./bootLine.ts`'s Claude line with the session name dropped and `--resume <id>` appended: the same
 * visible `claude`, booted on the same routed credential, in the same surface it was running in, picking its
 * own conversation back up. `src/devLint/noHeadless.ts` recognises the returned template by EXACT source text,
 * so the two move in one commit or the gate stops recognising this repo's own relaunch.
 *
 * No `--name`: a resumed session keeps the name it already had, and a relaunched worker has no plan to read
 * one from.
 *
 * ## A FRESH relaunch, and why it exists
 *
 * Claude Code writes a session's transcript only on its first submitted prompt, so a seat booted and never
 * prompted is registered with an id that has nothing to resume. MEASURED: `fleet resume` typed
 * `--resume 68f60302-…` into such a tab, Claude printed `No conversation found with session ID: 68f60302-…` and
 * exited to zsh. A `fresh` launch is the same line with no `--resume`; the cmux wrapper then injects a new
 * `--session-id` of its own. It is its own returned literal so the no-headless gate recognises it by shape.
 */
import { shellCommandLine } from "#lib/shellCommandLine.js";

import { bootEnvPrefix } from "../claude/seatPinning.js";

/** Whether the relaunch resumes the session it stopped, or boots a fresh one because there is nothing to resume. */
export type ReseatLaunch = { readonly kind: "resume"; readonly sessionId: string } | { readonly kind: "fresh" };

/** What one relaunch line is built from, every piece already decided by the planner. */
export interface ReseatLineInput {
  /** `NX_DAEMON=false ` in a fleet worktree, else empty (`./fleetEnv.ts`). */
  readonly envPrefix: string;
  /** The unbound or plan store the seat boots against, when routing chose one. */
  readonly storeDir: string | undefined;
  /** The plan's setup-token file, opened on the descriptor, when the plan holds one. */
  readonly tokenPath: string | undefined;
  readonly pluginDir: string | undefined;
  readonly model: string;
  readonly effort: string | undefined;
  /** `./launchTemplate.ts`'s suffix for the seat's role, with its leading space, or `""`. */
  readonly templateSuffix: string;
  /** Resume (a session id already checked to be a UUID — it is interpolated unquoted), or boot fresh. */
  readonly launch: ReseatLaunch;
}

/**
 * The relaunch line for one seat.
 *
 * Every value that came from a process listing or a flag is quoted with `shellCommandLine`, so a plugin dir
 * with a space or a model alias with zsh glob characters (`opus[1m]`) still reaches `claude` as one token.
 *
 * @param input the decided pieces
 * @returns the exact line to send
 */
export function reseatLine({ input }: { input: ReseatLineInput }): string {
  const credentialPrefix = bootEnvPrefix({
    ...(input.storeDir === undefined ? {} : { storeDir: input.storeDir }),
    ...(input.tokenPath === undefined ? {} : { tokenPath: input.tokenPath }),
  });
  const storePrefix = `${input.envPrefix}${credentialPrefix}`;
  const pluginDirSuffix =
    input.pluginDir === undefined ? "" : ` ${shellCommandLine({ command: ["--plugin-dir", input.pluginDir] })}`;
  const modelSuffix = ` ${shellCommandLine({ command: ["--model", input.model] })}`;
  const effortSuffix =
    input.effort === undefined ? "" : ` ${shellCommandLine({ command: ["--effort", input.effort] })}`;
  const templateSuffix = input.templateSuffix;
  if (input.launch.kind === "fresh") {
    return `${storePrefix}claude${pluginDirSuffix}${modelSuffix}${effortSuffix}${templateSuffix}`;
  }
  const sessionId = input.launch.sessionId;
  return `${storePrefix}claude${pluginDirSuffix}${modelSuffix}${effortSuffix}${templateSuffix} --resume ${sessionId}`;
}
