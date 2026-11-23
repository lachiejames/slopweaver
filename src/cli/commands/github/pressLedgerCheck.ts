/**
 * The check `slopweaver github landing --press` makes BEFORE it presses: the autonomy ledger answers, and the acts
 * it already holds, so a press is never repeated and never made while its row could not be written.
 *
 * Its own module because it is the one ledger READ `./landingDeps.ts` makes ahead of an act rather than after one.
 * The ledger is the store (`../../../autonomy/port.ts`), so "can the row be written" is "does the store answer": a
 * store that cannot be opened, or that has not imported a register still standing in the home, refuses the press
 * here rather than after it.
 */
import type { AutonomyLedgerPort } from "../../../autonomy/port.js";
import { isSteerRecord } from "../../../autonomy/row.js";
import type { AutonomyActionRow } from "../../../autonomy/types.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { resolveHome } from "../../optionParsers.js";

/**
 * Every act the autonomy ledger holds, or why a press's row could not be written to it.
 *
 * One read of the whole ledger, which the port refuses whole on a single unreadable row: the acts guard against
 * repeating a press or a body rewrite, and the earlier row that would stop one could be the unreadable one.
 *
 * @param autonomy the autonomy ledger
 * @param home the state home the ledger answers for, the ambient one when undefined
 * @returns the acts, or the sentence the refused press prints
 */
export async function pressLedgerActs({
  autonomy,
  home,
}: {
  autonomy: AutonomyLedgerPort;
  home: string | undefined;
}): Promise<Result<readonly AutonomyActionRow[], string>> {
  const read = await autonomy.readRecords({ home: resolveHome({ named: home }) });
  if (read.isErr()) {
    return err(read.error.message);
  }
  return ok(read.value.filter((record): record is AutonomyActionRow => !isSteerRecord(record)));
}
