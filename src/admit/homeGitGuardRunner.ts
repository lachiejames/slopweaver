/**
 * The state-home git guard's runner: read the `PreToolUse` payload, evaluate it, print the four-line refusal.
 *
 * FAILS OPEN on anything it cannot read, exactly like `./mainCheckoutBranchGuardRunner.ts` — a workflow
 * tripwire that failed closed would wedge every `Bash` call on the machine. The decision is entirely in
 * `./homeGitGuard.ts`; nothing here judges anything.
 */
import { hatchFor } from "../hatch/lookup.js";
import { hatchRefusal } from "../hatch/render.js";
import { slopweaverHome } from "../homeDir.js";
import { readBashToolCommand } from "./bashToolCommandPayload.js";
import { evaluateHomeGitGuard, HOME_GIT_IMPLICIT_HATCH, type HomeGitHit } from "./homeGitGuard.js";
import { EXIT_ALLOW, EXIT_BLOCK } from "./preToolUseDispatch.js";

/**
 * The refusal, naming the segment, where it would have landed, and the one-token fix.
 *
 * @internal — {@link runHomeGitGuard} is this module's public surface; exported for its own unit test.
 * @param hit the refused segment
 * @param stateHome the resolved state home, named so the reader sees whose repository it would have read
 * @returns the four-line refusal followed by the remedy
 */
export function homeGitRefusal({ hit, stateHome }: { hit: HomeGitHit; stateHome: string }): string {
  const detail = `\`${hit.segment}\` (${hit.trigger}) would run in ${hit.cwd}, inside the state repository at ${stateHome}`;
  return [
    hatchRefusal({ detail, hatch: hatchFor({ id: "home-git-implicit" }) }),
    "Name the repository instead: `git -C <the checkout you mean> …` — `slopweaver worktree here` prints the one " +
      `you are standing in. If you really do mean the state repository, \`git -C ${stateHome} …\` says so and passes.`,
  ].join("\n");
}

/**
 * Run the guard over one `PreToolUse` payload.
 *
 * @param readStdin reads the raw payload
 * @param writeError writes the refusal (stderr in production)
 * @param env the hook process's environment, for a process-wide hatch; an inline one on the judged segment
 *   is read by the evaluator itself, because the hook runs before the command does
 * @param stateHome the resolved state home (defaults to the real one)
 * @param evaluate the payload evaluator, injectable so a test owns the filesystem
 * @returns the exit code (2 refuse, 0 allow)
 */
export async function runHomeGitGuard({
  readStdin: read,
  writeError,
  env,
  stateHome = slopweaverHome(),
  evaluate = evaluateHomeGitGuard,
}: {
  readStdin: () => Promise<string>;
  writeError: (line: string) => void;
  env: Readonly<Record<string, string | undefined>>;
  stateHome?: string;
  evaluate?: typeof evaluateHomeGitGuard;
}): Promise<number> {
  if (env[HOME_GIT_IMPLICIT_HATCH] === "1") {
    return EXIT_ALLOW;
  }
  const parsed = await readBashToolCommand({ readStdin: read });
  if (parsed === undefined) {
    return EXIT_ALLOW;
  }
  const hit = evaluate({ command: parsed.command, cwd: parsed.cwd, stateHome });
  if (hit === undefined) {
    return EXIT_ALLOW;
  }
  writeError(`${homeGitRefusal({ hit, stateHome })}\n`);
  return EXIT_BLOCK;
}
