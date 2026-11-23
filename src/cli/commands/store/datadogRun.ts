/**
 * The effectful half of the Datadog leg of `store probe | groups | hits | peek | open | around`.
 *
 * Every line it prints is built in {@link ./datadogCore}; every query is built in
 * {@link ../../../datadog/detective/ladder}; what is here is open the client, resolve the window, run, cache
 * and emit.
 *
 * ## The retention ceiling is checked before every call, not after
 *
 * The knowledge register's tier-1 row: *"The prod index keeps ~15 days; a longer window silently returns the
 * same short series. A zero for an older window means 'not retained', never 'no events'."* So a window past
 * retention is refused rather than run, and the retention it is checked against comes from the built
 * catalogue's own index listing rather than from a constant — an organisation that buys longer retention
 * should not have to change this code, and one whose index shrinks should be refused sooner.
 */

import { createDatadogClient, type DatadogClient } from "../../../datadog/client.js";
import { datadogConfigErrorLines } from "../../../datadog/configErrors.js";
import { cacheRecords, readCachedRecords } from "../../../datadog/detective/hitsCache.js";
import { type DatadogRecord, parseDatadogRecordId } from "../../../datadog/detective/record.js";
import {
  checkRetention,
  type DatadogAroundMode,
  runDatadogAround,
  runDatadogGroups,
  runDatadogHits,
  runDatadogLadder,
} from "../../../datadog/detective/search.js";
import { readCatalogue } from "../../../datadog/detective/store.js";
import { datadogDomainErrorLines } from "../../../datadog/domainErrors.js";
import { loadDatadogConfig } from "../../../datadog/source.js";
import { type AbsoluteWindow, resolveWindow } from "../../../datadog/window.js";
import { slopweaverHome } from "../../../homeDir.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import {
  type DatadogScope,
  datadogAroundLines,
  datadogGroupLines,
  datadogHitsLines,
  datadogLadderLines,
  datadogOpenLines,
  datadogPeekLines,
} from "./datadogCore.js";
import { type StoreCommandError, StoreCommandErrors, storeCommandErrorLines } from "./errors.js";

/** Everything a Datadog leg needs before its first call. *
 * @internal
 */
export interface DatadogLeg {
  readonly client: DatadogClient;
  readonly window: AbsoluteWindow;
  readonly home: string;
}

/**
 * Resolve the client, the window and the retention ceiling, or say why the leg cannot run.
 *
 * @param scope the window and environment narrowing the caller asked for
 * @param home the Slopweaver home
 * @returns the leg, or every reason it was refused
 *
 * @internal
 */
export function openDatadogLeg({
  scope,
  home = slopweaverHome(),
}: {
  scope: DatadogScope;
  home?: string;
}): Result<DatadogLeg> {
  const window = resolveWindow({ from: scope.from, nowMs: Date.now(), to: scope.to });
  if (window.isErr()) {
    return err(datadogDomainErrorLines({ error: window.error }));
  }
  const config = loadDatadogConfig({ home });
  if (config.isErr()) {
    return err(datadogConfigErrorLines({ error: config.error }));
  }
  // The catalogue is consulted for its retention only, and its ABSENCE is not a refusal: a detective that
  // has not built one yet can still search, it just has no local gate in front of the search. The assumed
  // ceiling in `checkRetention` is what covers that case, and it is named there rather than here.
  const catalogue = readCatalogue({ home });
  const retained = catalogue.isOk() ? catalogue.value.manifest.retentionDays : null;
  const retention = checkRetention({ retentionDays: retained, window: window.value });
  if (retention.isErr()) {
    return err([retention.error.message]);
  }
  return ok({ client: createDatadogClient({ config: config.value, logger }), home, window: window.value });
}

/**
 * Emit a Datadog report, as JSON on stdout or as lines on stdout.
 *
 * @param json whether the caller asked for the machine-readable form
 * @param lines the human report
 * @param payload the machine-readable document
 */
function emit({ json, lines, payload }: { json: boolean; lines: readonly string[]; payload: unknown }): void {
  if (json) {
    logger.out({ line: safeJsonStringify({ label: "store datadog report", value: payload }) });
    return;
  }
  lines.forEach((line) => {
    logger.out({ line });
  });
}

/** Print every refusal and return the caller-mistake exit code. */
function refuse({ lines }: { lines: readonly string[] }): number {
  lines.forEach((msg) => {
    logger.error({ msg });
  });
  return EXIT_USAGE;
}

/**
 * Fan every keyword across Datadog's four rungs.
 *
 * @param terms the keywords
 * @param scope the window and environment narrowing
 * @param json whether the caller asked for the machine-readable form
 * @returns the process exit code
 */
export async function probeOverDatadog({
  terms,
  scope,
  json,
}: {
  terms: readonly string[];
  scope: DatadogScope;
  json: boolean;
}): Promise<number> {
  const leg = openDatadogLeg({ scope });
  if (leg.isErr()) {
    return refuse({ lines: leg.error });
  }
  const reports = [];
  for (const term of terms) {
    const report = await runDatadogLadder({
      client: leg.value.client,
      envs: scope.envs,
      term,
      window: leg.value.window,
    });
    if (report.isErr()) {
      logger.error({ msg: report.error.message });
      return EXIT_ERROR;
    }
    reports.push(report.value);
  }
  emit({
    json,
    lines: reports.flatMap((report) => datadogLadderLines({ report })),
    payload: { reports, source: "datadog" },
  });
  return EXIT_OK;
}

/**
 * Split one rung's hits by a Datadog facet.
 *
 * @param term the keyword
 * @param rung which rung to split
 * @param facet the Datadog facet
 * @param limit how many groups
 * @param scope the window and environment narrowing
 * @param json whether the caller asked for the machine-readable form
 * @returns the process exit code
 */
export async function groupsOverDatadog({
  term,
  rung,
  facet,
  limit,
  scope,
  json,
}: {
  term: string;
  rung: Parameters<typeof runDatadogGroups>[0]["rung"];
  facet: string;
  limit: number;
  scope: DatadogScope;
  json: boolean;
}): Promise<number> {
  const leg = openDatadogLeg({ scope });
  if (leg.isErr()) {
    return refuse({ lines: leg.error });
  }
  const buckets = await runDatadogGroups({
    client: leg.value.client,
    envs: scope.envs,
    facet,
    limit,
    rung,
    term,
    window: leg.value.window,
  });
  if (buckets.isErr()) {
    logger.error({ msg: buckets.error.message });
    return EXIT_ERROR;
  }
  emit({
    json,
    lines: datadogGroupLines({ buckets: buckets.value, envs: scope.envs, facet, window: leg.value.window }),
    payload: { buckets: buckets.value, facet, rung, source: "datadog", term },
  });
  return EXIT_OK;
}

/**
 * Read one page of one rung's events, cache them, and print them.
 *
 * The caching is what makes the rest of the ladder possible at all — Datadog has no get-by-id route, so an
 * id this page mints is readable by `peek`/`open`/`around` only because the event was kept.
 *
 * @param term the keyword
 * @param rung which rung to page
 * @param limit how many events
 * @param regex a pattern to filter the page by LOCALLY, or nothing
 * @param scope the window and environment narrowing
 * @param json whether the caller asked for the machine-readable form
 * @returns the process exit code
 */
export async function hitsOverDatadog({
  term,
  rung,
  limit,
  regex,
  scope,
  json,
}: {
  term: string;
  rung: Parameters<typeof runDatadogHits>[0]["rung"];
  limit: number;
  regex: string | undefined;
  scope: DatadogScope;
  json: boolean;
}): Promise<number> {
  const leg = openDatadogLeg({ scope });
  if (leg.isErr()) {
    return refuse({ lines: leg.error });
  }
  const page = await runDatadogHits({
    client: leg.value.client,
    envs: scope.envs,
    limit,
    rung,
    term,
    window: leg.value.window,
  });
  if (page.isErr()) {
    logger.error({ msg: page.error.message });
    return EXIT_ERROR;
  }
  // The WHOLE page is cached, then the regex filters what is PRINTED. Caching only the matches would make
  // `--regex` quietly decide what a later `open` can reach, which is a different thing from what it says.
  cacheRecords({ home: leg.value.home, records: page.value });
  const shown = filterByRegex({ pattern: regex, records: page.value });
  if (shown.isErr()) {
    return refuse({ lines: storeCommandErrorLines({ error: shown.error }) });
  }
  emit({
    json,
    lines: datadogHitsLines({ envs: scope.envs, records: shown.value, window: leg.value.window }),
    payload: { fetched: page.value.length, records: shown.value, rung, source: "datadog", term },
  });
  return EXIT_OK;
}

/**
 * Filter one page by a caller's regex, applied HERE because Datadog's syntax has none.
 *
 * @param records the page
 * @param pattern the caller's regex, or nothing
 * @returns the matching records, or the reason the pattern was refused
 */
export function filterByRegex({
  records,
  pattern,
}: {
  records: readonly DatadogRecord[];
  pattern: string | undefined;
}): Result<readonly DatadogRecord[], StoreCommandError> {
  if (pattern === undefined) {
    return ok(records);
  }
  let matcher: RegExp;
  try {
    matcher = new RegExp(pattern, "i");
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    return err(StoreCommandErrors.regexInvalid({ detail, pattern }));
  }
  return ok(records.filter((record) => matcher.test(record.text)));
}

/**
 * Show a window of each named Datadog record, centred on the match.
 *
 * @param ids the `dd:` ids
 * @param match the term to centre on, or nothing
 * @param chars how many characters of window
 * @param json whether the caller asked for the machine-readable form
 * @returns the process exit code
 */
export function peekOverDatadog({
  ids,
  match,
  chars,
  json,
  home = slopweaverHome(),
}: {
  ids: readonly string[];
  match: string | undefined;
  chars: number;
  json: boolean;
  home?: string;
}): number {
  const found = readCachedRecords({ home, ids });
  const records = ids.map((id) => found.get(id)).filter((record): record is DatadogRecord => record !== undefined);
  const missing = ids.filter((id) => !found.has(id));
  emit({
    json,
    lines: datadogPeekLines({ chars, match, missing, records }),
    payload: { missing, records, source: "datadog" },
  });
  return missing.length === ids.length ? EXIT_ERROR : EXIT_OK;
}

/**
 * Print each named Datadog record whole and unmasked.
 *
 * @param ids the `dd:` ids
 * @param json whether the caller asked for the machine-readable form
 * @returns the process exit code
 */
export function openOverDatadog({
  ids,
  json,
  home = slopweaverHome(),
}: {
  ids: readonly string[];
  json: boolean;
  home?: string;
}): number {
  const found = readCachedRecords({ home, ids });
  const records = ids.map((id) => found.get(id)).filter((record): record is DatadogRecord => record !== undefined);
  const missing = ids.filter((id) => !found.has(id));
  emit({ json, lines: datadogOpenLines({ missing, records }), payload: { missing, records, source: "datadog" } });
  return missing.length === ids.length ? EXIT_ERROR : EXIT_OK;
}

/**
 * Read what was happening around one Datadog event.
 *
 * @param id the `dd:` id
 * @param mode which correlation to follow
 * @param limit how many neighbours
 * @param scope the window and environment narrowing
 * @param json whether the caller asked for the machine-readable form
 * @returns the process exit code
 */
export async function aroundOverDatadog({
  id,
  mode,
  limit,
  scope,
  json,
}: {
  id: string;
  mode: DatadogAroundMode;
  limit: number;
  scope: DatadogScope;
  json: boolean;
}): Promise<number> {
  if (parseDatadogRecordId({ id }) === null) {
    return refuse({ lines: [`"${id}" is not a Datadog record id — one looks like dd:log:<datadog event id>`] });
  }
  const leg = openDatadogLeg({ scope });
  if (leg.isErr()) {
    return refuse({ lines: leg.error });
  }
  const anchor = readCachedRecords({ home: leg.value.home, ids: [id] }).get(id);
  if (anchor === undefined) {
    return refuse({
      lines: [
        `${id} is not in this install's Datadog hit cache, and Datadog has no get-by-id route to re-fetch it.`,
        "Run `slopweaver store hits --source datadog --term <t>` to fetch the page that mints the id first.",
      ],
    });
  }
  const neighbours = await runDatadogAround({
    client: leg.value.client,
    limit,
    mode,
    record: anchor,
    window: leg.value.window,
  });
  if (neighbours.isErr()) {
    logger.error({ msg: neighbours.error.message });
    return EXIT_ERROR;
  }
  cacheRecords({ home: leg.value.home, records: neighbours.value });
  emit({
    json,
    lines: datadogAroundLines({ anchor, mode, neighbours: neighbours.value, window: leg.value.window }),
    payload: { anchor, mode, neighbours: neighbours.value, source: "datadog" },
  });
  return EXIT_OK;
}
