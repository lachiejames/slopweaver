/**
 * The call-state guard's runner: read the `PreToolUse` payload, evaluate it, print the four-line refusal.
 *
 * FAILS OPEN on anything it cannot read, exactly like `./homeGitGuardRunner.ts` — a workflow tripwire that failed
 * closed would wedge every `Bash` call on the machine. The decision is entirely in `./callStateGuard.ts`; nothing
 * here judges anything.
 */
import { hatchFor } from "../hatch/lookup.js";
import { hatchRefusal } from "../hatch/render.js";
import { accountDefaultHome, slopweaverHomeOf } from "../homeDir.js";
import { readBashToolCommand } from "./bashToolCommandPayload.js";
import { CALL_STATE_DELETE_HATCH, type CallStateHit, evaluateCallStateGuard } from "./callStateGuard.js";
import { EXIT_ALLOW, EXIT_BLOCK } from "./preToolUseDispatch.js";

/**
 * The refusal, naming the segment, the call state it would have reached, and what does the job instead.
 *
 * @internal — {@link runCallStateGuard} is this module's public surface; exported for its own unit test.
 * @param hit the refused segment
 * @returns the four-line refusal followed by the remedy
 */
export function callStateRefusal({ hit }: { hit: CallStateHit }): string {
  let detail = `\`${hit.segment}\` would delete, move or overwrite ${hit.operand}, which reaches the console-voice call state at ${hit.protectedPath}`;
  if (hit.others.length > 0) {
    // The hatch exempts the whole segment, so every path it reaches is named before anyone judges an exception.
    detail += `, and also ${hit.others.join(", ")} — a hatch on this segment covers every one of them`;
  }
  return [
    hatchRefusal({ detail, hatch: hatchFor({ id: "call-state-delete" }) }),
    "A live home's call file is the owner's words and nothing in Slopweaver removes one. A test call belongs in a throwaway `--home`; " +
      'a call already gone is accepted on the record with `slopweaver talk quarantine <id> --reason "<why>"`.',
  ].join("\n");
}

/**
 * The live homes this guard protects: those a test gave, else the environment's own and the account default, each once.
 *
 * @param env the hook process's environment
 * @param given homes a test protects instead, throwaway ones
 * @returns the homes
 */
function liveHomes({
  env,
  given,
}: {
  env: Readonly<Record<string, string | undefined>>;
  given: readonly string[] | undefined;
}): readonly string[] {
  if (given !== undefined) {
    return given;
  }
  const homes = [slopweaverHomeOf({ env })];
  try {
    homes.push(accountDefaultHome());
  } catch {
    // An account with no resolvable home still guards the environment's own.
  }
  return [...new Set(homes)];
}

/**
 * Run the guard over one `PreToolUse` payload.
 *
 * @param readStdin reads the raw payload
 * @param writeError writes the refusal (stderr in production)
 * @param env the hook process's environment, for a process-wide hatch and the homes to protect; an inline hatch on
 *   the judged segment is read by the evaluator itself, because the hook runs before the command does
 * @param homes the live homes, given so a test protects a throwaway one; absent, the environment's and the account's
 * @returns the exit code (2 refuse, 0 allow)
 */
export async function runCallStateGuard({
  readStdin: read,
  writeError,
  env,
  homes,
}: {
  readStdin: () => Promise<string>;
  writeError: (line: string) => void;
  env: Readonly<Record<string, string | undefined>>;
  homes?: readonly string[];
}): Promise<number> {
  if (env[CALL_STATE_DELETE_HATCH] === "1") {
    return EXIT_ALLOW;
  }
  const parsed = await readBashToolCommand({ readStdin: read });
  if (parsed === undefined) {
    return EXIT_ALLOW;
  }
  const protectedHomes = liveHomes({ env, given: homes });
  const hit = evaluateCallStateGuard({ command: parsed.command, cwd: parsed.cwd, env, homes: protectedHomes });
  if (hit === undefined) {
    return EXIT_ALLOW;
  }
  writeError(`${callStateRefusal({ hit })}\n`);
  return EXIT_BLOCK;
}
