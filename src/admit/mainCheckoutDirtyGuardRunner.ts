/**
 * The main-checkout dirty guard's runner (effectful core, testable). Reads the tool-call payload, evaluates
 * it, and returns the exit code (2 = block, 0 = allow). FAILS OPEN on a malformed or non-`Bash` payload,
 * same shape as `mainCheckoutBranchGuardRunner.ts` — a broken toolchain or an unrelated tool call must never
 * wedge on this. `readStdin`/`writeError`/`evaluate` are injected so this is unit-tested.
 */
import { readBashToolCommand } from "./bashToolCommandPayload.js";
import { evaluateMainCheckoutDirtyGuard, MAIN_CHECKOUT_WRITE_OVERRIDE_ENV } from "./mainCheckoutDirtyGuard.js";

/**
 * Run the guard: read + parse the payload, evaluate, and return the exit code. Allows (0) on anything
 * malformed, non-`Bash`, or missing the fields this needs — blocks (2) only for a command this recognises as
 * a write inside the main checkout.
 *
 * @param readStdin reads the raw payload
 * @param env the environment (for {@link MAIN_CHECKOUT_WRITE_OVERRIDE_ENV})
 * @param writeError writes a diagnostic line (to stderr in production)
 * @param evaluate the payload evaluator (defaults to {@link evaluateMainCheckoutDirtyGuard})
 * @returns the exit code (2 block, 0 allow)
 */
export async function runMainCheckoutDirtyGuard({
  readStdin: read,
  env,
  writeError,
  evaluate = evaluateMainCheckoutDirtyGuard,
}: {
  readStdin: () => Promise<string>;
  env: Readonly<Record<string, string | undefined>>;
  writeError: (line: string) => void;
  evaluate?: typeof evaluateMainCheckoutDirtyGuard;
}): Promise<number> {
  const parsed = await readBashToolCommand({ readStdin: read });
  if (parsed === undefined) {
    return 0;
  }
  const allowOverride = env[MAIN_CHECKOUT_WRITE_OVERRIDE_ENV] === "1";
  const decision = evaluate({ allowOverride, command: parsed.command, cwd: parsed.cwd });
  if (decision.block) {
    writeError(`${decision.message}\n`);
    return 2;
  }
  return 0;
}
