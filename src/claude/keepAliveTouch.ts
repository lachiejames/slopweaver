/**
 * One keep-alive touch of one store, witnessed by that store's own expiry rather than by a command's exit code.
 *
 * The touch used to run `claude doctor` and record success whenever it exited 0. The CLI refreshes a token only
 * inside its last five minutes, so on a schedule of every 8/3 hours that command almost never refreshed anything,
 * and the record still said the store had been kept alive. MEASURED: a store recorded a touch and was refused by
 * the provider about an hour later. Reproduce by reading `keep-alive.json` beside the store's keychain `mdat` and
 * `expiresAt`.
 *
 * So the touch now reads the store first (`touchVerdict`), runs the proven refresh primitive
 * (`runStoreRefresh`) only when the CLI will act, reads the store again, and counts only an expiry that moved
 * strictly forward (`assessStoreRefresh`). Every effect is an injected seam, the same three the on-demand
 * repair uses, so the whole sequence is unit-testable without a keychain or a child process.
 */
import type { ClaudeAccount } from "./contracts.js";
import { assessStoreRefresh } from "./credentialRepair.js";
import { type TouchHoldReason, touchVerdict } from "./keepAlive.js";
import type { ProbeRepairDeps } from "./probeRepair.js";

/** The three effects a touch performs: the clock, the store read and the refresh command. */
export type KeepAliveTouchDeps = Pick<ProbeRepairDeps, "nowIso" | "readLife" | "refresh">;

/** What one touch achieved. Only `refreshed` is recorded as a touch. */
export type KeepAliveTouchResult =
  | { readonly kind: "refreshed"; readonly alias: string; readonly afterExpiresAtIso: string }
  | { readonly kind: "live"; readonly alias: string; readonly expiresAtIso: string }
  | { readonly kind: "held"; readonly alias: string; readonly reason: TouchHoldReason }
  | { readonly kind: "failed"; readonly alias: string; readonly problem: string };

/**
 * Touch one store: read it, refresh it only when the CLI would act, and judge the attempt by its expiry.
 *
 * @param account the plan whose store to touch
 * @param deps the clock, the store read and the refresh command
 * @returns what the touch achieved; `refreshed` is the only outcome a caller may record as a touch
 */
export function touchOneStore({
  account,
  deps,
}: {
  account: ClaudeAccount;
  deps: KeepAliveTouchDeps;
}): KeepAliveTouchResult {
  const before = deps.readLife({ account });
  const verdict = touchVerdict({ life: before, nowIso: deps.nowIso() });
  if (verdict.kind === "live") {
    return { alias: account.alias, expiresAtIso: verdict.expiresAtIso, kind: "live" };
  }
  if (verdict.kind === "hold") {
    return { alias: account.alias, kind: "held", reason: verdict.reason };
  }
  const commandProblem = deps.refresh({ storeDir: account.storeDir });
  const after = deps.readLife({ account });
  const outcome = assessStoreRefresh({ after, before, ...(commandProblem === undefined ? {} : { commandProblem }) });
  if (outcome.status === "refreshed") {
    return { alias: account.alias, afterExpiresAtIso: outcome.afterExpiresAtIso, kind: "refreshed" };
  }
  return { alias: account.alias, kind: "failed", problem: outcome.problem };
}

/**
 * The line a touch reports, or undefined when it is not worth one.
 *
 * A refreshed store and a store with life left are the ordinary cases and print nothing (rule 7). A held or
 * failed one is a problem line, worded so it never claims the store was kept alive.
 *
 * @param result what one touch achieved
 * @returns the problem line, or undefined
 */
export function touchProblemLine({ result }: { result: KeepAliveTouchResult }): string | undefined {
  if (result.kind === "held") {
    return `${result.alias}: not refreshed — ${result.reason}`;
  }
  if (result.kind === "failed") {
    return `${result.alias}: refresh did not advance the expiry — ${result.problem}`;
  }
  return undefined;
}
