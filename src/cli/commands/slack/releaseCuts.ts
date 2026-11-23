/**
 * What a release does to the OTHER held cuts of its message: choose them before the send ({@link releaseHeldCuts}),
 * naming each cut it keeps, and spend them once it lands ({@link spendHeldCuts}). Only a cut the register records as
 * this message is spent; one that merely opens alike may carry their yes, and stays held
 * (`../../../outbound/slack/draftSpent.ts`'s `releaseSpendsCuts`, round 26).
 */
import { logger } from "../../../lib/logger.js";
import type { ParkedSlackDraft, SlackDraftItem } from "../../../outbound/slack/draftRegister.js";
import { keptCutNote, releaseSpendsCuts } from "../../../outbound/slack/draftSpent.js";
import type { SlackWriteDeps } from "./run.js";

/**
 * The held cuts a release of this row spends once it lands, printing a line for each cut it keeps held.
 *
 * @param draft the row being released
 * @param items every folded row
 * @returns the ids to spend
 */
export function releaseHeldCuts({
  draft,
  items,
}: {
  draft: SlackDraftItem;
  items: readonly SlackDraftItem[];
}): readonly string[] {
  const cuts = releaseSpendsCuts({ draft, items });
  for (const kept of cuts.kept) {
    logger.info({ msg: keptCutNote({ id: draft.id, kept: kept.id }) });
  }
  return cuts.spend.map((item) => item.id);
}

/**
 * Drop every held cut a message that just landed spends, each with a note naming the released row, so no card or
 * seat can send an older cut. A failed drop is named with the command that spends it, and the rest still run.
 *
 * @param draft the released row the notes name as the successor
 * @param heldCuts the cuts {@link releaseHeldCuts} chose
 * @param home the state home the register lives under
 * @param ts the landed message's own Slack timestamp, quoted in each note
 * @returns whether every cut was spent
 */
export function spendHeldCuts({
  deps,
  draft,
  heldCuts,
  home,
  ts,
}: {
  deps: Pick<SlackWriteDeps, "appendDraftEvent">;
  draft: ParkedSlackDraft;
  heldCuts: readonly string[];
  home: string;
  ts: string;
}): boolean {
  let spendFailed = false;
  for (const cut of heldCuts) {
    const note = `superseded by ${draft.id}, released as ${draft.channel} ${ts} — the same message`;
    const dropped = deps.appendDraftEvent({
      event: { id: cut, kind: "dropped", note, tsIso: new Date().toISOString() },
      home,
    });
    if (dropped.isErr()) {
      spendFailed = true;
      logger.error({
        msg:
          `${dropped.error.message} — held cut ${cut} of the message ${draft.id} just released is still offered. ` +
          `Spend it: slopweaver slack draft drop ${cut} --note "${note}"`,
      });
      continue;
    }
    logger.info({ msg: `spent ${cut}: another held cut of the message ${draft.id} released` });
  }
  return !spendFailed;
}
