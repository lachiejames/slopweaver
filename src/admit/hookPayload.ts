/**
 * The pure core of the PreToolUse hook: decide, from a tool-call payload, whether to block a raw-bypass
 * shell command. Lives in `src/admit/` (not the hook file) so it is unit-tested like the rest of the door;
 * `./pretooluseAdmit.ts` is the thin effectful shell that reads stdin + env and answers an exit code, run as
 * the `admit` check of the one `PreToolUse` process (`./preToolUseChecks.ts`).
 *
 * Two tools run a shell line, and both are policed: `Bash`, and `Monitor` — whose `command` is a whole
 * script the harness runs in the same shell environment as `Bash`, and which this hook never saw while
 * `hooks/hooks.json` matched `Bash` alone. Four `gh`-polling watchers in the private
 * work repository's sessions were armed through `Monitor` and none of them met the door
 * (`scriptWrapper.ts`'s header has the measurement). A `Monitor` opened on a WebSocket (`ws`) runs no
 * shell and is allowed as itself.
 */
import { isRecord } from "../lib/parsers.js";
import { classifyAdcSigninCommand } from "./adcSigninCommand.js";
import { classifyArtifactTool } from "./artifactTool.js";
import { classifyBrowserLaunchCommand } from "./browserLaunchCommand.js";
import { classifyDatadogSiteCommand } from "./datadogSiteCommand.js";
import { classifyPythonCommand } from "./pythonInvocation.js";
import { classifyRawCommand } from "./rawTools.js";

/** The hook's decision — a discriminated union so a `block` ALWAYS carries a message (no optional fallback). */
export type HookDecision = { readonly block: true; readonly message: string } | { readonly block: false };

/** The tools whose `tool_input.command` is a shell line this hook judges. */
const SHELL_TOOLS = new Set(["Bash", "Monitor"]);

/**
 * The shell line a payload asks to run, or the decision that ends evaluation before any classifier runs:
 * FAIL-CLOSED on a payload that is not an object or a shell call with no command, and an allow for any other
 * tool or a WebSocket `Monitor`, which runs no shell.
 *
 * @returns the command and its `cwd`, or the early decision
 */
function shellCallOf({
  payload,
}: {
  payload: unknown;
}):
  | { readonly command: string; readonly cwd: string | undefined; readonly payload: Record<string, unknown> }
  | HookDecision {
  if (!isRecord(payload)) {
    return {
      block: true,
      message: "pretooluse-admit: malformed PreToolUse payload (not an object) — blocking (fail closed)",
    };
  }
  const toolName = payload["tool_name"];
  if (typeof toolName !== "string" || !SHELL_TOOLS.has(toolName)) {
    return { block: false };
  }
  const input = payload["tool_input"];
  if (toolName === "Monitor" && isRecord(input) && input["command"] === undefined && isRecord(input["ws"])) {
    return { block: false }; // a WebSocket monitor runs no shell at all
  }
  if (!isRecord(input) || typeof input["command"] !== "string") {
    return {
      block: true,
      message: `pretooluse-admit: ${toolName} payload is missing tool_input.command — blocking (fail closed)`,
    };
  }
  return { command: input["command"], cwd: typeof payload["cwd"] === "string" ? payload["cwd"] : undefined, payload };
}

/**
 * The reach-grant reader bound to the payload's own session.
 *
 * A grant is issued TO a session, so with no `session_id` on the payload there is nothing to match one
 * against and the production-facing class simply refuses — the safe direction, and the same one the reader
 * takes when the journal is unreadable.
 *
 * @param payload the shell call's payload
 * @param readReachGrantState the journal reader, when the caller has one
 * @returns the bound reader, or `undefined` when no grant can be matched
 */
function grantReaderFor({
  payload,
  readReachGrantState,
}: {
  payload: Record<string, unknown>;
  readReachGrantState:
    ((options: { claudeSessionId: string; tool: string }) => { granted: boolean; grantsTaken: number }) | undefined;
}): ((options: { tool: string }) => { granted: boolean; grantsTaken: number }) | undefined {
  const claudeSessionId = payload["session_id"];
  if (readReachGrantState === undefined || typeof claudeSessionId !== "string" || claudeSessionId.length === 0) {
    return undefined;
  }
  return ({ tool }) => readReachGrantState({ claudeSessionId, tool });
}

/**
 * The wrong-Datadog-site walk, when the caller passed an environment to judge `DD_SITE` against.
 *
 * @param command the shell line
 * @param env the hook's environment, or `undefined` for a caller that passed none
 * @returns the walk's verdict, or allow when there is no environment
 */
function siteWalk({
  command,
  env,
}: {
  command: string;
  env: Readonly<Record<string, string | undefined>> | undefined;
}): { readonly blocked: true; readonly message: string } | { readonly blocked: false } {
  if (env === undefined) {
    return { blocked: false };
  }
  return classifyDatadogSiteCommand({ command, env });
}

/**
 * The environment the ADC sign-in and browser-launch walks judge under. Unlike the site walk they run with NO
 * environment too, judged as an empty one: each refusal needs nothing from the environment but its own hatch, and a
 * caller that passed none has not opened it.
 *
 * @param env the hook's environment, or `undefined` for a caller that passed none
 * @returns the environment, or an empty one
 */
function environmentOrEmpty({
  env,
}: {
  env: Readonly<Record<string, string | undefined>> | undefined;
}): Readonly<Record<string, string | undefined>> {
  if (env === undefined) {
    return {};
  }
  return env;
}

/**
 * Decide a PreToolUse payload. FAIL-CLOSED: a malformed payload (not an object) or a shell-tool call
 * missing its `command` blocks loudly rather than passing. A well-formed call of any other tool is allowed
 * (we police the shell tools only). A shell command is blocked only when the raw classifier says so.
 *
 * @param payload the parsed PreToolUse JSON (`{ tool_name, tool_input: { command }, cwd }`)
 * @param allowRaw whether `SLOPWEAVER_ALLOW_RAW=1` is set
 * @param allowPython whether `SLOPWEAVER_ALLOW_PYTHON=1` is set — it opens the Python walk only, and
 *   `allowRaw` never opens that one
 * @param allowArtifact whether `SLOPWEAVER_ALLOW_ARTIFACT=1` is set — it opens the Artifact walk only, and
 *   neither of the other two opens that one
 * @param readScript reads a script the command runs, given the payload's own `cwd` to resolve against;
 *   omit to judge scripts by name alone (the pure default every unit test starts from)
 * @param readReachGrantState reads the reach-grant journal for one production-facing tool, given the
 *   payload's own `session_id`; omit to find no grants at all, which refuses that whole class
 * @param env the hook's environment, for the wrong-Datadog-site walk (`DD_SITE` and its hatch); omit and that
 *   walk does not run, which is the pure default every other unit test starts from
 * @returns the block/allow decision
 */
export function evaluateHookPayload({
  payload,
  allowRaw,
  allowPython,
  allowArtifact,
  readScript,
  readReachGrantState,
  env,
}: {
  payload: unknown;
  allowRaw: boolean;
  allowPython: boolean;
  allowArtifact: boolean;
  env?: Readonly<Record<string, string | undefined>>;
  readScript?: (options: { cwd: string | undefined; path: string }) => string | undefined;
  readReachGrantState?: (options: { claudeSessionId: string; tool: string }) => {
    granted: boolean;
    grantsTaken: number;
  };
}): HookDecision {
  // FIRST, and on the payload rather than on a command line. `shellCallOf` answers `{block:false}` for every
  // tool that is not `Bash`/`Monitor`, so an `Artifact` walk placed after it would never run at all —
  // `./artifactTool.ts`'s header carries that finding.
  const artifact = classifyArtifactTool({ allowArtifact, payload });
  if (artifact.blocked) {
    return { block: true, message: artifact.message };
  }
  const shell = shellCallOf({ payload });
  if (!("command" in shell)) {
    return shell;
  }
  const { command, cwd } = shell;
  const boundReader = readScript === undefined ? undefined : ({ path }: { path: string }) => readScript({ cwd, path });
  const boundGrantReader = grantReaderFor({ payload: shell.payload, readReachGrantState });
  // `classifyRawCommand` resolves its OWN per-segment inline override (`hasSegmentInlineEnvironmentOverride`)
  // against `command` directly — composing a whole-command inline check here first, the way this used to,
  // is exactly the segment-blind shape that let an override on one segment wave through a different,
  // uncovered dangerous segment elsewhere in the same compound command.
  const verdict = classifyRawCommand({
    allowRaw,
    command,
    ...(boundReader === undefined ? {} : { readScript: boundReader }),
    ...(boundGrantReader === undefined ? {} : { reachGranted: boundGrantReader }),
  });
  // The Python and Datadog-site walks are SEPARATE policies with their own hatches, run whatever the raw walk
  // decided: one hatch must never hide another's refusal. When several refuse, all are printed.
  const python = classifyPythonCommand({
    allowPython,
    command,
    ...(boundReader === undefined ? {} : { readScript: boundReader }),
  });
  const messages = [
    verdict,
    python,
    siteWalk({ command, env }),
    classifyAdcSigninCommand({ command, env: environmentOrEmpty({ env }) }),
    classifyBrowserLaunchCommand({ command, env: environmentOrEmpty({ env }) }),
  ].flatMap((each) => (each.blocked ? [each.message] : []));
  return messages.length === 0 ? { block: false } : { block: true, message: messages.join("\n\n") };
}
