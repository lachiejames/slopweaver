/**
 * The draft of the card the owner's words began over, as a starting Codex turn is handed it so a read-back costs no tool
 * call. "What is the reply?" over a held Slack reply otherwise takes a context pack, two reads and three card tools
 * before the voice reads the owner a paraphrase. The card already holds the words; this hands them over first.
 */
import { rowForOpen } from "./queueOpen";
import type { QueueRow } from "./queueRows";
import { cardForVoice } from "./queueVoice";
import type { OpenCardDraft } from "./talkVoiceRecord";

/**
 * The draft of one card, by the key the owner's words began over.
 *
 * @param key the `?open=` key the owner's utterance was stamped with, or `undefined` when no card was open
 * @param rows the Queue's rows as the page holds them
 * @returns A and B while the owner's pick is owed, the one draft on any other post card, and `undefined` — by design, not a
 *   fallback — when no card was open, the key matches no row, or the card is not a post
 */
export function openCardDraftForVoice({
  key,
  rows,
}: {
  key: string | undefined;
  rows: readonly QueueRow[];
}): OpenCardDraft | undefined {
  if (key === undefined) {
    return undefined;
  }
  const row = rowForOpen({ open: key, rows });
  if (row === undefined) {
    return undefined;
  }
  const card = cardForVoice({ row });
  // `.at`, so an absent A or B reads as absent under either tsconfig, `site/` having no `noUncheckedIndexedAccess`.
  const a = card.drafts.at(0);
  const b = card.drafts.at(1);
  if (a !== undefined && b !== undefined) {
    return { drafts: [a, b], key: row.key, kind: "comparison" };
  }
  if (card.draft === undefined || card.draft.length === 0) {
    return undefined;
  }
  return { draft: card.draft, key: row.key, kind: "single" };
}
