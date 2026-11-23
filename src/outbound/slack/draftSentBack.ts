/**
 * Which earlier cut of a re-cut the owner already sent back for its receipts — the fact `./draftReceipts.ts` refuses
 * `--self-evident` on.
 *
 * A re-cut of a row the owner had rejected for no receipts can come back saying "got the receipts" with no link and no
 * file in the message.
 *
 * The read is STRUCTURAL: a relay about a cut's card (`post:<sd-id>`) whose triage ruling carries `no-receipts`
 * (`../../talk/triageVocabulary.ts`). The owner's prose is never mined, so a relay written before feedback was a field
 * counts for nothing here. The walk follows `--supersedes` back through every older cut, because a card sent back two
 * re-cuts ago is still a card the owner sent back. Pure.
 *
 * A relay not stated whole (`../../talk/relayCutHold.ts`) still counts here, unlike on the Queue's triage park: a
 * send-back only REFUSES a `--self-evident` claim, so holding a cut one would reopen a send on words that may
 * stop short, to save the cost of declaring receipts.
 */
import { FEEDBACK_VERDICTS, type TriageRuling } from "../../talk/triageVocabulary.js";
import type { SlackDraftItem } from "./draftRegister.js";

/** A relay receipt, as far as this reads one — `../../talk/relayStore.ts`'s `TurnRecord` is one. */
export interface SentBackReceipt {
  readonly about: string;
  readonly triageRuling?: TriageRuling | null | undefined;
}

/**
 * The first cut, along the rows a recording supersedes and every cut each of them re-cut, that a relay sent back for
 * its receipts.
 *
 * @param supersedes the ids `--supersedes` named
 * @param items the folded register
 * @param receipts every relay receipt
 * @returns that cut's id, or `undefined` when none was sent back for receipts
 */
export function sentBackForReceipts({
  supersedes,
  items,
  receipts,
}: {
  supersedes: readonly string[];
  items: readonly SlackDraftItem[];
  receipts: readonly SentBackReceipt[];
}): string | undefined {
  // Feedback counts only beside a verdict that sends the card back: the ledger read refuses any other pairing, and a
  // receipt reaching here another way is held to the same rule rather than read as a send-back.
  const sentBack = new Set(
    receipts
      .filter(
        ({ triageRuling }) =>
          triageRuling?.feedback === "no-receipts" && FEEDBACK_VERDICTS.includes(triageRuling.verdict),
      )
      .map((receipt) => receipt.about),
  );
  if (sentBack.size === 0) {
    return undefined;
  }
  const byId = new Map(items.map((item) => [item.id, item]));
  const seen = new Set<string>();
  const queue = [...supersedes];
  for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    if (sentBack.has(`post:${id}`)) {
      return id;
    }
    const recuts = byId.get(id)?.draft.recuts;
    if (recuts !== undefined) {
      queue.push(...recuts);
    }
  }
  return undefined;
}
