/**
 * What a CHARACTER CAP truncated — the one shape every truncating site in the pipeline reports through.
 *
 * One cap truncates record text before something reads it: the distil prompt
 * ({@link ../gold/recordBody.DISTIL_RECORD_CHARS}). Two others did — the on-device embedder and the answer
 * prompt — and the owner deleted both along with everything else that ranked or
 * encoded. This shape stays general because a cap is a legitimate engineering choice; a SILENT one is not,
 * because a thin answer then has two indistinguishable explanations — the corpus lacked the content, or the
 * pipeline discarded it. Only the first is the user's problem to solve.
 *
 * So each site measures the FULL length before it truncates and reports the difference. Two properties make the
 * number trustworthy:
 *
 *  - **`keptChars + droppedChars` is the total that was offered**, so a reader sees what was cut as a share of
 *    the whole rather than as a bare number that could mean anything.
 *  - **`longest` is reported**, because the mean hides the tail and the tail IS the defect: a corpus where 5%
 *    of records exceed the cap can still lose 40% of its characters to them.
 *
 * Pure — no IO, no clock. The caller supplies lengths; this counts.
 */
import { groupThousands } from "./progressRender.js";

/** What one cap truncated across the records it was applied to. */
export interface Truncation {
  /** The cap, in characters. */
  readonly cap: number;
  /** How many records the cap was applied to. */
  readonly measured: number;
  /** How many of them exceeded the cap and were truncated. */
  readonly truncated: number;
  /** Characters that survived the cap. */
  readonly keptChars: number;
  /** Characters the cap discarded — `0` means nothing was lost. */
  readonly droppedChars: number;
  /** The longest record offered, in characters, so how far past the cap the tail reaches is visible. */
  readonly longest: number;
}

/**
 * Tally what a cap truncated, from the FULL lengths of the records it was applied to.
 *
 * Takes lengths rather than the strings themselves so a caller measuring a whole corpus is not asked to hold it
 * twice — these sites run over hundreds of thousands of records.
 *
 * @param cap the cap in characters
 * @param lengths each record's length BEFORE truncation
 * @returns the tally; an empty input yields all-zero counts rather than an absent report, so "nothing was
 *   measured" and "nothing was truncated" stay tellable apart by `measured`
 */
export function truncationAtCap({ cap, lengths }: { cap: number; lengths: readonly number[] }): Truncation {
  let truncated = 0;
  let keptChars = 0;
  let droppedChars = 0;
  let longest = 0;
  for (const length of lengths) {
    keptChars += Math.min(length, cap);
    longest = length > longest ? length : longest;
    if (length > cap) {
      truncated += 1;
      droppedChars += length - cap;
    }
  }
  return { cap, droppedChars, keptChars, longest, measured: lengths.length, truncated };
}

/** A ratio in [0,1] as a one-decimal percent string. Pure. */
function pct({ ratio }: { ratio: number }): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

/**
 * One human line for a cap that truncated something, or `undefined` when it truncated nothing.
 *
 * `undefined` rather than an empty string, and rather than a "0 lost" line: a cap that truncated nothing is not
 * news, and a per-query line saying so would train the reader to skip the line that matters.
 *
 * @param label what was truncated, and where — the caller names its own cap so one phrasing serves all three
 * @param truncation the tally from {@link truncationAtCap}
 * @param capNoun what the cap counts, when "chars" alone would misdescribe it. The distil lane spends its
 *   cap as a per-BATCH budget, so a bare "at 1,200 chars" would tell a reader every record was cut at 1,200
 *   when one of them may have been prompted whole at 5,000. Defaults to "chars".
 * @returns the line, or `undefined` when the cap truncated nothing
 */
export function truncationLine({
  label,
  truncation,
  capNoun = "chars",
}: {
  label: string;
  truncation: Truncation;
  capNoun?: string;
}): string | undefined {
  if (truncation.droppedChars === 0) {
    return undefined;
  }
  const offered = truncation.keptChars + truncation.droppedChars;
  return [
    `truncated: ${label} cut ${groupThousands({ value: truncation.truncated })} of ${groupThousands({ value: truncation.measured })} record(s)`,
    `at ${groupThousands({ value: truncation.cap })} ${capNoun} —`,
    `${groupThousands({ value: truncation.droppedChars })} of ${groupThousands({ value: offered })} char(s)`,
    `(${pct({ ratio: truncation.droppedChars / offered })}) never reached it;`,
    `longest record ${groupThousands({ value: truncation.longest })} chars`,
  ].join(" ");
}

/**
 * The lines for several caps at once, dropping the ones that truncated nothing and the ones that never ran.
 *
 * A cap that never ran is `undefined` rather than a zero tally — `--no-semantic` means the embedder was not
 * asked, which is a different fact from an embedder that truncated nothing, and reporting them the same way
 * would let a skipped cap read as a clean one.
 *
 * @param entries one `{ label, truncation }` per cap, in the order they should print
 * @returns the non-empty lines, in entry order
 */
export function truncationLines({
  entries,
}: {
  entries: readonly { readonly label: string; readonly truncation: Truncation | undefined }[];
}): readonly string[] {
  return entries.flatMap((entry) => {
    const line =
      entry.truncation === undefined ? undefined : truncationLine({ label: entry.label, truncation: entry.truncation });
    return line === undefined ? [] : [line];
  });
}
