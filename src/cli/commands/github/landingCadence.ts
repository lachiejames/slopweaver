/**
 * The two ends of `github landing --if-due`'s cadence: whether this tick reads at all, asked before any GitHub
 * request, and the cursor row that starts the next window, written after the pass has reported. The pure
 * verdict is `../../../review/readJournal.ts`'s `readDue`; the cursor is reached through the port the deps
 * carry, so both halves are driven here over plain fakes.
 */
import { err, ok, type Result } from "#lib/result.js";

import { type ReadCadence, readDue } from "../../../review/readJournal.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import type { GithubLandingDeps } from "./landingDepsContract.js";

/**
 * Whether this invocation reads at all.
 *
 * Asked BEFORE anything reaches GitHub, which is the whole property: a tick that is not due must cost nothing
 * at all, or the sweep cannot run this verb every tick and the read goes back to being a thing a chair has to
 * remember. Without `--if-due` no register is consulted and the answer is always `due`, which is what boot and
 * a hand-run invocation want.
 *
 * A cursor that cannot be read is UNKNOWN, never "never read": answered `due` it would read every tick for as
 * long as the store is down, so the tick refuses before any GitHub request instead.
 *
 * @param ifDue whether `--if-due` was given
 * @param cadenceMinutes how long one read holds
 * @param home the state home whose store holds the cursor
 * @param deps the cursor read and the clock
 * @param selection this run's canonical selection key
 * @returns the cadence verdict with the sentence behind it, or why the cursor could not be read
 */
export async function cadenceFor({
  ifDue,
  cadenceMinutes,
  home,
  deps,
  selection,
}: {
  ifDue: boolean;
  cadenceMinutes: number;
  home: string | undefined;
  deps: Pick<GithubLandingDeps, "now" | "reads">;
  selection: string;
}): Promise<Result<ReadCadence, string>> {
  if (!ifDue) {
    return ok({ kind: "due", lastReadAtIso: undefined, why: "--if-due was not given" });
  }
  const reads = await deps.reads({ home });
  if (reads.isErr()) {
    return err(reads.error.message);
  }
  return ok(readDue({ cadenceMinutes, now: deps.now(), reads: reads.value, selection }));
}

/**
 * Start this selection's next cadence window, AFTER the pass has reported what it did.
 *
 * Two orderings matter and both are deliberate. It runs only once the fleet read SUCCEEDED, so a failed read
 * leaves the cadence due and the next pass retries rather than inheriting a window it never earned. And it
 * runs after the report (`./landingTerminal.ts`), because a record that fails is loud on purpose — an
 * unrecorded read means the next pass spends the requests again — and recording first would let that failure
 * carry away the report of presses and board rows this pass had already made. A press nobody can see is
 * indistinguishable from a press nobody made.
 *
 * A failure, a lost compare-and-set race included, is one diagnostic and a non-zero exit. It is never retried:
 * a race lost means another pass recorded a NEWER read, which stands.
 *
 * @param home the state home whose store holds the cursor
 * @param deps the cursor write, the clock and the diagnostic channel
 * @param dispatchable how many judged rows a session may be dispatched for
 * @param rows how many rows the pass judged
 * @param selection this run's canonical selection key
 * @returns the process exit code
 */
export async function recordCadence({
  home,
  deps,
  dispatchable,
  rows,
  selection,
}: {
  home: string | undefined;
  deps: Pick<GithubLandingDeps, "now" | "recordRead" | "writeDiagnostic">;
  dispatchable: number;
  rows: number;
  selection: string;
}): Promise<number> {
  const recorded = await deps.recordRead({
    home,
    record: { atIso: deps.now().toISOString(), dispatchable, rows, selection },
  });
  if (recorded.isErr()) {
    deps.writeDiagnostic(`github landing: the read completed and was reported, but ${recorded.error.message}`);
    return EXIT_ERROR;
  }
  return EXIT_OK;
}
