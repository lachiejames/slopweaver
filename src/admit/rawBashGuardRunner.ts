/**
 * The raw-Bash gate's runner: read the `PreToolUse` payload, classify its command with `./rawBash.ts`, and
 * refuse a script. A `Monitor` command is judged for jq alone, since a watch loop is a Monitor's shape.
 *
 * FAILS OPEN on anything it cannot read — a malformed payload, another tool, a missing command — for the
 * reason `./diskScanGuardRunner.ts` gives: it is a workflow tripwire, and a bug that failed closed would
 * wedge every Bash call on the machine. Nothing here judges anything.
 */
import { readShellCommand } from "./bashToolCommandPayload.js";
import { EXIT_ALLOW, EXIT_BLOCK } from "./preToolUseDispatch.js";
import { classifyMonitorCommand, classifyRawBash, RAW_BASH_OVERRIDE_ENV } from "./rawBash.js";

/**
 * Run the gate over one `PreToolUse` payload.
 *
 * @param readStdin reads the raw payload
 * @param env the hook process's environment, for the ambient hatch
 * @param writeError writes the refusal (stderr in production)
 * @returns the exit code (2 refuse, 0 allow)
 */
export async function runRawBashGuard({
  readStdin,
  env,
  writeError,
}: {
  readStdin: () => Promise<string>;
  env: Readonly<Record<string, string | undefined>>;
  writeError: (line: string) => void;
}): Promise<number> {
  const call = await readShellCommand({ readStdin });
  if (call === undefined) {
    return EXIT_ALLOW;
  }
  const judge = call.tool === "Monitor" ? classifyMonitorCommand : classifyRawBash;
  const verdict = judge({ allowBash: env[RAW_BASH_OVERRIDE_ENV] === "1", command: call.command });
  if (!verdict.blocked) {
    return EXIT_ALLOW;
  }
  writeError(`${verdict.message}\n`);
  return EXIT_BLOCK;
}
