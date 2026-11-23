/**
 * The Codex destinations this install can spend against, read from the ONE register that holds them.
 *
 * ## The Codex-shaped reader, beside `src/claude/spawnAccounts.ts`
 *
 * Both providers' rows live in the one store-backed register and both readers narrow it to their own shape —
 * that is what "one register" buys. The two shapes differ because the providers do: a Claude destination is addressed by
 * `CLAUDE_SECURESTORAGE_CONFIG_DIR` and a Codex one by `CODEX_HOME`, and Codex keeps its own rollout log
 * under that home, so a Codex destination is always the PAIR — the alias a record is keyed by, and the home
 * the live evidence is read from. Nothing here ranks them; that is the caller's judgement.
 *
 * ## Only a registered row is a destination — never the ambient home
 *
 * A Codex destination exists because the owner registered it, never because a login sits in `$CODEX_HOME`: a
 * plan is never added from what happens to be found on the machine. So nothing here returns the ambient home, and a caller naming
 * an alias no row carries gets `undefined` rather than a substitute — which would also read one account's
 * rollout log while writing another account's cap record, the failure `./quotaNow.ts` refuses in the small.
 */
import type { Result } from "#lib/result.js";

import type { PlanRegisterError } from "../plans/errors.js";
import type { PlanRegisterPort } from "../plans/port.js";
import { findRegisteredPlan, plansForProvider } from "../plans/register.js";

/** One Codex destination, in the two terms every quota source is addressed by. */
export interface CodexDestination {
  /** The register alias, which keys this destination's cached exhaustion record. */
  readonly alias: string;
  /** The `$CODEX_HOME` this destination is signed into, where its own rollout log lives. */
  readonly codexHome: string;
}

/**
 * Every Codex destination the register carries, paused rows included.
 *
 * Paused rows are kept here on purpose: this answers "which destinations exist", and the ONE place a pause
 * filters a list is `unpausedPlansFor`, called by a site acting on the fleet rather than by a reader.
 *
 * @param home the Slopweaver home whose register is read
 * @param port where the register is read — `planRegisterPort()` in production, a seam in a test
 * @returns each registered Codex destination in registered order, or why the register could not be read —
 *   never an empty list standing in for a store outage
 */
export async function codexDestinations({
  home,
  port,
}: {
  home: string;
  port: PlanRegisterPort;
}): Promise<Result<readonly CodexDestination[], PlanRegisterError>> {
  const snapshot = await port.read({ home });
  return snapshot.map((register) =>
    plansForProvider({ plans: register.plans, provider: "codex" }).map((plan) => ({
      alias: plan.alias,
      codexHome: plan.storeDir,
    })),
  );
}

/**
 * The destination one alias names, or undefined when no Codex row carries it.
 *
 * @param alias the register alias the caller named
 * @param home the Slopweaver home whose register is read
 * @param port where the register is read — `planRegisterPort()` in production, a seam in a test
 * @returns the alias paired with its own `$CODEX_HOME`; `ok(undefined)` ONLY when the register read fine and no
 *   Codex row carries that alias — never a substitute; or the read failure itself
 */
export async function codexDestinationFor({
  alias,
  home,
  port,
}: {
  alias: string;
  home: string;
  port: PlanRegisterPort;
}): Promise<Result<CodexDestination | undefined, PlanRegisterError>> {
  const snapshot = await port.read({ home });
  return snapshot.map((register) => {
    const plan = findRegisteredPlan({ alias, plans: register.plans, provider: "codex" });
    if (plan === undefined) {
      return undefined;
    }
    return { alias: plan.alias, codexHome: plan.storeDir };
  });
}
