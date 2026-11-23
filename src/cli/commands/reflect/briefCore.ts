/**
 * The PURE core of `slopweaver reflect brief`: its usage line, its one flag spec, and its flag parsing.
 *
 * Lives beside `core.ts` rather than in it because the two verbs share no options — `telemetry` reads
 * Datadog and this reads local files — and a shared options module would be a place for one verb's flag to
 * drift into the other's help. Everything that renders a brief is in `src/reflect/brief.ts`, which is where
 * a reader looking for the shape should go.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import { SURFACE_CAP } from "../../../reflect/rank.js";
import { flagValueOr, parseFlagTail, parsePositiveInteger } from "../../optionParsers.js";

/**
 * The window start used when the caller states none — the loop's own daily cadence. Always printed.
 *
 * @internal
 */
export const REFLECT_BRIEF_DEFAULT_FROM = "24h";

/**
 * The one flag spec the verb parses with, exported so `helpTruth.test.ts` probes the REAL list rather than
 * a copy of it.
 *
 * @internal
 */
export const REFLECT_BRIEF_FLAG_SPEC = {
  boolean: ["json", "write", "dry-run"],
  value: ["from", "to", "cap"],
} as const satisfies { boolean: readonly string[]; value: readonly string[] };

/**
 * The rejection `--write --dry-run` earns, exported so the test asserts the shipped sentence.
 *
 * The two flags are the ends of one axis, so a caller passing both has stated no intention a run could
 * satisfy. Picking one silently is the shape this repo refuses everywhere else.
 *
 * @internal
 */
export const REFLECT_BRIEF_WRITE_DRY_RUN_CONFLICT =
  "--write and --dry-run are opposites: --write persists the day's report, --dry-run persists nothing";

/**
 * The validated invocation for `reflect brief`.
 *
 * @internal
 */
export interface ReflectBriefOptions {
  readonly from: string;
  readonly to: string;
  /** The most findings that may reach the owner. Defaults to the design's five. */
  readonly cap: number;
  readonly json: boolean;
  /**
   * Also persist the day's report to `$home/morning`, where `reflect friction-review` reads it.
   *
   * Off by default, so every hand-run stays a read. The standing recipe row is what passes it.
   */
  readonly write: boolean;
  /** Compose and print, but append nothing — for developing the miner without moving its own ledgers. */
  readonly dryRun: boolean;
}

/**
 * Parse `reflect brief`'s flags.
 *
 * @param rest the argv tail (after `slopweaver reflect brief`)
 * @returns the validated options, or every rejection
 */
export function parseReflectBriefOptions({ rest }: { rest: readonly string[] }): Result<ReflectBriefOptions> {
  const parsed = parseFlagTail({ rest, spec: REFLECT_BRIEF_FLAG_SPEC });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values, flags } = parsed.value;
  const rawCap = values["cap"];
  const errors: string[] = [];
  const cap = rawCap === undefined ? SURFACE_CAP : parsePositiveInteger({ errors, label: "--cap", value: rawCap });
  if (cap === undefined) {
    return err(errors);
  }
  const write = flags.has("write");
  const dryRun = flags.has("dry-run");
  if (write && dryRun) {
    return err([REFLECT_BRIEF_WRITE_DRY_RUN_CONFLICT]);
  }
  return ok({
    cap,
    dryRun,
    from: flagValueOr({ fallback: REFLECT_BRIEF_DEFAULT_FROM, name: "from", parsed: parsed.value }),
    json: flags.has("json"),
    to: flagValueOr({ fallback: "now", name: "to", parsed: parsed.value }),
    write,
  });
}
