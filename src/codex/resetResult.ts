/**
 * What one store's run of `codex reset` came to, typed, and the exit code each form of the verb ends on. PURE: the
 * single-store path (`../cli/commands/codex/resetOne.ts`) returns one of these and the command edge renders it, so
 * `--at-limit` aggregates outcomes rather than guessing them back out of integers.
 *
 * ## A claim that did not refill is a failure, not a success
 *
 * `reset` or `alreadyRedeemed` answered, but the read straight after still finds the store at its limit — or could
 * not read it at all — is a claim that FAILED, because the whole point was a store that can take work again. The
 * outcome row is journalled either way, so `../monitor/codexResetFailed.ts` raises the one note the owner wants:
 * no floating note unless the claim itself fails.
 */
import type { CodexConsumeOutcome } from "./resetConsume.js";
import type { CodexResetReading } from "./resetEvidence.js";

/** What one store's run came to. */
export type CodexResetRunResult =
  /** An earlier attempt was closed because the live read shows it over; nothing was sent. */
  | { readonly kind: "closed"; readonly alias: string; readonly idempotencyKey: string; readonly reason: string }
  /** The provider answered, the outcome is journalled, and `after` is the store re-read straight after. */
  | {
      readonly kind: "settled";
      readonly alias: string;
      readonly idempotencyKey: string;
      readonly outcome: CodexConsumeOutcome;
      readonly after: CodexResetReading | undefined;
    }
  /** Not yet — an answer that never came back, or another reset run holding the lock. Re-run unchanged. */
  | { readonly kind: "deferred"; readonly alias: string; readonly reason: string }
  /** Nothing to redeem before anything was sent: the store holds no reset, or not the one named. */
  | { readonly kind: "empty"; readonly alias: string; readonly reason: string }
  /** Refused or broken; `claimStarted` says whether an intent had been journalled. */
  | { readonly kind: "failed"; readonly alias: string; readonly reason: string; readonly claimStarted: boolean };

/** Exit codes, restated as literals so this module stays free of the CLI tree (`../cli/exitCodes.ts`). */
const EXIT = { deferred: 4, empty: 3, error: 1, ok: 0 } as const;

/**
 * Why a settled claim failed to leave the store able to take work, or undefined when it did.
 *
 * @param result a settled result
 * @returns the failure sentence, or undefined for a claim that refilled the store
 */
export function settledFailure({ result }: { result: CodexResetRunResult & { kind: "settled" } }): string | undefined {
  if (result.outcome === "noCredit" || result.outcome === "nothingToReset") {
    return `the provider answered ${result.outcome}`;
  }
  if (result.after === undefined) {
    return `the provider answered ${result.outcome}, but the store could not be re-read to confirm it`;
  }
  if (result.after.atLimit) {
    return `the provider answered ${result.outcome}, but the store still reads at its limit`;
  }
  return undefined;
}

/**
 * The exit code `codex reset --plan` ends on, keeping the verb's documented meanings: 0 reset or settled earlier,
 * 3 nothing to redeem (provider-empty included), 4 re-run, 1 everything else.
 *
 * @param result the store's result
 * @returns the exit code
 */
export function singleResetExit({ result }: { result: CodexResetRunResult }): number {
  switch (result.kind) {
    case "closed": {
      return EXIT.ok;
    }
    case "deferred": {
      return EXIT.deferred;
    }
    case "empty": {
      return EXIT.empty;
    }
    case "failed": {
      return EXIT.error;
    }
    case "settled": {
      if (result.outcome === "noCredit" || result.outcome === "nothingToReset") {
        return EXIT.empty;
      }
      return settledFailure({ result }) === undefined ? EXIT.ok : EXIT.error;
    }
    default: {
      const unreachable: never = result;
      return unreachable;
    }
  }
}

/**
 * The exit code `codex reset --at-limit` ends on: 1 when any store failed — a planning failure or a claim that did
 * not refill, provider-empty included — else 4 when any is deferred, else 0. Skips and nothing due are success.
 *
 * @param results every claimed store's result
 * @param planFailures how many stores the planner could not judge or safely claim on
 * @returns the exit code
 */
export function fleetResetExit({
  planFailures,
  results,
}: {
  planFailures: number;
  results: readonly CodexResetRunResult[];
}): number {
  const failed = results.some(
    (result) =>
      result.kind === "failed" ||
      result.kind === "empty" ||
      (result.kind === "settled" && settledFailure({ result }) !== undefined),
  );
  if (planFailures > 0 || failed) {
    return EXIT.error;
  }
  if (results.some((result) => result.kind === "deferred")) {
    return EXIT.deferred;
  }
  return EXIT.ok;
}

/**
 * The one line a result prints.
 *
 * @param result the store's result
 * @returns the line
 */
export function resetResultLine({ result }: { result: CodexResetRunResult }): string {
  switch (result.kind) {
    case "closed": {
      return (
        `codex reset: ${result.alias} — the earlier attempt ${result.idempotencyKey} is settled (${result.reason}), so ` +
        "it most likely reset already; nothing was sent this run"
      );
    }
    case "settled": {
      const failure = settledFailure({ result });
      const tail = failure === undefined ? "the store can take work again" : `FAILED: ${failure}`;
      return `codex reset: ${result.alias} — ${result.outcome} (attempt ${result.idempotencyKey}); ${tail}`;
    }
    case "deferred":
    case "empty":
    case "failed": {
      return `codex reset: ${result.alias} — ${result.reason}`;
    }
    default: {
      const unhandled: never = result;
      return unhandled;
    }
  }
}
