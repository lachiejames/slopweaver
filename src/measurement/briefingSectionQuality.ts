/**
 * HOW EVERY SECTION OF THE BRIEFING READ before the card gate was widened to cover it.
 *
 * The owner ruled for the card-quality gate and asked that the rest of the page follow the same way of writing,
 * which is easier to read. This is the measurement that decided which rules could travel and which would have
 * reversed a standing ruling, and it is committed so `../briefing/sectionQuality.ts` and `../briefing/caps.ts`
 * cite a command rather than a memory:
 *
 * ```
 * yarn tsx src/measurement/briefingSectionQuality.entry.ts \
 *   --forms '~/.slopweaver/supervisor-scratch/handoff-*\/form.json'
 * ```
 *
 * Over the 156 forms this install had rendered when it was taken, per CELL:
 *
 * ```text
 *   cell                     n     median words  max   over 60w      unglossed fleet word
 *   card `what` (gated)      726   52            60    0             42, every one pre-gate
 *   header lede              156   64            155   79 (51%)      50 (32%)
 *   recent note headline     627   93            157   589 (94%)     292 (47%)
 *   earlier-today headline   2867  95            162   2857 (99.7%)  1844 (64%)
 *   history note headline    2432  12            29    0             0
 *   alignment headline       156   38            50    0             0
 *   awaiting waiting-on      179   22            29    0             0
 * ```
 *
 * `ranked ask` and `your-list headline` are absent from the table because no form in the window carried
 * either — the two sections are schema-only on this install today, which is itself the reading: their rules
 * are the ones nothing has been able to break yet.
 *
 * The gated cell is in the table on purpose: it is the control. `what` is capped at 60 words and its measured
 * maximum is 60, while the two cells with no cap at all ran to 157 and 162 — which is the gate working, and
 * is why the LENGTH half of this reading was not what travelled.
 *
 * Pure — the entry point does the reading.
 */
import { absentAsNumber } from "#lib/absent.js";
import { ungloss } from "../briefing/fleetJargon.js";
import { sentenceCount, wordCount } from "../briefing/text.js";

/** One composed cell of one form, as the text a reader meets in it. */
export interface MeasuredCell {
  /** Which cell of the form it is — `header lede`, `recent note headline`. */
  readonly cell: string;
  readonly text: string;
}

/** What one cell measured. */
export interface MeasuredCellReading {
  readonly cell: string;
  readonly words: number;
  readonly sentences: number;
  /** The fleet word it used and never explained, absent when it explained every one. */
  readonly unglossed: string | undefined;
}

/** What one kind of cell measured across every form. */
export interface MeasuredCellKind {
  readonly cell: string;
  readonly count: number;
  readonly medianWords: number;
  readonly maxWords: number;
  /** How many ran past the cap a card's `what` carries, which is the comparison the reading is against. */
  readonly overWhatCap: number;
  readonly unglossed: number;
  /** The first few phrases the vocabulary rule caught, so a reader can see what kind of word it is. */
  readonly examples: readonly string[];
}

/** The cap a card's `what` carries, restated as the comparison rather than imported as a rule. */
const WHAT_CAP_WORDS = 60;

/** How many example phrases one cell kind reports. */
const EXAMPLES = 4;

/**
 * Measure one cell.
 *
 * @param cell the cell's kind and text
 * @returns its length and whether it used a fleet word it never explained
 */
export function measureCell({ cell }: { cell: MeasuredCell }): MeasuredCellReading {
  const found = ungloss({ aboveFold: cell.text });
  return {
    cell: cell.cell,
    sentences: sentenceCount({ text: cell.text }),
    unglossed: found === undefined ? undefined : `"${found.used}" (${found.term})`,
    words: wordCount({ text: cell.text }),
  };
}

/**
 * The middle value of a sorted list, which is the statistic the reading quotes.
 *
 * @param values every reading, in any order
 * @returns the median, or 0 over an empty list
 */
function median({ values }: { values: readonly number[] }): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].toSorted((left, right) => left - right);
  return absentAsNumber({ value: sorted[Math.floor(sorted.length / 2)], whenAbsent: 0 });
}

/**
 * Roll every cell up by kind, which is the table the file overview quotes.
 *
 * @param readings every cell measured, across every form
 * @returns one row per kind, in alphabetical order so two runs can be diffed
 */
export function measuredKinds({ readings }: { readings: readonly MeasuredCellReading[] }): readonly MeasuredCellKind[] {
  const kinds = [...new Set(readings.map((reading) => reading.cell))].toSorted();
  return kinds.map((cell) => {
    const own = readings.filter((reading) => reading.cell === cell);
    const words = own.map((reading) => reading.words);
    const caught = own.flatMap((reading) => (reading.unglossed === undefined ? [] : [reading.unglossed]));
    return {
      cell,
      count: own.length,
      examples: [...new Set(caught)].slice(0, EXAMPLES),
      maxWords: words.reduce((most, value) => Math.max(most, value), 0),
      medianWords: median({ values: words }),
      overWhatCap: words.filter((value) => value > WHAT_CAP_WORDS).length,
      unglossed: caught.length,
    };
  });
}

/**
 * The report, one line per cell kind.
 *
 * @param kinds what {@link measuredKinds} rolled up
 * @returns the lines to print, in order
 */
export function renderMeasurement({ kinds }: { kinds: readonly MeasuredCellKind[] }): readonly string[] {
  return kinds.map(
    (kind) =>
      `${kind.cell.padEnd(24)} n=${String(kind.count).padStart(5)} median=${String(kind.medianWords).padStart(3)} ` +
      `max=${String(kind.maxWords).padStart(4)} over${String(WHAT_CAP_WORDS)}w=${String(kind.overWhatCap).padStart(5)} ` +
      `unglossed=${String(kind.unglossed).padStart(5)}  ${kind.examples.join(", ")}`,
  );
}
