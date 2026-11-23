/**
 * The run-due deadline gate's runner: read the `PreToolUse` payload, classify the command, and refuse a firing
 * of `automation run-due` that a `timeout`, or the `Bash` tool's own foreground or background deadline, could kill
 * mid-effect.
 *
 * FAILS OPEN on anything it cannot read — a malformed payload, a tool it does not judge, a missing command. It
 * is a workflow tripwire, not a security boundary, so it starts from `./bashToolCommandPayload.ts`'s fail-open
 * preamble: a bug that failed closed would wedge every `Bash` call in every session on the machine.
 *
 * The decision is entirely in `./runDueDeadline.ts`; nothing here judges anything.
 */
import { hatchFor } from "../hatch/lookup.js";
import { hatchRefusal } from "../hatch/render.js";
import { readBashExecution } from "./bashToolCommandPayload.js";
import { EXIT_ALLOW, EXIT_BLOCK } from "./preToolUseDispatch.js";
import {
  BASH_BACKGROUND_MAX_TIMEOUT_MS,
  classifyRunDueDeadline,
  RUN_DUE_DEADLINE_HATCH,
  type RunDueDeadlineFinding,
} from "./runDueDeadline.js";

/**
 * The refusal, naming the invocation and the one shape that runs it safely.
 *
 * @internal — {@link runRunDueDeadlineGuard} is this module's public surface; exported for its own unit test.
 * @param finding what the gate found
 * @returns the four-line refusal followed by the shape to submit instead
 */
export function runDueDeadlineRefusal({
  finding,
}: {
  finding: Exclude<RunDueDeadlineFinding, { readonly kind: "allowed" }>;
}): string {
  const hatch = hatchFor({ id: "run-due-deadline" });
  let detail: string;
  if (finding.kind === "deadline-wrapper") {
    detail = `\`${finding.wrapper}\` would kill \`${finding.invocation}\``;
  } else if (finding.kind === "foreground") {
    detail = `a foreground Bash call's deadline would kill \`${finding.invocation}\``;
  } else {
    detail = `the Bash tool's background limit of ${finding.limitMs} ms would kill \`${finding.invocation}\``;
  }
  return [
    hatchRefusal({ detail, hatch }),
    "Instead: drop any `timeout`/`gtimeout` in front of it and submit the Bash call with `run_in_background: " +
      `true\` and \`timeout: ${BASH_BACKGROUND_MAX_TIMEOUT_MS}\` — the tool's maximum, since a background call ` +
      "with no timeout is killed at 30 minutes; its completion re-invokes you. A tick bounds itself with " +
      "`--limit <n>`, which stops it starting another row and never kills one that has started.",
  ].join("\n");
}

/**
 * Run the gate over one `PreToolUse` payload.
 *
 * @param readStdin reads the raw payload
 * @param writeError writes the refusal (stderr in production)
 * @param env the hook process's environment, for the ambient hatch
 * @returns the exit code (2 refuse, 0 allow)
 */
export async function runRunDueDeadlineGuard({
  env,
  readStdin,
  writeError,
}: {
  env: Readonly<Record<string, string | undefined>>;
  readStdin: () => Promise<string>;
  writeError: (line: string) => void;
}): Promise<number> {
  if (env[RUN_DUE_DEADLINE_HATCH] === "1") {
    return EXIT_ALLOW;
  }
  const call = await readBashExecution({ readStdin });
  if (call === undefined) {
    return EXIT_ALLOW;
  }
  const finding = classifyRunDueDeadline({
    command: call.command,
    runInBackground: call.runInBackground,
    timeoutMs: call.timeoutMs,
  });
  if (finding.kind === "allowed") {
    return EXIT_ALLOW;
  }
  writeError(`${runDueDeadlineRefusal({ finding })}\n`);
  return EXIT_BLOCK;
}
