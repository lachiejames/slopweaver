/**
 * The reader for `SLOPWEAVER_HEAP_PHASES` output — the phase instrument generalised from the one gate that
 * grew it to any subject that carries it.
 *
 * The instrument prints a line per phase, and the profiler is the thing that finally READS those lines
 * rather than leaving them for a human to eyeball. The format is deliberately unchanged: it is quoted in
 * `src/devLint/namedObjectParamsHeap.ts`'s measurement history and in `docs/toolchain/profiling.md`, and a profiler
 * that forced a new wire format would have invalidated every recorded measurement to gain nothing.
 *
 * **Parsed by splitting, not by a regular expression.** The label may contain spaces and is padded to a
 * fixed width, so the natural pattern is a lazy `.+?` against a `\s+` run — which is the ambiguous shape
 * `redos-check` refuses, and rightly: this parser's input is a subprocess's whole output, including
 * whatever a failing gate printed. Splitting has no backtracking to exploit.
 *
 * Reproduce the input:
 * `SLOPWEAVER_HEAP_PHASES=1 yarn tsx --expose-gc --max-old-space-size=8192 src/devLint/namedObjectParams.entry.ts`
 */

/** One phase mark the subject printed: where it had got to, and what it was holding there. */
export interface PhaseReading {
  /** The subject that printed the mark — the first word of the line, e.g. `named-object-params`. */
  readonly subject: string;
  /** The phase just completed. */
  readonly label: string;
  /** Post-GC live heap in MiB, or `undefined` when the subject ran without `--expose-gc`. */
  readonly liveMib: number | undefined;
}

/** What separates the subject from the rest of a phase line. */
const MARKER = " phase: ";

/** The tail a measured line ends in. */
const MIB_SUFFIX = " MiB";

/** The tail an unmeasured line ends in — the subject ran without `--expose-gc`. */
const UNMEASURED_SUFFIX = "unmeasured (no --expose-gc)";

/**
 * One phase line, or `undefined` when the line is not one.
 *
 * @param line one line of the subject's output, already right-trimmed
 * @returns the reading, or `undefined`
 */
function readPhaseLine({ line }: { line: string }): PhaseReading | undefined {
  const at = line.indexOf(MARKER);
  if (at < 0) {
    return undefined;
  }
  const subject = line.slice(0, at);
  if (subject === "" || subject.includes(" ")) {
    return undefined;
  }
  const rest = line.slice(at + MARKER.length);
  if (rest.endsWith(UNMEASURED_SUFFIX)) {
    return { label: rest.slice(0, rest.length - UNMEASURED_SUFFIX.length).trim(), liveMib: undefined, subject };
  }
  if (!rest.endsWith(MIB_SUFFIX)) {
    return undefined;
  }
  const withoutUnit = rest.slice(0, rest.length - MIB_SUFFIX.length);
  const split = withoutUnit.lastIndexOf(" ");
  if (split < 0) {
    return undefined;
  }
  const digits = withoutUnit.slice(split + 1);
  if (digits === "" || !/^\d+$/u.test(digits)) {
    return undefined;
  }
  return { label: withoutUnit.slice(0, split).trim(), liveMib: Number(digits), subject };
}

/**
 * Every phase mark in a subject's captured output, in the order it printed them.
 *
 * Lines that are not phase marks are skipped rather than refused: the subject is a real gate or lane whose
 * own output is interleaved with these, and a parser that insisted on a clean stream would report nothing
 * for every real subject.
 *
 * @param text the subject's combined stdout and stderr
 * @returns the marks, in print order
 */
export function parsePhaseLines({ text }: { text: string }): readonly PhaseReading[] {
  return text.split("\n").flatMap((line) => {
    const reading = readPhaseLine({ line: line.trimEnd() });
    if (reading === undefined) {
      return [];
    }
    return [reading];
  });
}

/**
 * The heap a run PEAKED at across its phases, which is the number a ceiling has to clear.
 *
 * The last phase is not it: a subject that drops a large structure before finishing settles below its own
 * high-water mark, and budgeting from the final reading would under-budget by exactly the thing that made
 * it survive.
 *
 * @param readings every phase mark the subject printed
 * @returns the highest measured phase in MiB, or `undefined` when no phase could be measured
 */
export function peakPhaseMib({ readings }: { readings: readonly PhaseReading[] }): number | undefined {
  const measured = readings.flatMap((reading) => (reading.liveMib === undefined ? [] : [reading.liveMib]));
  if (measured.length === 0) {
    return undefined;
  }
  return Math.max(...measured);
}
