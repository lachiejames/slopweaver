/**
 * The check-in half of `talk relay`: their reaction to the check-in the relay is about, recorded as their word on every
 * card it covers once the row carrying their words is on the board (`../../../talk/checkInRuling.ts`). Split from
 * `./relayRun.ts`, which decides when it runs.
 */
import type { AutonomyLedgerPort } from "../../../autonomy/port.js";
import { logger } from "../../../lib/logger.js";
import { applyCheckInRuling } from "../../../talk/checkInRuling.js";
import type { RelayDraft } from "../../../talk/relayDraft.js";
import type { RelayArgs } from "./relayArgs.js";
import type { RulingOutcome } from "./relayReport.js";

/**
 * Record the ruling a relay carries — on a replay too, which finishes a ruling a crash cut short and writes nothing
 * twice. A ruling that cannot be recorded is said, never fatal: the row already carries every word, and the
 * supervisor reads it there.
 *
 * @param args the relay's flags; only `--covers` is read
 * @param draft the relay's turn: what it is about, their heard words, and its id
 * @param ledger the autonomy ledger the word is written to
 * @param home the state home the ledger answers for
 * @param nowIso when the word is recorded
 * @param hold why the relay's words may end before the owner did (`../../../talk/relayCutHold.ts`); a held ruling is
 *   refused before anything is written, so a check-in never settles on a "yes" a "no, wait" may follow
 * @returns what the reaction settled or why nothing was recorded, or `undefined` when the relay carried no `--covers`
 */
export async function recordRuling({
  args,
  draft,
  ledger,
  home,
  nowIso,
  hold,
}: {
  args: Pick<RelayArgs, "covers">;
  draft: Pick<RelayDraft, "about" | "heard" | "turnId">;
  ledger: AutonomyLedgerPort;
  home: string;
  nowIso: string;
  hold: string | undefined;
}): Promise<RulingOutcome | undefined> {
  if (args.covers === undefined) {
    return undefined;
  }
  if (hold !== undefined) {
    logger.error({ msg: `talk relay: no ruling recorded — ${hold}` });
    return { kind: "refused", why: hold };
  }
  const applied = await applyCheckInRuling({
    about: draft.about,
    covers: args.covers,
    heard: draft.heard,
    home,
    ledger,
    nowIso,
    turnId: draft.turnId,
  });
  if (applied.isErr()) {
    logger.error({ msg: `talk relay: no ruling recorded — ${applied.error.message}` });
    return { kind: "refused", why: applied.error.message };
  }
  return { kind: "recorded", ruling: applied.value };
}
