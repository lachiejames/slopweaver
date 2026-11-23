/**
 * What every `perf` verb shares: the flag spec, the window parse, and the one reading all three take.
 *
 * Effectful shell only. The whole decision — what is stalled, what to react to, how it prints — is
 * `src/live/perf/`, which is pure and unit-tested.
 */
import { logger } from "../../../lib/logger.js";
import type { HookStreamReading } from "../../../live/perf/hookStream.js";
import { DEFAULT_WINDOW_MINUTES, type PerfDeps, productionPerfDeps, readPerf } from "../../../live/perf/read.js";
import type { PerfReport } from "../../../live/perf/report.js";
import { type FlagSpec, type ParsedFlags, parseFlags } from "../../parseFlags.js";

/*
 * The flag names are declared as literals and the spec is built FROM them, rather than the reverse. Reading
 * them back off the spec needs a fallback for each optional field, and `no-silent-fallback` bans exactly
 * the operator that reads most naturally there — so the arrays are the source and neither list can drift.
 */
const PERF_STRING_FLAGS = ["window-minutes"] as const;
const PERF_BOOLEAN_FLAGS = ["json"] as const;

/** The flags every `perf` verb takes. */
const PERF_FLAGS: FlagSpec = {
  boolean: [...PERF_BOOLEAN_FLAGS],
  string: [...PERF_STRING_FLAGS],
};

/** `--`-prefixed, for the help-truth ratchet. */
export const PERF_FLAG_NAMES: readonly string[] = [...PERF_STRING_FLAGS, ...PERF_BOOLEAN_FLAGS]
  .map((name) => `--${name}`)
  .toSorted();

/**
 * Parse a `perf` verb's flags. Exported so the help-truth ratchet probes the REAL parser.
 *
 * @param rest the argv tail after the verb
 * @param allowPositionals true for the drill-downs, which take a seat or a hook by name; false for the
 *   summary, where a stray token is a typo that must not be silently ignored
 * @returns the parsed flags, or the parse errors
 */
export function parsePerfArgs({
  rest,
  allowPositionals = false,
}: {
  rest: readonly string[];
  allowPositionals?: boolean;
}): ReturnType<typeof parseFlags> {
  return parseFlags({ allowPositionals, args: rest, spec: PERF_FLAGS });
}

/**
 * `--window-minutes`, resolved to its default rather than to zero — a window of nought would report every
 * seat as unmeasured while looking like a successful read.
 *
 * A value this refuses to honour is SAID OUT LOUD on stderr rather than quietly replaced. stderr, not stdout, so `--json` stays one parseable document either way.
 *
 * @param values the parsed flag values
 * @returns the window in minutes
 */
export function windowMinutesOf({ values }: { values: ParsedFlags["values"] }): number {
  const raw = values["window-minutes"];
  if (typeof raw !== "string") {
    return DEFAULT_WINDOW_MINUTES;
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    logger.error({
      msg:
        `perf: --window-minutes ${raw} is not a positive whole number, so this reading covers ` +
        `${String(DEFAULT_WINDOW_MINUTES)} minutes instead`,
    });
    return DEFAULT_WINDOW_MINUTES;
  }
  return parsed;
}

/**
 * Take the reading every `perf` verb prints from.
 *
 * @param windowMinutes how far back the stream half folds
 * @param deps the injected seams, defaulting to the real machine and the real cmux log
 * @returns the report and the stream fold
 */
export function perfReading({
  windowMinutes,
  deps = productionPerfDeps(),
}: {
  windowMinutes: number;
  deps?: PerfDeps;
}): { readonly report: PerfReport; readonly stream: HookStreamReading } {
  return readPerf({ deps, windowMinutes });
}
