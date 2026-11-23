/**
 * Effects a SYNCHRONOUS caller starts and cannot await, held so the process shell waits for them before it exits.
 *
 * One caller needs it: `../cmux/sidebar.ts`'s `realCmuxCli` runs `cmux` with `execFileSync` inside a synchronous
 * contract some twenty verbs share, and a timeout there journals the dialog decline into the store, which is
 * asynchronous. Turning that contract async across every verb would move far more than the one write. The shell
 * (`../cli/main.ts`'s `runCliProcess`) calls {@link settlePendingEffects} before it closes TypeScript, drains and
 * exits, because `process.exit` would otherwise cut the write off mid-flight.
 *
 * An effect must handle its own failure: a rejection here is logged, never thrown into the exit.
 */
import { errorMessage } from "./errorMessage.js";
import { logger } from "./logger.js";

/** Every effect started and not yet settled. */
const pending = new Set<Promise<void>>();

/**
 * Hold one effect until it settles.
 *
 * @param effect the started effect
 */
export function trackEffect({ effect }: { effect: Promise<void> }): void {
  const held = effect.catch((error: unknown) => {
    logger.error({ msg: `a background effect failed: ${errorMessage({ error })}` });
  });
  pending.add(held);
  void held.finally(() => {
    pending.delete(held);
  });
}

/**
 * Wait until every tracked effect has settled, including any an effect started while it ran.
 */
export async function settlePendingEffects(): Promise<void> {
  while (pending.size > 0) {
    await Promise.all(pending);
  }
}
