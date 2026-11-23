/**
 * The check `handover ask` makes on the row and its journal just before either write path appends: the settled-row
 * refusal, then the later-owner-words refusal over a fresh read of the `talk-*` rows (`./askLaterOwnerWords.ts`),
 * then the ruled re-ask refusal over the journal re-read at that instant.
 *
 * The verb judges a same-words re-ask once at its top, off the journal it resolved, and a sign-in can be awaited
 * between that and the append — a ruling the owner gives in that gap would otherwise be missed. **The residue,
 * stated**: a ruling takes no row lock, so one appended between this re-read and the append still lands unrefused. The
 * Queue loses nothing to it: the card is derived from the whole journal at each read
 * (`../../../handover/heldQuestion.ts`), so the question still draws as a check-in carrying that ruling. Only the
 * asking session's refusal is missed.
 */

import { ruledReaskVerdict } from "../../../handover/ruledReaskGate.js";
import { readRunJournal } from "../../../handover/runStore.js";
import { SETTLED_ASK_CHECK } from "../../../handover/settledAsk.js";
import type { FreshCheck } from "./appendUnlessRefused.js";
import { freshLaterOwnerWordsRefusal } from "./askLaterOwnerWords.js";
import { nowIso } from "./lifecycleRunCore.js";

/**
 * The settled-row check with the later-owner-words and ruled re-ask checks joined on, all judged at the append.
 *
 * @param runsDir where the run's journal is re-read from
 * @param handoverDir the board the `talk-*` rows are re-read from
 * @param slug the run asking
 * @param question the trimmed question about to be written
 * @param readOwnerWords the slugs the seat named in `--read-owner-words`
 * @param env the environment the ruled re-ask hatch is read from
 * @returns the fresh check both of `handover ask`'s write paths hand their append
 */
export function askFreshCheck({
  env,
  handoverDir,
  question,
  readOwnerWords,
  runsDir,
  slug,
}: {
  env: NodeJS.ProcessEnv;
  handoverDir: string;
  question: string;
  readOwnerWords: readonly string[];
  runsDir: string;
  slug: string;
}): FreshCheck {
  return {
    lockWhen: SETTLED_ASK_CHECK.lockWhen,
    refusal: ({ doc }) => {
      const settled = SETTLED_ASK_CHECK.refusal({ doc });
      if (settled !== undefined) {
        return settled;
      }
      const later = freshLaterOwnerWordsRefusal({ doc, handoverDir, read: readOwnerWords });
      if (later !== undefined) {
        return later;
      }
      const journal = readRunJournal({ runsDir, slug });
      if (journal.isErr()) {
        return [
          `cannot re-read ${slug}'s journal to check the owner's rulings before the write: ${journal.error.message}`,
        ];
      }
      const verdict = ruledReaskVerdict({
        askedIso: nowIso(),
        command: "slopweaver handover ask",
        env,
        events: journal.value.events,
        question,
      });
      if (verdict.kind === "refused") {
        return verdict.lines;
      }
      return undefined;
    },
  };
}
