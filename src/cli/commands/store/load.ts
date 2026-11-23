/**
 * `slopweaver store load` — a REPULL FROM SCRATCH into the store, from the providers, over one week.
 *
 * ## What every load before this one actually did, since that is the question this verb answers
 *
 * Every load into the store so far read an on-disk bronze `.jsonl`. `store ingest --file` was the only
 * path into `content` at all — reproduce with `grep -rn "insert(contentTable)" src`, which finds exactly
 * one site, in {@link ../../../store/ingest}. Nothing had ever pulled from a provider into the store.
 *
 * A repull from scratch, rather than porting on-disk bronze files into the docker store, is the regenerable
 * and resumable way to load. So this verb runs the connectors' own fetch and projection and writes what comes back
 * straight into the store. It reads no bronze file.
 *
 * ## Regenerable, and what "resumable" means when there is no byte offset
 *
 * `store ingest` resumes by BYTE OFFSET into a file. A live pull has no file, so it cannot. What it has
 * instead is that every write is an UPSERT on `(source, source_id)` and every leg is independent: a load
 * that dies after GitHub and Slack has stored those two, and re-running it re-pulls the same window and
 * overwrites the same rows rather than duplicating them. The unit of resumption is therefore the PLATFORM
 * plus the window, not a cursor — which is also the only unit that is honest, because a provider crawl
 * has no stable ordering to resume within.
 *
 * ## It is isolated from every cursor store on disk, in both directions
 *
 * This is not the file corpus's crawl, so it must leave the file corpus's resume state exactly as it found
 * it. Each leg is bounded by a `fetchCap`, which is what makes Slack's per-channel bronze committer stand
 * down (`tokenedJobsSlack.slackChannelCommitter` returns `undefined` for a bounded run) and what withholds
 * its thread cursors; GitHub org mode is passed `ignoreRepoCursors` for the READ half and `cursorIsolated`
 * for the write half, because its per-repo watermark store is a SECOND resume store that a `fetchCap`
 * alone does not withhold — a Codex planning pass caught exactly that, and the verified line is
 * `runGithubOrgActivity`'s advance, which used to be gated on `--sample` alone.
 *
 * **One side effect is stated rather than hidden**: Notion's crawl writes its own bronze durability
 * checkpoint per search page as it goes (`tokenedJobsNotion.flushNotionBatch`), regardless of bounding.
 * That is the connector's own kill-safety and it is not a port — nothing here READS a bronze file — but a
 * load does leave those bytes behind, and a reader of this module should know that before being surprised
 * by it.
 */
import { isOneOf } from "#lib/parsers.js";
import type { SourceIngestJob } from "../../../corpus/ingestJob.js";
import { DEFAULT_NOTION_CAPTURE_CAPS } from "../../../corpus/notion/caps.js";
import type { CorpusRecord, CorpusSource, ExportWindow } from "../../../corpus/types.js";
import { TOKENED_SOURCES } from "../../../integrations/corpusSources.js";
import { logger } from "../../../lib/logger.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { connectStore, type StoreClient } from "../../../store/client.js";
import { type IngestCache, ingestRecords, newIngestCache } from "../../../store/ingest.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import type { RefreshOptions, TokenedSource } from "../refresh/core.js";
import { githubOrgJob } from "../refresh/githubJobs.js";
import { sourceJob } from "../refresh/tokenedJobs.js";
import { resolveTokens } from "../refresh/tokens.js";
import { storeCommandErrorLines } from "./errors.js";
import {
  LOAD_CAP,
  LOAD_DAYS,
  loadLines,
  loadSucceeded,
  loadWindow,
  parseStoreLoadArgs,
  type SourceLoadResult,
} from "./loadCore.js";

const LOAD_USAGE =
  "usage: slopweaver store load [--source <a,b>] [--days <n>] [--cap <n>] [--github-org <org>] [--json]\n" +
  "  Pulls from the PROVIDERS into the store — never from a bronze file. Defaults to the last " +
  `${String(LOAD_DAYS)} day(s)\n  across github, slack, linear and notion, at most ${String(LOAD_CAP)} record(s) per platform.\n` +
  "  Every write is an upsert on (source, source id), so a re-run over the same window is idempotent and a\n" +
  "  load that died part-way is resumed by running it again. It touches no watermark or repo cursor.";

/** Whether a source is one the token gate covers — {@link TOKENED_SOURCES}, derived from the registry. */
function isTokened(value: CorpusSource): value is TokenedSource {
  return isOneOf(value, TOKENED_SOURCES);
}

/** Print refusal lines and the usage that follows them. */
function refuse({ lines }: { lines: readonly string[] }): number {
  lines.forEach((msg) => {
    logger.error({ msg });
  });
  logger.error({ msg: LOAD_USAGE });
  return EXIT_USAGE;
}

/**
 * The refresh options a load's GitHub leg runs under.
 *
 * Every field is stated rather than spread from a parsed `refresh` invocation, because a load is NOT a
 * refresh and a field silently inherited from one is how a load would quietly gain a behaviour nobody
 * asked it for. `sample` is deliberately absent: the write-half isolation is `cursorIsolated`, which says
 * what it means, rather than a `--sample` borrowed for its side effect.
 *
 * @param org the org to enumerate, when the caller named one
 * @param home the Slopweaver home
 * @returns the options object the GitHub job builder takes
 */
function githubOptionsFor({ org, home }: { org: string | undefined; home: string }): RefreshOptions {
  return {
    acceptFullHistory: false,
    all: false,
    allRepos: true,
    allSources: false,
    coverage: false,
    excludeRepos: [],
    home,
    ifStale: false,
    includeRepos: [],
    jit: false,
    noDerive: true,
    noEnrich: false,
    noNotionAttachments: true,
    notionCaps: DEFAULT_NOTION_CAPTURE_CAPS,
    numbersOnly: false,
    refetchUnchanged: false,
    self: false,
    selfExclude: [],
    selfRoots: [],
    slackChannels: [],
    store: false,
    sources: ["github"],
    ...(org !== undefined ? { githubOrg: org } : {}),
  };
}

/**
 * Build one platform's job, or say why it cannot run.
 *
 * @param source which platform
 * @param window the week being pulled
 * @param cap the per-platform record ceiling, which is what makes each leg cursor-isolated
 * @param home the Slopweaver home
 * @param org the GitHub org, when the caller named one
 * @param tokens the resolved provider tokens
 * @returns the job, or the reasons it could not be built
 */
function jobFor({
  source,
  window,
  cap,
  home,
  org,
  tokens,
}: {
  source: CorpusSource;
  window: ExportWindow;
  cap: number;
  home: string;
  org: string | undefined;
  tokens: Readonly<Partial<Record<TokenedSource, string | undefined>>>;
}): { job: SourceIngestJob } | { errors: readonly string[] } {
  if (source === "github") {
    const built = githubOrgJob({
      cursorIsolated: true,
      home,
      ignoreRepoCursors: true,
      options: githubOptionsFor({ home, org }),
      window,
    });
    return built.isErr() ? { errors: built.error } : { job: built.value };
  }
  if (!isTokened(source)) {
    return { errors: [`store load cannot pull ${source}`] };
  }
  const token = tokens[source];
  if (token === undefined) {
    return { errors: [`no ${source} token is configured — run \`slopweaver connect ${source}\``] };
  }
  return {
    job: sourceJob({
      // `cursorIsolated` is what withholds every cursor store, in both directions; `fetchCap` is only a
      // per-lane connector hint and is NOT the platform ceiling (see LOAD_CAP for what actually bounds).
      cursorIsolated: true,
      fetchCap: cap,
      home,
      // Reaches nothing on this path — `cursorIsolated` empties every cursor map before a channel is
      // planned, so no stored cursor exists for the clock to cap. Passed because the seam is required, and
      // required because a Slack REFRESH that forgot it banks tomorrow's date as a real ingest floor.
      nowIso: () => new Date().toISOString(),
      slackChannels: [],
      source,
      token,
      window,
    }),
  };
}

/**
 * The result one platform's leg earns when it did not finish, whatever stopped it.
 *
 * A named builder rather than two inline literals, because a `SourceLoadResult` has ten fields and the
 * failure arms differ in two of them — a copy that drifts is a leg reporting counts from the wrong run.
 *
 * @param source which platform
 * @param errors why it stopped
 * @param startedMs when the leg began, so its elapsed time is still true
 * @param fetched how many records the connector had returned before the failure, zero when it never did
 * @param offered how many of those the cap had let through
 * @param warnings whatever the connector said on its way
 * @returns the failed leg
 */
function failedLeg({
  source,
  errors,
  startedMs,
  fetched = 0,
  offered = 0,
  warnings = [],
}: {
  source: CorpusSource;
  errors: readonly string[];
  startedMs: number;
  fetched?: number;
  offered?: number;
  warnings?: readonly string[];
}): SourceLoadResult {
  return {
    collapsed: 0,
    elapsedMs: Date.now() - startedMs,
    errors,
    fetched,
    offered,
    ok: false,
    refused: 0,
    source,
    stored: 0,
    warnings,
  };
}

/**
 * Run one platform's job and write what it returned into the store.
 *
 * @param client the open store
 * @param cache the run's shared id cache, so a person seen on two platforms is resolved once
 * @param source which platform
 * @param job the built job
 * @param cap the per-platform record ceiling
 * @param home the Slopweaver home the denylist is resolved under
 * @returns what the leg did
 */
async function runLeg({
  client,
  cache,
  source,
  job,
  cap,
  home,
}: {
  client: StoreClient;
  cache: IngestCache;
  source: CorpusSource;
  job: SourceIngestJob;
  cap: number;
  home?: string;
}): Promise<SourceLoadResult> {
  const started = Date.now();
  const fetched = await job.run();
  if (fetched.isErr()) {
    return failedLeg({ errors: fetched.error, source, startedMs: started });
  }
  const all: readonly CorpusRecord[] = fetched.value.records;
  // Newest first, then capped — a cap that took the FIRST n of whatever order a connector happened to
  // return would silently mean "the oldest n" for one platform and "the newest n" for another, and the
  // whole point of the bound is that it is the most recent week.
  const offered = [...all].toSorted((left, right) => right.tsIso.localeCompare(left.tsIso)).slice(0, cap);
  const written = await ingestRecords({
    cache,
    client,
    records: offered,
    ...(home === undefined ? {} : { home }),
  });
  if (written.isErr()) {
    return failedLeg({
      errors: [written.error.message],
      fetched: all.length,
      offered: offered.length,
      source,
      startedMs: started,
      warnings: [...fetched.value.warnings],
    });
  }
  return {
    collapsed: written.value.duplicatesCollapsed,
    elapsedMs: Date.now() - started,
    errors: [],
    fetched: all.length,
    offered: offered.length,
    ok: true,
    refused: written.value.refusals.length,
    source,
    stored: written.value.recordsStored,
    warnings: [...fetched.value.warnings],
  };
}

/**
 * Pull one week from every named platform into the store.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runStoreLoad(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(argv[3] === "load" ? 4 : 3);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: LOAD_USAGE });
    return EXIT_OK;
  }
  const parsed = parseStoreLoadArgs({ rest });
  if (parsed.isErr()) {
    return refuse({ lines: storeCommandErrorLines({ error: parsed.error }) });
  }
  const args = parsed.value;
  // The SAME home the pull writes bronze under — a load that selected its database from the default home
  // while filing records under `--home` would fill one install's store from another's pull.
  const opened = await connectStore({ max: 4, ...(args.home === undefined ? {} : { home: args.home }) });
  if (opened.isErr()) {
    logger.error({ msg: opened.error.message });
    return EXIT_ERROR;
  }
  const client = opened.value;
  try {
    return await pullInto({
      cap: args.cap,
      client,
      days: args.days,
      home: resolveHome({ named: args.home }),
      json: args.json,
      org: args.org,
      sources: args.sources,
    });
  } finally {
    await client.close();
  }
}

/**
 * Run every leg in turn and report, one platform's failure never stopping another's.
 *
 * Sequential rather than concurrent, deliberately: each leg holds its whole capped window in the heap
 * while it writes, so running four at once would multiply the peak by four for a wall-clock saving on a
 * verb that is already dominated by provider rate limits.
 *
 * @param client the open store
 * @param sources which platforms to pull
 * @param days how far back
 * @param cap the per-platform record ceiling
 * @param home the Slopweaver home
 * @param org the GitHub org, when the caller named one
 * @param json whether to print the machine-readable report
 * @returns the process exit code
 */
async function pullInto({
  client,
  sources,
  days,
  cap,
  home,
  org,
  json,
}: {
  client: StoreClient;
  sources: readonly CorpusSource[];
  days: number;
  cap: number;
  home: string;
  org: string | undefined;
  json: boolean;
}): Promise<number> {
  const window = loadWindow({ days, now: new Date() });
  const tokens = resolveTokens();
  const cache = await newIngestCache({ client });
  const results: SourceLoadResult[] = [];
  for (const source of sources) {
    const built = jobFor({ cap, home, org, source, tokens, window });
    if ("errors" in built) {
      results.push(failedLeg({ errors: built.errors, source, startedMs: Date.now() }));
      continue;
    }
    logger.error({ msg: `store load: pulling ${source} over ${window.since}..${window.until}` });
    results.push(await runLeg({ cache, cap, client, home, job: built.job, source }));
  }
  if (json) {
    logger.out({ line: safeJsonStringify({ label: "store load", value: { cap, results, window } }) });
  } else {
    loadLines({ cap, results, window }).forEach((line) => {
      logger.out({ line });
    });
  }
  return loadSucceeded({ results }) ? EXIT_OK : EXIT_ERROR;
}

export const storeLoadCommand = defineCommand({ run: runStoreLoad });
