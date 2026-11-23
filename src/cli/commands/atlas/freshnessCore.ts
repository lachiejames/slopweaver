/**
 * Pure argument handling and rendering for `slopweaver atlas freshness` — the atlas half of the rolling
 * window asked for, deliberately shaped like `refresh --if-stale`'s report rather than
 * like a second idea.
 *
 * The judgement itself is `atlas/kit/freshnessWindow.ts`'s and the gathering is {@link ./freshnessRun}'s.
 * What lives here is what a report says, so every line is testable without a home directory.
 */
import type { AtlasFreshnessVerdict } from "../../../atlas/kit/freshnessWindow.js";
import { parseDuration, renderDuration } from "../../../lib/duration.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { FlagSpec } from "../../parseFlags.js";
import { booleanFlagsOf, parseFlags, stringFlagsOf } from "../../parseFlags.js";

/** Every flag this verb accepts. */
const ATLAS_FRESHNESS_FLAGS: FlagSpec = {
  boolean: ["json", "behind-only"],
  string: ["home", "window"],
};

/** Every flag NAME, derived from the spec rather than re-listed, so the two cannot drift.
 *
 * @internal
 */
export const ATLAS_FRESHNESS_FLAG_NAMES: readonly string[] = [
  ...booleanFlagsOf({ spec: ATLAS_FRESHNESS_FLAGS }),
  ...stringFlagsOf({ spec: ATLAS_FRESHNESS_FLAGS }),
]
  .map((name) => `--${name}`)
  .toSorted();

/** The usage line, shared by `--help` and the manifest so the two cannot drift. */
export const ATLAS_FRESHNESS_USAGE =
  "usage: slopweaver atlas freshness [<platform>] [--behind-only] [--window <duration>] [--json] [--home <dir>]\n" +
  "  <platform>      judge one atlas; omitted judges every atlas this build has\n" +
  "  --behind-only   print only the atlases past their window\n" +
  "  --window        judge every atlas against this window instead of its own — `30m`, `4h`, `7d`\n" +
  "  reads local generations only: one manifest and one live-read stamp per atlas. No network call.\n" +
  "  exits non-zero when any judged atlas is behind its window, so a scheduled row can act on it";

/** The resolved invocation.
 * @internal
 */
export interface AtlasFreshnessOptions {
  readonly platform: string | undefined;
  readonly behindOnly: boolean;
  /** An override applied to EVERY atlas, in milliseconds, or `undefined` to use each atlas's own. */
  readonly windowMsOverride: number | undefined;
  readonly json: boolean;
  readonly home: string | undefined;
}

/**
 * Parse this verb's own tail.
 *
 * A bare positional is the platform, exactly as `atlas doctor` reads one, so the two verbs address an atlas
 * the same way. `--window` is refused rather than guessed at when it carries no unit, which is
 * `lib/duration.ts`'s rule and the reason a four-HOUR tick cannot silently become a four-DAY one.
 *
 * @param rest the argv tail after `atlas freshness`
 * @returns the resolved options, or every reason the invocation was rejected
 */
export function parseAtlasFreshnessArgs({ rest }: { rest: readonly string[] }): Result<AtlasFreshnessOptions> {
  const parsed = parseFlags({ allowPositionals: true, args: rest, spec: ATLAS_FRESHNESS_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values, positionals } = parsed.value;
  const errors: string[] = [];
  if (positionals.length > 1) {
    errors.push(`name at most one platform — got ${positionals.join(", ")}`);
  }

  let windowMsOverride: number | undefined;
  const declared = values["window"];
  if (typeof declared === "string") {
    const duration = parseDuration({ value: declared });
    if ("error" in duration) {
      errors.push(`--window ${duration.error}`);
    } else {
      windowMsOverride = duration.ms;
    }
  }

  if (errors.length > 0) {
    return err(errors);
  }
  const home = values["home"];
  return ok({
    behindOnly: values["behind-only"] === true,
    home: typeof home === "string" ? home : undefined,
    json: values["json"] === true,
    platform: positionals[0],
    windowMsOverride,
  });
}

/** What one sweep found, in the shape both the table and the `--json` report are built from. */
export interface AtlasFreshnessReport {
  readonly nowIso: string;
  readonly verdicts: readonly AtlasFreshnessVerdict[];
  /** Every declared window this build could not parse, named so a wrong policy is visible. */
  readonly problems: readonly string[];
}

/**
 * The lines one sweep prints.
 *
 * Every judged atlas gets a line, current ones included, unless `--behind-only` narrows it — a sweep that
 * printed only what was wrong would be indistinguishable from a sweep that judged nothing, which is why
 * `refresh --if-stale` prints its skipped sources too. The summary line is always printed, so a run that
 * found nothing behind still says so out loud.
 *
 * @param report what the sweep found
 * @param behindOnly whether the caller narrowed the listing to the atlases past their window
 * @returns the lines to print, in order
 */
export function renderAtlasFreshness({
  report,
  behindOnly,
}: {
  report: AtlasFreshnessReport;
  behindOnly: boolean;
}): readonly string[] {
  const listed = behindOnly ? report.verdicts.filter((verdict) => verdict.behind) : report.verdicts;
  const behind = report.verdicts.filter((verdict) => verdict.behind);
  const lines = [...report.problems, ...listed.map((verdict) => verdict.line)];
  if (behind.length === 0) {
    return [...lines, `atlas freshness · every judged atlas is inside its window (${report.verdicts.length} judged)`];
  }
  const liveRead = behind.filter((verdict) => verdict.action === "live-read").length;
  return [
    ...lines,
    `atlas freshness · ${behind.length} of ${report.verdicts.length} behind — ${liveRead} answerable by a bounded live read, ${behind.length - liveRead} needing a resync`,
  ];
}

/**
 * The machine-readable report.
 *
 * @param report what the sweep found
 * @returns the `--json` payload, with each verdict's window rendered the way a caller would type it
 */
export function atlasFreshnessJson({ report }: { report: AtlasFreshnessReport }): {
  readonly nowIso: string;
  readonly behind: number;
  readonly judged: number;
  readonly problems: readonly string[];
  readonly atlases: readonly {
    readonly platform: string;
    readonly window: string;
    readonly updatedAt: string | null;
    readonly ageMs: number | null;
    readonly behind: boolean;
    readonly action: string;
    readonly remedy: string | null;
  }[];
} {
  return {
    atlases: report.verdicts.map((verdict) => ({
      action: verdict.action,
      ageMs: verdict.ageMs,
      behind: verdict.behind,
      platform: verdict.platform,
      remedy: verdict.remedy,
      updatedAt: verdict.updatedAt,
      window: renderDuration({ ms: verdict.windowMs }),
    })),
    behind: report.verdicts.filter((verdict) => verdict.behind).length,
    judged: report.verdicts.length,
    nowIso: report.nowIso,
    problems: report.problems,
  };
}
