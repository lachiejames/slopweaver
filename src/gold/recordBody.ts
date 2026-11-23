/**
 * The record body distil actually PROMPTS with — split out from `distil.ts` so `distilGroup.ts`'s
 * `hashBatch` can hash exactly this text without a cycle (`distil.ts` already imports `distilGroup.ts`
 * for `DistilBatch`/`BATCHING_SCHEME`).
 */
import type { CorpusRecord } from "../corpus/types.js";

/**
 * The per-record SHARE that sets a batch's character budget: a batch of `n` records may spend
 * `n * DISTIL_RECORD_CHARS` characters on bodies in total.
 *
 * It is a share rather than a per-record cap because a flat cap spends the budget badly. Every record is
 * clipped at the same point no matter how many there are, so a batch of short records leaves most of its
 * budget unspent while the long record beside them — the 27,000-character pull request carrying the
 * reasoning worth distilling — is cut at 1,200. Measured over a whole corpus (hundreds of thousands of
 * records in over ten thousand batches), spending it by {@link promptBodies}'s water-filling instead recovers
 * about a fifth of everything the flat cap discarded, and leaves tens of thousands of records whole that the
 * flat cap truncated.
 *
 * **That is not free.** The per-batch CEILING is unchanged — no prompt can exceed `n * DISTIL_RECORD_CHARS`,
 * exactly as under the flat cap — but the flat cap routinely left that ceiling unspent, because a short
 * record could not lend its unused share to a long one. Water-filling spends up to the ceiling whenever the
 * batch has the text to fill it, so real prompts grow: measured through `distil status` on one real batch,
 * a couple of percent more characters, and across the corpus the kept total rises by about a fifth. Distil is
 * the one verb that spends tokens, so read this as buying back discarded evidence at roughly a fifth more
 * prompt, not as a free win.
 *
 * It is NOT part of the distil contract fingerprint — changing this constant does not change `SYSTEM`,
 * `DIGEST_SCHEMA` or `BATCHING_SCHEME`. It does change the text `hashBatch` hashes, so a change invalidates
 * the affected batches through the content hash rather than silently reusing a digest built from other text.
 */
export const DISTIL_RECORD_CHARS = 1200;

/**
 * The FULL, uncapped body of a record block. The single expression every cap measures and clips, so what
 * gets reported as truncated can never drift from what was actually discarded.
 *
 * @param record the record to render
 * @returns the title (if any) and text, joined by a newline
 */
export function recordBody({ record }: { record: CorpusRecord }): string {
  return [record.title, record.text].filter((part) => part !== undefined).join("\n");
}

/** One record's share of the batch budget, and what that share cost it. */
export interface PromptBody {
  /** The text the prompt carries — the leading `keptChars` characters of {@link recordBody}. */
  readonly body: string;
  /** Characters that reached the prompt. */
  readonly keptChars: number;
  /** Characters the budget discarded — `0` means this record was prompted whole. */
  readonly droppedChars: number;
}

/**
 * Spend a batch's budget across its records, smallest need first, redistributing what each record does not
 * use to the ones still wanting more.
 *
 * Smallest-first is what makes this never worse than a flat cap rather than merely different: a record
 * needing less than an equal share takes only what it needs, and every character it leaves is re-divided
 * among the records still short. No record ever receives LESS than the flat cap would have given it, because
 * the first share handed out is already the whole budget divided by the record count.
 *
 * The order is total — need ascending, then position — deliberately. This text is the distil cache key
 * (see `distilGroup.hashBatch`), and a key that depended on how two equal-length records happened to sort
 * would be a silent re-spend, the exact defect class that module exists to close.
 *
 * @param records the batch's records, in the order they were grouped
 * @returns one entry per record, in the SAME order as `records`
 */
export function promptBodies({ records }: { records: readonly CorpusRecord[] }): readonly PromptBody[] {
  const full = records.map((record) => recordBody({ record }));
  const order = full
    .map((text, index) => ({ index, need: text.length }))
    .toSorted((a, b) => a.need - b.need || a.index - b.index);
  const allowance: number[] = Array.from({ length: full.length }, () => 0);
  let left = full.length * DISTIL_RECORD_CHARS;
  let waiting = order.length;
  for (const { index, need } of order) {
    const give = Math.min(need, Math.floor(left / waiting));
    allowance[index] = give;
    left -= give;
    waiting -= 1;
  }
  return full.map((text, index) => {
    // `allowance` was built dense at `full.length` and `index` walks `full`, so every slot is there.
    const kept = allowance[index]!;
    return { body: text.slice(0, kept), droppedChars: text.length - kept, keptChars: kept };
  });
}
