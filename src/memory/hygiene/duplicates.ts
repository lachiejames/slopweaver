/**
 * CHECK 3 — the mechanical near-duplicate scan. Pure: leaves in, pairs out.
 *
 * ## The threshold is a measurement, not a taste
 *
 * The manual pass ran token Jaccard over descriptions and slugs at **0.42** and found exactly
 * four real pairs on the corpus as it then stood. That is the number, and it carries its own repro rather
 * than a date:
 *
 * ```bash
 * slopweaver memory hygiene --dir "$HOME/.claude/projects/<project>/memory" --repo "$PWD" --json \
 *   | jq '[.proposals[] | select(.check == "duplicate")] | length'
 * ```
 *
 * Raise it and real pairs disappear; lower it and every memory about the same platform pairs with every
 * other. It is a `--`-flag on purpose NOWHERE: a threshold a caller can retune is a threshold nobody ever
 * measures again.
 *
 * ## Jaccard over the RARE tokens, which is the part that makes it work
 *
 * Plain Jaccard over every word pairs two memories for sharing `slopweaver`, `owner` and `session`. So the
 * token sets are filtered through `#lib/rareTokens.js`'s document-frequency index first, and what is left is
 * vocabulary that genuinely distinguishes one memory from another.
 *
 * **The ceiling is this check's own, and borrowing `crossRef`'s broke it.** See
 * {@link duplicateMaxFrequency}: a share alone cannot express what this scan needs, because a token shared by
 * exactly TWO memories is the duplicate signal itself.
 *
 * ## Description AND slug, because either alone is wrong
 *
 * The description is the field retrieval matches on, so two memories with near-identical descriptions are
 * two memories that will be recalled together forever. The slug is what the corpus ROUTES on, and a slug
 * carries words a terse description omits. Both are folded into one text per leaf; weighting them separately
 * would be a dial with nothing measuring it.
 *
 * ## Deliberately NOT read: the body
 *
 * Two memories quoting the same owner ruling share a paragraph and are not duplicates — one may be the
 * ruling and the other its application. Measured on this corpus, bodies are where the shared verbatim
 * quotations live, so including them manufactures pairs out of correct cross-referencing. The body is
 * evidence a human reads once a pair is proposed, never an input to proposing one.
 */
import { type CoverageSource, distinctiveTokens, indexSources } from "#lib/rareTokens.js";
import type { MemoryLeaf } from "../types.js";
import { memorySubjectText } from "./subjectText.js";

/**
 * The Jaccard similarity two memories' rare vocabularies must reach before they are called a near-duplicate.
 *
 * MEASURED: 0.42 over descriptions and slugs found exactly four real pairs on that corpus. See this
 * module's header for the repro that re-measures it.
 *
 * @internal
 */
export const DUPLICATE_JACCARD = 0.42;

/**
 * The largest share of the corpus a token may appear in and still distinguish one memory from another.
 *
 * A quarter, where `crossRef` uses a tenth, and the difference is not a preference — a tenth makes this check
 * incapable of ever firing. MEASURED on the live 19-memory corpus: at 0.1 the ceiling is 1.9, so a token
 * present in exactly two memories is ruled TOO COMMON — and a token present in exactly two memories is
 * precisely what a duplicate pair shares. The scan returned zero pairs on a corpus, and would have on every
 * corpus, while looking like a clean result.
 *
 * @internal
 */
export const DUPLICATE_MAX_FREQUENCY = 0.25;

/**
 * The fewest memories a token must appear in before the share can rule it out.
 *
 * Two, and it is a FLOOR on the ceiling rather than a second filter. On a small corpus a quarter is less than
 * two documents — three memories give a ceiling of 0.75 — so the share alone would again exclude the pair it
 * is looking for. Below this count the scan has nothing to be right about anyway: a token in one memory cannot
 * be shared.
 *
 * @internal
 */
export const DUPLICATE_FREQUENCY_FLOOR = 2;

/**
 * The document-frequency share to index this corpus at.
 *
 * Raised for a small corpus so that {@link DUPLICATE_FREQUENCY_FLOOR} documents are never "too common" —
 * see both constants for why a bare share is the wrong shape here.
 *
 * @param count how many memories are being compared
 * @returns the share to pass to `indexSources`
 */
export function duplicateMaxFrequency({ count }: { count: number }): number {
  if (count === 0) {
    return DUPLICATE_MAX_FREQUENCY;
  }
  return Math.max(DUPLICATE_MAX_FREQUENCY, DUPLICATE_FREQUENCY_FLOOR / count);
}

/** One pair the scan believes is the same fact written twice. */
export interface DuplicatePair {
  /** The two basenames, sorted, so a pair reads the same however the corpus was iterated. */
  readonly files: readonly [string, string];
  /** The similarity, rounded to two places for printing. The unrounded value decides; this one is displayed. */
  readonly similarity: number;
  /** The rare tokens both carry, sorted — the evidence a reader checks the pair against. */
  readonly sharedTokens: readonly string[];
}

/** Jaccard over two sets: shared over union. Zero when both are empty — no evidence is not similarity. */
function jaccard({ left, right }: { left: ReadonlySet<string>; right: ReadonlySet<string> }): number {
  const union = new Set([...left, ...right]);
  if (union.size === 0) {
    return 0;
  }
  let shared = 0;
  for (const token of left) {
    if (right.has(token)) {
      shared += 1;
    }
  }
  return shared / union.size;
}

/** Every token in both sets, sorted. */
function sharedOf({ left, right }: { left: ReadonlySet<string>; right: ReadonlySet<string> }): readonly string[] {
  return [...left].filter((token) => right.has(token)).toSorted();
}

/**
 * Every pair of memories whose rare vocabularies overlap past {@link DUPLICATE_JACCARD}.
 *
 * @param leaves the corpus's leaves
 * @param threshold the similarity to require, defaulting to the measured one
 * @returns each pair once, ordered by similarity descending then by filename, so the output is deterministic
 */
export function findDuplicatePairs({
  leaves,
  threshold = DUPLICATE_JACCARD,
}: {
  leaves: readonly MemoryLeaf[];
  threshold?: number;
}): readonly DuplicatePair[] {
  const sources: readonly CoverageSource[] = leaves.map((leaf) => ({
    id: leaf.file,
    text: memorySubjectText({ leaf }),
  }));
  const { tooCommon } = indexSources({ maxFrequency: duplicateMaxFrequency({ count: leaves.length }), sources });
  const rare = sources.map((source) => {
    const tokens = distinctiveTokens({ text: source.text });
    return new Set([...tokens].filter((token) => !tooCommon.has(token)));
  });
  const pairs: DuplicatePair[] = [];
  for (const [left, leftLeaf] of leaves.entries()) {
    for (let right = left + 1; right < leaves.length; right += 1) {
      // Safe: both indices come from the same array the token sets were built from, index-aligned.
      const leftTokens = rare[left]!;
      const rightTokens = rare[right]!;
      const similarity = jaccard({ left: leftTokens, right: rightTokens });
      if (similarity < threshold) {
        continue;
      }
      const rightLeaf = leaves[right]!;
      const files = [leftLeaf.file, rightLeaf.file].toSorted();
      pairs.push({
        // Safe: `files` was built from two elements, so both indices are present.
        files: [files[0]!, files[1]!],
        sharedTokens: sharedOf({ left: leftTokens, right: rightTokens }),
        similarity: Math.round(similarity * 100) / 100,
      });
    }
  }
  return pairs.toSorted((a, b) => b.similarity - a.similarity || a.files[0].localeCompare(b.files[0]));
}
