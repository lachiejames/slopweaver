/**
 * The main-checkout branch guard's runner (effectful core, testable). Reads the tool-call payload, evaluates
 * it, and returns the exit code (2 = block, 0 = allow). FAILS OPEN, deliberately unlike
 * `src/admit/pretooluseAdmit.ts`: this guard is a workflow safety net rather than a security boundary, so a
 * malformed payload or a missing `cwd`/`command` allows rather than blocks — ambiguity here should never wedge
 * an unrelated tool call. `readStdin`/`writeError`/`evaluate` are injected so this is unit-tested.
 */
import { readBashToolCommand } from "./bashToolCommandPayload.js";
import { evaluateMainCheckoutBranchGuard, MAIN_CHECKOUT_OVERRIDE_ENV } from "./mainCheckoutBranchGuard.js";

/**
 * Run the guard: read + parse the payload, evaluate, and return the exit code. Allows (0) on anything
 * malformed, non-`Bash`, or missing the fields this needs — blocks (2) only for a resolved, unambiguous
 * off-trunk branch switch in the main checkout.
 *
 * @param readStdin reads the raw payload
 * @param env the environment (for a process-wide {@link MAIN_CHECKOUT_OVERRIDE_ENV}). An override written
 *   as an inline prefix on the judged command is NOT here and never can be — the hook runs before the
 *   command — so `evaluate` resolves that one itself, per segment
 * @param writeError writes a diagnostic line (to stderr in production)
 * @param evaluate the payload evaluator (defaults to {@link evaluateMainCheckoutBranchGuard})
 * @returns the exit code (2 block, 0 allow)
 */
export async function runMainCheckoutBranchGuard({
  readStdin: read,
  env,
  writeError,
  evaluate = evaluateMainCheckoutBranchGuard,
}: {
  readStdin: () => Promise<string>;
  env: Readonly<Record<string, string | undefined>>;
  writeError: (line: string) => void;
  evaluate?: typeof evaluateMainCheckoutBranchGuard;
}): Promise<number> {
  const parsed = await readBashToolCommand({ readStdin: read });
  if (parsed === undefined) {
    return 0;
  }
  const allowOverride = env[MAIN_CHECKOUT_OVERRIDE_ENV] === "1";
  const decision = evaluate({ allowOverride, command: parsed.command, cwd: parsed.cwd });
  if (decision.block) {
    writeError(`${decision.message}\n`);
    return 2;
  }
  return 0;
}
