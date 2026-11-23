/**
 * The pure core of the `refresh` verb — flag parsing, source selection, per-source window planning, the
 * missing-token diagnostics, and the result summary + exit code — extracted from the old 126-line
 * (complexity-24) `runRefresh` so each concern is unit-tested apart from the token reads / connector
 * factories / ingest IO the shell ({@link ./run}) owns. Nothing here touches the network, env, or disk;
 * the watermark read is an injected seam so window planning stays pure.
 */
import { unsetFieldAsNull } from "#lib/absent.js";
import type { CoverageGap } from "../../../corpus/ingestJob.js";
import type { NotionCaptureCaps } from "../../../corpus/notion/caps.js";
import type { CorpusSource } from "../../../corpus/types.js";
import type { RefreshStreamEvent } from "../../../events/event.js";
import { missingTokenHintFor } from "../../../integrations/corpusProjections.js";
import {
  CORPUS_SOURCES,
  type TokenedSource as DerivedTokenedSource,
  FETCHABLE_SOURCES,
  TOKENED_SOURCES,
} from "../../../integrations/corpusSources.js";
import { parseDuration, renderAge, renderDuration } from "../../../lib/duration.js";
import { isOneOf } from "../../../lib/parsers.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../exitCodes.js";
import { parseFlagTail, parsePositiveInteger } from "../../optionParsers.js";
import { RefreshErrors, type RefreshUnknownSourceError } from "./errors.js";
import { REFRESH_FLAG_SPEC } from "./flags.js";
import { notionCapDiagnostics, parseNotionCaps } from "./notionCapFlags.js";
import { EPOCH_SINCE } from "./windows.js";

/**
 * The refresh command that actually covers every source, spelled once.
 *
 * `--if-stale` alone is NOT this command and never becomes it: source selection defaults to GitHub, and the
 * mailbox is excluded even from `--all-sources` because it is one person's private correspondence. Both
 * defaults are deliberate and neither is `--if-stale`'s to override, so the honest thing is to print the
 * whole line rather than let a reader install a tick that quietly refreshes GitHub forever while every other
 * source ages. Read by the bare-`--if-stale` guard below, so the advertised command cannot drift from the
 * one that actually covers every source.
 *
 * @internal
 */
export const IF_STALE_ALL_SOURCES = "slopweaver refresh --if-stale --all-sources --source gmail";

/**
 * The sources whose absence-of-token is a usage error: every manifest whose corpus row says
 * `upfrontTokenGate`, derived in `src/integrations/corpusSources.ts` with {@link TOKENED_SOURCES}.
 *
 * The token gate used to select its subjects by `source !== "github"`, which was a correct spelling of
 * "everything else" for exactly as long as everything else was tokened. `gmail` authenticates with a stored
 * OAuth GRANT rather than an environment token, so under the old spelling every `--source gmail` run failed
 * the usage gate before reaching the network, naming an environment variable that does not exist for it.
 * Each manifest declaring the flag is what stops the next source from inheriting the same wrong default.
 */
export type TokenedSource = DerivedTokenedSource;

/** The validated `refresh` options (mirrors the verb's flags). */
export interface RefreshOptions {
  readonly sources: readonly string[];
  readonly slackChannels: readonly string[];
  readonly allSources: boolean;
  readonly all: boolean;
  /**
   * Epoch-wide opt-in for `--all`. `--all` re-crawls from {@link EPOCH_SINCE} across every selected source
   * AND every org repo, so it is gated behind this second, deliberate flag rather than an interactive
   * prompt (a `refresh` invoked from a slash command or a hook has no usable stdin, and a blocking prompt
   * there would hang the run).
   */
  readonly acceptFullHistory: boolean;
  readonly noEnrich: boolean;
  /**
   * Refresh only the sources that are actually BEHIND — the cron-safe entry point.
   *
   * The distinction from a bare `refresh` is what makes it safe to run unattended on a timer: a bare refresh
   * always crawls every selected source over its lookback window, so a schedule tight enough to keep a busy
   * source current spends the same on a quiet one every time it fires. `--if-stale` reads each source's
   * stored cursor first and drops the ones inside {@link ./core.RefreshOptions.staleAfterMs}, so the cost
   * of a tick is proportional to how far behind the corpus actually is, and a tick over a current corpus
   * costs one file read per source and exits.
   *
   * It NEVER widens the selection: `--if-stale` alone still means GitHub only, and gmail and calendar are
   * still reached by naming them. It only ever removes sources from what was already asked for.
   */
  readonly ifStale: boolean;
  /**
   * How far behind a source's cursor must be for `--if-stale` to refresh it, in MILLISECONDS.
   *
   * Written by the caller as a duration with a unit (`30m`, `4h`, `7d`), because this is the knob a
   * scheduled tick turns and a cadence is spoken in hours. It defaults in the shell to
   * {@link ../../../retrieval/coverage.STALE_AFTER_DAYS} — the same number the query path annotates a leg
   * at, so "the corpus reports stale" and "the scheduled refresh picks it up" cannot drift into meaning two
   * different ages.
   */
  readonly staleAfterMs?: number;
  /**
   * This refresh is a JUST-IN-TIME wait: a turn has decided a question cannot be answered from what is on
   * disk (`../../../retrieval/justInTime.ts`) and is refreshing before it answers.
   *
   * The flag no longer decides whether the per-source refresh slot
   * (`../../../corpus/refreshSlot.ts`) is taken — EVERY refresh path takes it, per the owner's
   * ruling quoted there. What it decides is the REMEDY a held slot names: a turn that waited should re-ask
   * once the holder finishes, because the holder's run is the refresh it wanted, while an operator should
   * run their own command again.
   */
  readonly jit: boolean;
  /**
   * Ingest the window file this run just wrote into the Supabase store, after bronze and before derive —
   * the leg a scheduled `resync-corpus-<source>` row runs with, so a resync that exits zero has reached
   * the store and not only the disk. Off by default: a bare `refresh` stays a bronze write, and an install
   * with no store selected must not start failing every refresh. See {@link ./storeLeg}.
   */
  readonly store: boolean;
  /**
   * Skip the post-ingest `derive`. Refresh derives BY DEFAULT because the two verbs having no coupling is
   * exactly how silver ended up two days behind bronze; `--no-derive` is for a caller that is about to run
   * several refreshes and wants one derive at the end.
   */
  readonly noDerive: boolean;
  /**
   * Whether to WITHHOLD attachment bytes from a Notion run. Default false, so a refresh fetches them, per the owner's
   * ruling. It exists because bytes at rest is the one thing in this connector a caller might
   * reasonably not want on a given machine, and the ceiling bounds each file rather than the total.
   */
  readonly noNotionAttachments: boolean;
  /**
   * Withhold every org-identifying STRING from the run's output — previews, item titles, per-source labels —
   * leaving counts, phases, timestamps and shape.
   *
   * For pasting a run into a PUBLIC pull request. The hygiene gate scans tracked files and cannot scan a
   * terminal capture, and this connector's own progress stream prints issue identifiers (which are team keys)
   * and repo slugs by default. See {@link ../../../lib/numbersOnly}.
   */
  readonly numbersOnly: boolean;
  /**
   * Report Slack REACH instead of fetching anything: what the read token can list, what has been backfilled,
   * and what never has. Read-only, and non-zero while any reachable conversation is missing — so "we ingest
   * everything we can reach" is a checkable state rather than a claim. Slack-only, by design: the other three
   * connectors have no membership boundary for it to be about.
   */
  readonly coverage: boolean;
  readonly repo?: string;
  readonly since?: string;
  readonly until?: string;
  readonly lookbackDays?: number;
  readonly home?: string;
  /** GitHub ORG MODE opt-in: fan the per-repo pipeline over every org repo (else single-repo, unchanged). */
  readonly allRepos: boolean;
  /** The org to enumerate in org mode (else derived from `--repo` owner / the current remote owner). */
  readonly githubOrg?: string;
  /** Repo include globs (empty ⇒ all org repos). */
  readonly includeRepos: readonly string[];
  /** Repo exclude globs. */
  readonly excludeRepos: readonly string[];
  /** Max org repos to ingest activity for (the scale guard; undefined ⇒ no cap). */
  readonly repoCap?: number;
  /**
   * The page ceiling on every GitHub org list (repos, teams, members): a walk that reaches it with a full last
   * page is WARNED, never silent, and this is the flag the warning names. Undefined ⇒
   * {@link DEFAULT_GITHUB_PAGE_CAP} (2,000 items per list).
   */
  readonly githubPageCap?: number;
  /** Max active Slack channels to resolve membership for (the per-channel scale guard). */
  readonly slackMembershipCap?: number;
  /**
   * Fast-feedback cap: keep at most this many records PER CONTAINER (repo/channel/page) before writing, so
   * a real multi-source refresh finishes in seconds. A sampled run deliberately does NOT advance any
   * watermark (see {@link ../../../corpus/ingestSource.ingestSources}), so a later full run re-pulls the
   * whole window (the sampled rows dedup out). Undefined ⇒ no cap (the normal full run).
   */
  readonly sample?: number;
  /**
   * Opt-in for the `self` source: scan the owner's own writing off the local filesystem into bronze.
   *
   * An explicit flag, never a default. A bare `refresh` stays network-shaped and fast, and nothing about the
   * four fetched sources changes when this is off — which is also why `self` is absent from
   * {@link FETCHABLE_SOURCES} and `--source self` is a usage error rather than a second door.
   */
  readonly self: boolean;
  /**
   * The directories `--self` scans, from repeated `--self-root`. Empty ⇒ fall back to the
   * `SLOPWEAVER_SELF_ROOTS` environment variable; if that is unset too, `--self` is a usage error.
   *
   * Deliberately NOT hard-coded. The standing decision is "built for me, not for others", which would argue
   * for two absolute paths in the source — except that this is a public repository and an absolute home path is
   * one of the leak classes the hygiene gate exists to catch. So the paths live in the operator's environment,
   * where they are configuration rather than a committed fact about one person's disk.
   */
  readonly selfRoots: readonly string[];

  /** Relative-path prefixes `--self` declines, from repeated `--self-exclude`. Each is reported by name. */
  readonly selfExclude: readonly string[];
  /**
   * PRE-fetch cap: pull at most this many items PER LANE from each integration (Slack channels/users/messages,
   * Linear issues/projects/curated) — capping the requests + page sizes, so a bounded refresh makes few, small
   * API calls. Distinct from {@link sample} (which caps records AFTER the full fetch): this bounds the fetch
   * itself. Undefined ⇒ no cap. Also what the integration-test recordings use to stay small.
   */
  readonly fetchCap?: number;
  /**
   * Re-fetch every in-window item even when bronze already holds it under the same `last_edited_time`
   * (Notion only — see `corpus/notion/seenIndex.ts`). Off by default, because the skip is what makes a
   * widened `--since` affordable: measured, 78% of one chunked expansion's fetch work re-pulled content an
   * earlier chunk had already landed. Turn it on to force a full re-walk — the escape for bronze written
   * before the connector recorded whether a capture was complete.
   */
  readonly refetchUnchanged: boolean;
  /**
   * The three per-item bounds the Notion capture runs under (`--notion-block-depth`, `--notion-item-calls`,
   * `--notion-item-time`), defaulting to the shipped {@link ../../../corpus/notion/caps.DEFAULT_NOTION_CAPTURE_CAPS}.
   *
   * Always present rather than optional, so a caller cannot forget to pass them and silently get the crawl's
   * own fallback instead of the run's: what makes a lifted run safe is that the caps travel as ONE value.
   */
  readonly notionCaps: NotionCaptureCaps;
}

/**
 * Collect every `--flag value` occurrence out of the tail, returning the values + the remaining tail. Pure.
 *
 * @param rest the argv tail
 * @param flag the repeatable flag to collect
 * @returns the collected values + the tail with them removed
 */
export function collectRepeated({ rest, flag }: { rest: readonly string[]; flag: string }): {
  readonly values: readonly string[];
  readonly rest: readonly string[];
} {
  const values: string[] = [];
  const remaining: string[] = [];
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i]!;
    const next = rest[i + 1];
    if (token === flag && next !== undefined && !next.startsWith("-")) {
      values.push(next);
      i += 1;
      continue;
    }
    remaining.push(token);
  }
  return { rest: remaining, values };
}

/**
 * Every plain presence flag, read in one place.
 *
 * They are all the same shape — a name, present or not — so reading them together keeps the option parser
 * about the flags that need real parsing rather than about a list of fifteen booleans.
 *
 * @param flags the flag names present on the command line
 * @returns each boolean option
 */
function booleanFlags({ flags }: { flags: ReadonlySet<string> }): {
  acceptFullHistory: boolean;
  all: boolean;
  allRepos: boolean;
  allSources: boolean;
  coverage: boolean;
  ifStale: boolean;
  jit: boolean;
  noDerive: boolean;
  noEnrich: boolean;
  noNotionAttachments: boolean;
  numbersOnly: boolean;
  refetchUnchanged: boolean;
  store: boolean;
} {
  return {
    acceptFullHistory: flags.has("accept-full-history"),
    all: flags.has("all"),
    allRepos: flags.has("all-repos"),
    allSources: flags.has("all-sources"),
    coverage: flags.has("coverage"),
    ifStale: flags.has("if-stale"),
    jit: flags.has("jit"),
    noDerive: flags.has("no-derive"),
    noEnrich: flags.has("no-enrich"),
    noNotionAttachments: flags.has("no-notion-attachments"),
    numbersOnly: flags.has("numbers-only"),
    refetchUnchanged: flags.has("refetch-unchanged"),
    store: flags.has("store"),
  };
}

/**
 * Parse + validate the `refresh` flag tail into typed options. Pure — a bad flag or a non-positive
 * `--lookback-days` yields an error Result, never a throw.
 *
 * @param rest the verb tail (argv from index 3)
 * @returns the validated options, or the accumulated flag errors
 */
export function parseRefreshOptions({ rest }: { rest: readonly string[] }): Result<RefreshOptions> {
  const afterSources = collectRepeated({ flag: "--source", rest });
  const afterChannels = collectRepeated({ flag: "--slack-channel", rest: afterSources.rest });
  const afterInclude = collectRepeated({ flag: "--include-repo", rest: afterChannels.rest });
  const afterExclude = collectRepeated({ flag: "--exclude-repo", rest: afterInclude.rest });
  const afterSelfRoots = collectRepeated({ flag: "--self-root", rest: afterExclude.rest });
  const afterSelfExclude = collectRepeated({ flag: "--self-exclude", rest: afterSelfRoots.rest });
  const parsed = parseFlagTail({
    rest: afterSelfExclude.rest,
    spec: REFRESH_FLAG_SPEC,
  });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values, flags } = parsed.value;
  const errors: string[] = [];
  const lookbackDays = optionalPositiveInt({ errors, label: "--lookback-days", value: values["lookback-days"] });
  const staleAfterMs = optionalDuration({ errors, label: "--stale-after", value: values["stale-after"] });
  const caps = parseScaleCaps({ errors, values });
  if (staleAfterMs !== undefined && !flags.has("if-stale")) {
    // Refused rather than ignored: a caller who typed a threshold and got a full refresh anyway has been
    // told nothing, and the run they wanted to be cheap was the expensive one.
    errors.push("--stale-after only means anything with --if-stale");
  }
  errors.push(...bareIfStaleDiagnostics({ flags, sources: afterSources.values }));
  const notionCaps = parseNotionCaps({ errors, values });
  errors.push(...notionCapDiagnostics({ notionCaps, sources: afterSources.values, values }));
  if (errors.length > 0) {
    return err(errors);
  }
  return ok({
    ...booleanFlags({ flags }),
    excludeRepos: afterExclude.values,
    includeRepos: afterInclude.values,
    notionCaps,
    self: flags.has("self"),
    selfExclude: afterSelfExclude.values,
    selfRoots: afterSelfRoots.values,
    slackChannels: afterChannels.values,
    sources: afterSources.values,
    ...caps,
    ...(values["repo"] !== undefined ? { repo: values["repo"] } : {}),
    ...(values["since"] !== undefined ? { since: values["since"] } : {}),
    ...(values["until"] !== undefined ? { until: values["until"] } : {}),
    ...(lookbackDays !== undefined ? { lookbackDays } : {}),
    ...(staleAfterMs !== undefined ? { staleAfterMs } : {}),
    ...(values["home"] !== undefined ? { home: values["home"] } : {}),
    ...(values["github-org"] !== undefined ? { githubOrg: values["github-org"] } : {}),
  });
}

/**
 * Refuse a bare `--if-stale` — the flag with no source selector at all. Pure.
 *
 * A plain `refresh` with no selector means GitHub, which is the right convenience for someone typing one at a
 * terminal. `--if-stale` exists to be INSTALLED on a timer, and an unattended run that quietly inherits an
 * implicit default is the failure this whole change is about: the obvious tick, `slopweaver refresh
 * --if-stale`, would have refreshed GitHub forever while Slack, Linear, Notion and the mailbox aged, and
 * reported success every time. Widening the flag to mean "every source" was the alternative and is worse —
 * it would make a flag documented as only ever NARROWING a selection start widening one, and it would sweep
 * up the mailbox, which is opt-in by an owner ruling rather than by an omission.
 *
 * So the third option: make the silent case impossible and name the command that is not silent. Anything
 * explicit — `--all-sources`, or any `--source` — passes.
 *
 * @param flags the parsed boolean flags
 * @param sources the raw `--source` values
 * @returns the refusal line, or nothing when the selection was explicit
 */
function bareIfStaleDiagnostics({
  flags,
  sources,
}: {
  flags: ReadonlySet<string>;
  sources: readonly string[];
}): readonly string[] {
  if (!flags.has("if-stale") || flags.has("all-sources") || sources.length > 0) {
    return [];
  }
  return [
    "--if-stale needs an explicit source selection: on its own it would inherit the implicit GitHub default " +
      "and silently leave every other source ageing. For a scheduled tick, run " +
      `\`${IF_STALE_ALL_SOURCES}\`; for one source, add \`--source <name>\`.`,
  ];
}

/**
 * Parse the five positive-integer scale caps (`--repo-cap`, `--github-page-cap`, `--slack-membership-cap`,
 * `--sample`, `--fetch-cap`) into a spreadable options fragment; a bad value pushes onto `errors`. Pure.
 *
 * @param values the parsed flag values
 * @param errors the accumulating error list (mutated)
 * @returns the present caps, ready to spread into {@link RefreshOptions}
 */
function parseScaleCaps({
  values,
  errors,
}: {
  values: Readonly<Record<string, string | undefined>>;
  errors: string[];
}): Pick<RefreshOptions, "repoCap" | "githubPageCap" | "slackMembershipCap" | "sample" | "fetchCap"> {
  const repoCap = optionalPositiveInt({ errors, label: "--repo-cap", value: values["repo-cap"] });
  const githubPageCap = optionalPositiveInt({ errors, label: "--github-page-cap", value: values["github-page-cap"] });
  const membershipCap = optionalPositiveInt({
    errors,
    label: "--slack-membership-cap",
    value: values["slack-membership-cap"],
  });
  const sample = optionalPositiveInt({ errors, label: "--sample", value: values["sample"] });
  const fetchCap = optionalPositiveInt({ errors, label: "--fetch-cap", value: values["fetch-cap"] });
  return {
    ...(repoCap !== undefined ? { repoCap } : {}),
    ...(githubPageCap !== undefined ? { githubPageCap } : {}),
    ...(membershipCap !== undefined ? { slackMembershipCap: membershipCap } : {}),
    ...(sample !== undefined ? { sample } : {}),
    ...(fetchCap !== undefined ? { fetchCap } : {}),
  };
}

/** One optional flag's raw value, its name for an error, and the error list a bad value is pushed onto. */
interface OptionalFlagValue {
  /** The raw flag value, when the flag was given one. */
  value: string | undefined;
  label: string;
  /** The accumulating error list (mutated). */
  errors: string[];
}

/**
 * Parse an optional duration flag (`30m`, `4h`, `7d`) into milliseconds; a bad value pushes an error. Pure.
 *
 * @returns the duration in milliseconds, or undefined when the flag was absent
 */
function optionalDuration({ value, label, errors }: OptionalFlagValue): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = parseDuration({ value });
  if ("error" in parsed) {
    errors.push(`${label} ${parsed.error}`);
    return undefined;
  }
  return parsed.ms;
}

/** Parse an optional positive-integer flag value (undefined stays undefined; a bad value pushes an error). Pure. */
function optionalPositiveInt({ value, label, errors }: OptionalFlagValue): number | undefined {
  return value !== undefined ? parsePositiveInteger({ errors, label, value }) : undefined;
}

/**
 * Resolve the selected FETCHED sources: `--all-sources` → all; else the `--source` list (deduped, first-seen
 * order); else GitHub-only. An unknown source is an error. Pure.
 *
 * The `self` exception to the GitHub default is a usability fix rather than a special case. `self` is not a
 * fetchable source, so it never appears in the returned list — but a bare `refresh --self` was therefore
 * selecting the GitHub default too, and there was no way to spell "scan only my own writing": it crawled
 * GitHub every time, which is the opposite of the free, no-network lane the flag exists for. So `--self` with
 * no source selector selects NO fetched source; `--self --source github` still asks for both, explicitly.
 *
 * `--all-sources` resolves to `CORPUS_SOURCES` (`src/integrations/corpusSources.ts`), the ORG-SHARED surfaces
 * and NOT every fetchable source: a private one (the mailbox, the diary, a recorded call, a chat history) is
 * fetchable and is reached only by naming it, so the flag a habitual refresh reaches for never starts
 * ingesting mail with nothing said and nothing typed. Naming one ALONGSIDE
 * `--all-sources` unions the two rather than being discarded — see the branch below.
 *
 * @param sources the raw `--source` values
 * @param allSources whether `--all-sources` was set
 * @param self whether `--self` was set, which drops the implicit GitHub default (see above)
 * @returns the resolved sources, or an unknown-source error
 */
export function selectRefreshSources({
  sources,
  allSources,
  self = false,
}: {
  sources: readonly string[];
  allSources: boolean;
  self?: boolean;
}): Result<readonly CorpusSource[], RefreshUnknownSourceError> {
  const invalidNamed = sources.filter((source) => !isOneOf(source, FETCHABLE_SOURCES));
  if (invalidNamed.length > 0) {
    return err(RefreshErrors.unknownSource({ expected: FETCHABLE_SOURCES, unknown: invalidNamed }));
  }
  if (allSources) {
    // `--all-sources` UNIONED with anything explicitly named, rather than replacing it. Returning the sweep
    // alone was correct while every fetchable source was in it, and became a silent drop the moment one was
    // not: `refresh --all-sources --source gmail` names the mailbox and would have got the four org sources
    // and no mail, reporting success. A flag that discards a request the caller typed is the worst shape
    // this repo has — it is indistinguishable from having worked.
    return ok(uniqueSources({ sources: [...CORPUS_SOURCES, ...sources] }));
  }
  if (sources.length === 0) {
    return ok(self ? [] : ["github"]);
  }
  return ok(uniqueSources({ sources }));
}

/**
 * One source's `--if-stale` verdict: whether it is refreshed this tick, and the sentence saying why.
 *
 * @internal
 */
export interface StaleSelection {
  readonly source: CorpusSource;
  readonly behind: boolean;
  /** The line the run prints for this source, so a skipped tick is never a silent one. */
  readonly line: string;
}

/**
 * Judge each selected source against its stored cursor and say which are actually behind. Pure — the caller
 * supplies the cursors and the clock.
 *
 * A source with NO cursor is behind, always, at any threshold. That is the never-ingested case and the
 * cursorless-source case at once, and refreshing is right for both: the first has everything to fetch, and
 * the second (`self`) never reaches this selector because it is not a fetchable source.
 *
 * An UNPARSEABLE cursor is also behind, deliberately. The alternative — treating a cursor the program cannot
 * read as evidence of freshness — makes a corrupt watermark file into a permanent, silent skip, which is the
 * exact failure shape this whole verb exists to end.
 *
 * @param sources the sources already selected by `--source` / `--all-sources`
 * @param cursors each source's stored resume cursor, or `undefined` when it has none
 * @param nowIso the reference "now"
 * @param staleAfterMs how far behind a cursor must be to count, in milliseconds
 * @returns one verdict per source, in selection order
 */
export function selectStaleSources({
  sources,
  cursors,
  nowIso,
  staleAfterMs,
}: {
  sources: readonly CorpusSource[];
  cursors: (args: { source: CorpusSource }) => string | undefined;
  nowIso: string;
  staleAfterMs: number;
}): readonly StaleSelection[] {
  const nowMs = Date.parse(nowIso);
  return sources.map((source) => {
    const cursor = cursors({ source });
    if (cursor === undefined) {
      return { behind: true, line: `refresh ${source} · BEHIND · no stored cursor — refreshing`, source };
    }
    const cursorMs = Date.parse(cursor);
    if (Number.isNaN(cursorMs) || Number.isNaN(nowMs)) {
      return { behind: true, line: `refresh ${source} · BEHIND · cursor ${cursor} is unreadable — refreshing`, source };
    }
    // A cursor AHEAD of now is legitimate and common: a fetch that saw its whole window and found nothing
    // advances to the window's `until`, which is tomorrow's date. Such a source is as current as a source can
    // be, so it is not behind — but the age is clamped at zero rather than printed negative, because
    // `is -467.7m old` reads as a defect and this one is not.
    const ageMs = Math.max(0, nowMs - cursorMs);
    const behind = ageMs > staleAfterMs;
    const verdict = behind ? "BEHIND" : "current";
    const tail = behind ? "refreshing" : `inside ${renderDuration({ ms: staleAfterMs })} — skipped`;
    return {
      behind,
      line: `refresh ${source} · ${verdict} · cursor ${cursor} is ${renderAge({ ms: ageMs })} old, ${tail}`,
      source,
    };
  });
}

/**
 * The named sources, deduplicated in first-seen order. Every member is already known to be fetchable —
 * the caller rejects an unknown one before this runs. Pure.
 *
 * @param sources the raw `--source` values
 * @returns the distinct sources, in first-seen order
 */
function uniqueSources({ sources }: { sources: readonly string[] }): readonly CorpusSource[] {
  return [...new Set(sources)].filter((source): source is CorpusSource => isOneOf(source, FETCHABLE_SOURCES));
}

/**
 * The epoch-wide guard: `--all` re-crawls from {@link EPOCH_SINCE} across every selected source and every
 * org repo, so it requires the second deliberate `--accept-full-history` flag. A FLAG, never an
 * interactive prompt — `refresh` runs from slash commands and hooks with no usable stdin. Pure.
 *
 * @param all whether `--all` was set
 * @param acceptFullHistory whether `--accept-full-history` was set
 * @returns the usage errors (empty when the request is allowed)
 */
export function fullHistoryDiagnostics({
  all,
  acceptFullHistory,
}: {
  all: boolean;
  acceptFullHistory: boolean;
}): readonly string[] {
  if (!all || acceptFullHistory) {
    return [];
  }
  return [
    `refresh: --all re-crawls every source from ${EPOCH_SINCE} and ignores every stored cursor (per-source AND per-repo).`,
    "refresh: re-run with --accept-full-history to confirm, or pass --since YYYY-MM-DD for a bounded window.",
  ];
}

/** The environment variable naming the `self` roots when `--self-root` is not passed (`:`-separated). */
export const SELF_ROOTS_ENV = "SLOPWEAVER_SELF_ROOTS";

/**
 * Resolve which directories `--self` scans: the repeated `--self-root` flags win, else the `:`-separated
 * {@link SELF_ROOTS_ENV} variable. Blank entries are dropped so a trailing separator is not a root. Pure — the
 * environment value is read by the shell and passed in.
 *
 * @param selfRoots the `--self-root` values, in order
 * @param envValue the raw {@link SELF_ROOTS_ENV} value, when set
 * @returns the resolved roots, in order, deduplicated first-seen
 */
export function resolveSelfRoots({
  selfRoots,
  envValue,
}: {
  selfRoots: readonly string[];
  envValue: string | undefined;
}): readonly string[] {
  const fromEnv = envValue === undefined ? [] : envValue.split(":");
  const chosen = selfRoots.length > 0 ? selfRoots : fromEnv;
  return [...new Set(chosen.map((root) => root.trim()).filter((root) => root.length > 0))];
}

/**
 * The usage errors for a `--self` run with nothing to scan — computed BEFORE any filesystem walk, so an
 * unconfigured run says what to set rather than reporting an empty corpus. Pure.
 *
 * @param self whether `--self` was requested
 * @param roots the resolved roots
 * @returns the usage errors (empty when the request can proceed)
 */
export function selfRootDiagnostics({ self, roots }: { self: boolean; roots: readonly string[] }): readonly string[] {
  if (!self || roots.length > 0) {
    return [];
  }
  return [
    "refresh: --self needs at least one directory to scan, and none was configured.",
    `refresh: pass --self-root <dir> (repeatable), or set ${SELF_ROOTS_ENV} to a colon-separated list.`,
  ];
}

/**
 * The usage errors for every requested non-GitHub source that has no token — computed BEFORE any network
 * or write. Pure: token presence is resolved by the shell into `tokens` and passed in. Each line carries the hint
 * the source's manifest declares (`missingTokenHint`), so Slack can name both of its token env vars.
 *
 * @param selectedSources the resolved sources
 * @param tokens the resolved token (or `undefined`) per non-GitHub source
 * @returns one `refresh: <source> requested but no token …` line per missing token
 */
export function missingTokenDiagnostics({
  selectedSources,
  tokens,
}: {
  selectedSources: readonly CorpusSource[];
  tokens: Readonly<Partial<Record<TokenedSource, string | undefined>>>;
}): readonly string[] {
  return selectedSources
    .filter((source): source is TokenedSource => isOneOf(source, TOKENED_SOURCES))
    .filter((source) => tokens[source] === undefined)
    .map((source) => `refresh: ${source} requested but no token (${missingTokenHintFor({ source })})`);
}

/** One summary line, tagged with the stream it belongs on so the shell emits it verbatim in order. */
export interface RefreshSummaryLine {
  readonly level: "out" | "warn" | "error";
  readonly text: string;
}

/** The refresh summary: the ordered output/warn/error lines plus the totals that decide the exit code. */
export interface RefreshSummary {
  readonly lines: readonly RefreshSummaryLine[];
  readonly totalWritten: number;
  readonly anyFailed: boolean;
}

/** A per-source ingest result the summary reads (a structural subset of `SourceIngestResult`). */
export interface RefreshResult {
  readonly source: CorpusSource;
  readonly ok: boolean;
  readonly projected: number;
  readonly written: number;
  readonly deduped: number;
  /**
   * Records the install's author denylist dropped ({@link ../../../corpus/syncExclusion}). OPTIONAL so a
   * pre-existing result shape needs no change, and printed only when non-zero — a line reporting that
   * nothing was excluded on an install with no denylist would be noise on every refresh forever.
   */
  readonly excluded?: number;
  readonly warnings: readonly string[];
  readonly errors: readonly string[];
  /**
   * The coverage gaps that failed this source (`../../../corpus/ingestJob.ts` `CoverageGap`), already
   * folded into `errors`. OPTIONAL for the same reason as `notes`; read only to word a partial read as one.
   */
  readonly gaps?: readonly CoverageGap[];
  /**
   * Informational per-lane facts, printed at `out` level. OPTIONAL so a pre-existing test deck needs no
   * change, and separate from `warnings` deliberately: a note never means anything went wrong, and folding
   * one into the warning channel to get it printed is how a warning channel stops being a signal.
   */
  readonly notes?: readonly string[];
}

/**
 * The one line naming what a source wrote. Pure.
 *
 * @param result the source's ingest result
 * @returns the wrote-line
 */
function wroteLine({ result }: { result: RefreshResult }): string {
  const excluded = unsetFieldAsNull({ key: "excluded", record: result });
  // Named in the SAME line as the write, rather than as a note, because a reader comparing `projected`
  // to `written` needs the third number to make the arithmetic close. Omitted when unset or zero so an
  // install with no denylist sees exactly the line it has always seen.
  const excludedClause = excluded === null || excluded === 0 ? "" : `, excluded ${String(excluded)} by author`;
  return `${result.source}: wrote ${String(result.written)} new, deduped ${String(result.deduped)}${excludedClause} (from ${String(result.projected)} projected)`;
}

/**
 * One source's summary lines: its notes, its warnings, its errors when it failed, and its wrote-line. Pure.
 *
 * @param result the source's ingest result
 * @returns the lines, in print order
 */
function sourceSummaryLines({ result }: { result: RefreshResult }): readonly RefreshSummaryLine[] {
  const notes = unsetFieldAsNull({ key: "notes", record: result });
  const lines: RefreshSummaryLine[] = [
    ...(notes === null
      ? []
      : notes.map((note): RefreshSummaryLine => ({ level: "out", text: `  ${result.source}: ${note}` }))),
    ...result.warnings.map((w): RefreshSummaryLine => ({ level: "warn", text: `  ${result.source}: ${w}` })),
  ];
  if (result.ok === false) {
    lines.push(...result.errors.map((e): RefreshSummaryLine => ({ level: "error", text: `  ${result.source}: ${e}` })));
  }
  // A source that failed on a coverage gap still WROTE what it read, and those rows are real. Hiding the
  // wrote-line there reads as "nothing landed", which is the opposite lie to the one the gap corrects.
  const nothingToReport = result.ok === false && result.written === 0;
  if (!nothingToReport) {
    lines.push({ level: "out", text: wroteLine({ result }) });
  }
  return lines;
}

/**
 * Summarise the ingest results into the exact ordered lines the shell prints (per-source warnings, then
 * errors or the wrote-line, then the trailing bronze-path line) plus the totals. Pure.
 *
 * @param results the per-source ingest results, in run order
 * @param bronzePath the bronze directory (the trailing `→ <path>` line)
 * @returns the ordered lines + totals
 */
export function summariseRefreshResults({
  results,
  bronzePath,
}: {
  results: readonly RefreshResult[];
  bronzePath: string;
}): RefreshSummary {
  const lines: RefreshSummaryLine[] = [];
  let totalWritten = 0;
  let anyFailed = false;
  for (const result of results) {
    lines.push(...sourceSummaryLines({ result }));
    if (result.ok === false) {
      anyFailed = true;
    } else {
      totalWritten += result.written;
    }
  }
  lines.push({ level: "out", text: `→ ${bronzePath}` });
  return { anyFailed, lines, totalWritten };
}

/**
 * Why one source's stream event says what it says. Pure.
 *
 * A source that failed on a coverage GAP after writing rows is a partial read — a Slack conversation abandoned
 * as stalled, a Notion page a transient error hid — and "did NOT reach bronze" would be false about it. It
 * stays a refusal (the corpus did not cover its window, which is exactly what a supervisor must hear), worded
 * as one.
 *
 * @param result the source's ingest result
 * @returns the event's reason
 */
function streamEventWhy({ result }: { result: RefreshResult }): string {
  if (result.ok) {
    return `refresh ${result.source} wrote ${String(result.written)} new row(s) to bronze`;
  }
  const partialRead = result.gaps !== undefined && result.gaps.length > 0 && result.written > 0;
  if (partialRead) {
    return `refresh ${result.source} wrote ${String(result.written)} new row(s) but did NOT cover its window, so its world model is incomplete: ${result.errors.join("; ")}`;
  }
  return `refresh ${result.source} read but did NOT reach bronze, so its world model is frozen: ${result.errors.join("; ")}`;
}

/**
 * The supervisor-stream events one refresh publishes — one per source, `write-refused` when it could not
 * reach disk and `committed` when it did. Pure.
 *
 * Every source publishes, not only the failing ones, and that is the design rather than chatter: an alert
 * with no clearing half leaves a supervisor briefing showing a frozen corpus forever, because nothing on the
 * stream would ever say it started moving again. It is the same pair `github attach` and `standing-session`
 * carry, for the same reason.
 *
 * A refusal is graded `alert` by `severityOf`, and it earns that: a source that reads and cannot write is a
 * world model that has silently stopped moving while every other gauge stays green. Measured —
 * five days of no-op'd Slack refreshes, found only because an unrelated run needed to write.
 *
 * @param results the per-source ingest results, in run order
 * @param nowIso the instant to stamp the events with
 * @returns one event per source, in run order
 */
export function refreshStreamEvents({
  results,
  nowIso,
}: {
  results: readonly RefreshResult[];
  nowIso: string;
}): readonly RefreshStreamEvent[] {
  return results.map((result): RefreshStreamEvent => {
    const why = streamEventWhy({ result });
    return {
      atIso: nowIso,
      corpusSource: result.source,
      kind: result.ok ? "committed" : "write-refused",
      source: "refresh",
      why,
      written: result.ok ? result.written : 0,
    };
  });
}

/**
 * The refresh exit code: any source failed ⇒ error; nothing written ⇒ expected-empty; else OK. Pure.
 *
 * @param anyFailed whether any source failed
 * @param totalWritten total records written across sources
 * @returns the exit code
 */
export function refreshExitCode({ anyFailed, totalWritten }: { anyFailed: boolean; totalWritten: number }): number {
  if (anyFailed) {
    return EXIT_ERROR;
  }
  return totalWritten === 0 ? EXIT_EXPECTED_EMPTY : EXIT_OK;
}
