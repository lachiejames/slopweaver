/**
 * When an ask's run records work, file every relay whose words landed on that ask into it.
 *
 * A relay spoken over an `ask:` card is born with no `repo:` (`../talk/relayRepository.ts`): the ask's own row
 * carries the work, so the relay is an answer, and nothing seats it. MEASURED: seven such relay rows sat
 * in RUN NOW long after their asks' runs had started, because nothing settles a relay off its ask's journal. So
 * `handover start` and `handover settle` call {@link settleRelaysForWork} on the row they just wrote, after their own
 * write lands, and it settles each relay through `./relaySettleAtAct.ts` — the real `handover settle`, with the
 * decision `relayTakenUpOf` derives, so this hook, the chair's acts and `handover prune` agree by construction.
 *
 * Narrow on purpose: only a relay's landing on THIS row's own `ask:` card, naming this row as its work. A generic
 * `workSlug` match would reach landings whose card needs a human `--card` disposition. Settling the relay recurses
 * into this hook for the relay's own slug, which finds nothing: no landing names a relay's `ask:` card.
 *
 * It never fails the caller, and never writes on its stdout. The start or settle is already on disk; a refusal is
 * printed by `settleRelayAtAct` with the line to finish it, and `handover prune --verdicts` reports whatever stays
 * open. Every receipt goes to the channel the caller names — {@link RELAY_RECEIPT_TO_STDERR} from both verbs — so a
 * script reading `handover start` or `handover settle` sees exactly that verb's own output.
 */
import { readRelayLandingLedger } from "../../../handover/relayLandingRead.js";
import { errExact, logger } from "../../../lib/logger.js";
import type { CardLandedRow } from "../../../talk/cardLanding.js";
import { parseRelayAnchor } from "../../../talk/relayDraft.js";
import { settleRelayAtAct } from "./relaySettleAtAct.js";
import type { SettleOut } from "./settleResidueRun.js";

/** The card kind whose own row carries the work the owner's words over it are a ruling on. */
const ASK_PREFIX = "ask:";

/** A relay's settle receipt, on stderr: the verb that fired the hook owns its stdout. */
export const RELAY_RECEIPT_TO_STDERR: SettleOut = ({ line }) => {
  errExact({ text: `${line}\n` });
};

/**
 * The relay anchors whose standing landing is on this row's own `ask:` card and names this row as the work.
 *
 * @param active the landings still holding a card off the Queue
 * @param workSlug the row a run just recorded work on
 * @returns each relay anchor once, in ledger order
 */
export function answerRelayAnchorsForWork({
  active,
  workSlug,
}: {
  active: readonly CardLandedRow[];
  workSlug: string;
}): readonly string[] {
  const anchors = active
    .filter((row) => row.source === "relay" && row.cardKey === `${ASK_PREFIX}${workSlug}` && row.workSlug === workSlug)
    .map((row) => parseRelayAnchor({ text: row.anchor }))
    .filter((anchor): anchor is string => anchor !== undefined);
  return [...new Set(anchors)];
}

/**
 * Settle every answer relay this row's run now carries, never failing the caller.
 *
 * @param dir the board directory the caller resolved
 * @param out where each relay's settle receipt goes — never the caller's stdout
 * @param verb the calling verb, which every printed line names
 * @param workSlug the row the caller just started or settled
 * @returns once every candidate was tried
 */
export async function settleRelaysForWork({
  dir,
  home,
  out,
  verb,
  workSlug,
}: {
  dir: string | undefined;
  home: string;
  out: SettleOut;
  verb: "handover start" | "handover settle";
  workSlug: string;
}): Promise<void> {
  // Nothing past this point may reach the caller: its write is on disk and its exit code is its own.
  try {
    await settleEach({ dir, home, out, verb, workSlug });
  } catch (error: unknown) {
    try {
      logger.error({ msg: `${verb}: relays answered by ${workSlug} were not checked — ${messageOf({ error })}` });
    } catch {
      // Even the report is best-effort: stderr failing is not the caller's verb failing (Codex r1-13).
    }
  }
}

/** Read the ledger once and settle each answer relay on it, one relay's failure never stopping the next. */
async function settleEach({
  dir,
  home,
  out,
  verb,
  workSlug,
}: {
  dir: string | undefined;
  home: string;
  out: SettleOut;
  verb: "handover start" | "handover settle";
  workSlug: string;
}): Promise<void> {
  const ledger = readRelayLandingLedger({ home });
  if (ledger.isErr()) {
    logger.error({ msg: `${verb}: relays answered by ${workSlug} were not checked — ${ledger.error.message}` });
    return;
  }
  for (const anchor of answerRelayAnchorsForWork({ active: ledger.value.active, workSlug })) {
    try {
      await settleRelayAtAct({ dir, home, ledger, out, pointer: anchor, verb });
    } catch (error: unknown) {
      logger.error({ msg: `${verb}: the relay at ${anchor} may still be open — ${messageOf({ error })}` });
    }
  }
}

/** A thrown value's message, whatever was thrown. */
function messageOf({ error }: { error: unknown }): string {
  return error instanceof Error ? error.message : String(error);
}
