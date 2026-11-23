/**
 * Turning a `refresh` argv into a go-ahead request, before any network or write: the help and bad-flag exits,
 * the full-history, snapshot-narrowing and missing-token refusals, the `--self` roots and the `--if-stale`
 * narrowing. `./run.ts` is the shell that calls it, and runs the stages after it.
 */

import type { CorpusSource } from "../../../corpus/types.js";
import { EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { verbTail } from "../../optionParsers.js";
import {
  fullHistoryDiagnostics,
  missingTokenDiagnostics,
  parseRefreshOptions,
  type RefreshOptions,
  resolveSelfRoots,
  selectRefreshSources,
  selectStaleSources,
  selfRootDiagnostics,
} from "./core.js";
import type { RefreshDeps } from "./deps.js";
import { REFRESH_USAGE as USAGE } from "./flags.js";
import { refreshHome, staleThresholdMs } from "./requestDefaults.js";
import { snapshotNarrowingDiagnostics } from "./snapshotGuard.js";

/** A validated, go-ahead refresh request (the resolved options + sources + home + `self` roots). */
interface RefreshRequest {
  readonly options: RefreshOptions;
  readonly sources: readonly CorpusSource[];
  readonly home: string;
  /** The resolved `--self` roots. Empty unless `--self` was passed (and then never empty — see the guard). */
  readonly selfRoots: readonly string[];
}

/**
 * Parse + validate the argv into a go-ahead request, or an early exit code (help / bad flags / unknown
 * source / a requested non-GitHub source with no token — the last checked BEFORE any network or write).
 * Emits the diagnostics through the injected logger.
 *
 * @param argv the full process argv (verb tail starts at index 3)
 * @param deps the effectful seams (logger + token reads)
 * @returns the validated request, or the exit code to return
 */
export function resolveRefreshRequest({
  argv,
  deps,
}: {
  argv: readonly string[];
  deps: RefreshDeps;
}): { kind: "exit"; code: number } | { kind: "go"; request: RefreshRequest } {
  const rawRest = verbTail({ argv, verbs: ["run"] });
  if (rawRest.includes("--help") || rawRest.includes("-h")) {
    deps.logger.out({ line: USAGE });
    return { code: EXIT_OK, kind: "exit" };
  }
  const parsed = parseRefreshOptions({ rest: rawRest });
  if (parsed.isErr()) {
    reportUsageErrors({ errors: parsed.error, sink: deps.logger });
    return { code: EXIT_USAGE, kind: "exit" };
  }
  const chosen = selectRefreshSources({
    allSources: parsed.value.allSources,
    self: parsed.value.self,
    sources: parsed.value.sources,
  });
  if (chosen.isErr()) {
    reportUsageErrors({ errors: [chosen.error.message], sink: deps.logger });
    return { code: EXIT_USAGE, kind: "exit" };
  }
  // The epoch guard runs BEFORE the token gate so `--all` without its confirmation flag never reaches a
  // network call, whatever else is misconfigured.
  const { acceptFullHistory, all } = parsed.value;
  const fullHistory = fullHistoryDiagnostics({ acceptFullHistory, all });
  if (fullHistory.length > 0) {
    logErrorLines({ lines: fullHistory, sink: deps.logger });
    return { code: EXIT_USAGE, kind: "exit" };
  }
  const narrowed = snapshotNarrowingDiagnostics({ options: parsed.value, sources: chosen.value });
  if (narrowed.length > 0) {
    logErrorLines({ lines: narrowed, sink: deps.logger });
    return { code: EXIT_USAGE, kind: "exit" };
  }
  const missing = missingTokenDiagnostics({ selectedSources: chosen.value, tokens: deps.resolveTokens() });
  if (missing.length > 0) {
    logErrorLines({ lines: missing, sink: deps.logger });
    return { code: EXIT_USAGE, kind: "exit" };
  }
  const roots = resolveSelfRootsOrRefuse({ deps, options: parsed.value });
  if ("code" in roots) {
    return { code: roots.code, kind: "exit" };
  }
  const home = refreshHome({ deps, options: parsed.value });
  const selected = narrowToStale({ deps, home, options: parsed.value, sources: chosen.value });
  // `--self` alone selects NO fetchable source; exiting on that alone made `refresh --self` a silent no-op.
  if (selected.length === 0 && roots.selfRoots.length === 0) {
    return { code: EXIT_OK, kind: "exit" };
  }
  return {
    kind: "go",
    request: { home, options: parsed.value, selfRoots: roots.selfRoots, sources: selected },
  };
}

/**
 * Resolve the `--self` roots, or refuse the run because none are configured.
 *
 * Resolved and refused BEFORE any scan, so an unconfigured `--self` says what to set instead of walking nothing
 * and reporting an empty corpus — which is indistinguishable from a corpus that really is empty.
 *
 * @param options the parsed refresh options
 * @param deps the effectful seams (the environment read + the logger)
 * @returns the resolved roots, or the exit code to return
 */
function resolveSelfRootsOrRefuse({
  options,
  deps,
}: {
  options: RefreshOptions;
  deps: RefreshDeps;
}): { selfRoots: readonly string[] } | { code: number } {
  const selfRoots = options.self
    ? resolveSelfRoots({ envValue: deps.selfRootsEnv?.(), selfRoots: options.selfRoots })
    : [];
  const rootErrors = selfRootDiagnostics({ roots: selfRoots, self: options.self });
  if (rootErrors.length === 0) {
    return { selfRoots };
  }
  logErrorLines({ lines: rootErrors, sink: deps.logger });
  return { code: EXIT_USAGE };
}

/** Emit each error line, with no usage tail — for a failure that is not the caller's flags. */
export function logErrorLines({ lines, sink }: { lines: readonly string[]; sink: RefreshDeps["logger"] }): void {
  lines.forEach((line) => {
    sink.error({ msg: line });
  });
}

/** Emit each error line followed by the usage line (the shared bad-flags/unknown-source report). */
function reportUsageErrors({ errors, sink }: { errors: readonly string[]; sink: RefreshDeps["logger"] }): void {
  logErrorLines({ lines: errors, sink });
  sink.error({ msg: USAGE });
}

/**
 * Apply `--if-stale`, when it was asked for: read each selected source's stored cursor, print the verdict
 * for every one of them, and return only the sources that are actually behind.
 *
 * Every source's line is printed, INCLUDING the skipped ones, and an empty result prints its own line before
 * the run exits `EXIT_OK`. A scheduled tick that printed only what it did would be indistinguishable from a
 * tick that failed to select anything, and "the refresh ran and said nothing" is precisely the silence this
 * flag was added to end.
 *
 * @param deps the effectful seams — the cursor reader, the clock and the logger
 * @param home the Slopweaver home the cursors live under
 * @param options the parsed options — the flag itself and its threshold override
 * @param sources the sources already selected by `--source` / `--all-sources`
 * @returns the sources to refresh, in selection order — every one of them when `--if-stale` was not passed
 */
function narrowToStale({
  deps,
  home,
  options,
  sources,
}: {
  deps: RefreshDeps;
  home: string;
  options: RefreshOptions;
  sources: readonly CorpusSource[];
}): readonly CorpusSource[] {
  if (!options.ifStale) {
    return sources;
  }
  const verdicts = selectStaleSources({
    cursors: ({ source }) => deps.readWatermark({ home, source }),
    nowIso: deps.nowDate().toISOString(),
    sources,
    staleAfterMs: staleThresholdMs({ options }),
  });
  verdicts.forEach(({ line }) => {
    deps.logger.out({ line });
  });
  const behind = verdicts.filter((verdict) => verdict.behind).map(({ source }) => source);
  if (behind.length === 0) {
    deps.logger.out({
      line: "refresh --if-stale · every selected source is inside its freshness window — nothing to do",
    });
  }
  return behind;
}
