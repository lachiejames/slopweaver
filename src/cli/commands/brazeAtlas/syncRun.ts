/**
 * `slopweaver atlas braze sync [--json] [--home <dir>]` — read Braze's own endpoint reference and its
 * official Postman collection into the atlas's two published surfaces.
 *
 * It fetches Braze's documentation sitemap, then each operation page whose `lastmod` has moved since the last
 * run, then the collection. It needs no Braze credential, reaches no workspace, and writes only under
 * `$SLOPWEAVER_HOME`, which is why it is `local-state` rather than `external-write` and routes through no
 * door.
 */
import { brazeAtlasPaths } from "../../../atlas/braze/store.js";
import { type BrazeSyncOutcome, syncBrazePublishedSurfaces } from "../../../atlas/braze/sync.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlagTail, resolveHome, verbTail } from "../../optionParsers.js";

/** Where a verb sits: past the runtime, the script, the `atlas` noun and the `braze` platform. */
const BRAZE_VERB_INDEX = 4;

/**
 * Exported so a test can assert this equals the manifest's own copy.
 *
 * @internal
 */
export const BRAZE_SYNC_USAGE = "usage: slopweaver atlas braze sync [--json] [--home <dir>]";

/** Parse the flag tail this verb accepts. */
function parseSyncOptions({ rest }: { rest: readonly string[] }): Result<{ home: string; json: boolean }> {
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json"], value: ["home"] } });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  return ok({ home: resolveHome({ named: parsed.value.values["home"] }), json: parsed.value.flags.has("json") });
}

/**
 * The human report of one sync, one line per element — pure, so the unserved-page lines have a witness.
 *
 * @param outcome what the sync published
 * @returns the lines to print, in order: the census, then census drift, then one line per page the sitemap
 *   declares and Braze does not serve
 */
export function renderBrazeSyncLines({ outcome }: { outcome: BrazeSyncOutcome }): readonly string[] {
  const counts = outcome.dispositionCounts;
  return [
    `braze surface maps — ${String(outcome.operationCount)} distinct operation(s) across two published ` +
      `sources: ${String(counts.reachable)} reachable, ${String(counts.voluminous)} voluminous ` +
      `(enumerated and declared, never stored whole), ${String(counts.excluded)} excluded`,
    `  reference ${String(outcome.documentedCount)} operation(s) (${String(outcome.pagesFetched)} page(s) ` +
      `fetched, ${String(outcome.pagesFromCache)} from cache) · collection ` +
      `${String(outcome.collectionOperationCount)} distinct from ${String(outcome.collectionRequestCount)} request(s)`,
    `  they agree on ${String(outcome.corroboratedCount)}, the reference alone has ` +
      `${String(outcome.docsOnlyCount)}, the collection alone has ${String(outcome.collectionOnlyCount)} — ` +
      "read them with `slopweaver atlas braze report`",
    `  ${String(outcome.declaredRouteCount)} dashboard route(s) declared and none walked. Neither the REST ` +
      "surface nor the dashboard is filled: this installation has no Braze API key and no Braze account",
    ...outcome.censusDrift.map((line) => `  census drift — ${line}`),
    ...outcome.unservedPages.map(
      (page) =>
        `  unserved documentation page — ${page.url} served as ${page.servedAs}; the sitemap declares it and ` +
        "Braze does not publish it yet, so it carries no operation and is asked for again next run",
    ),
  ];
}

/** Print what the sync published. */
function report({ asJson, outcome }: { asJson: boolean; outcome: BrazeSyncOutcome }): void {
  if (asJson) {
    logger.out({ line: safeJsonStringify({ label: "the braze sync outcome", space: 1, value: outcome }) });
    return;
  }
  for (const line of renderBrazeSyncLines({ outcome })) {
    logger.out({ line });
  }
}

/**
 * Read both published sources and publish them.
 *
 * @param argv the whole process argv
 * @returns the process exit code
 */
export async function brazeAtlasSyncCommand(argv: readonly string[]): Promise<number> {
  const rest = verbTail({ argv, at: BRAZE_VERB_INDEX, verbs: ["sync"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: BRAZE_SYNC_USAGE });
    return EXIT_OK;
  }
  const options = parseSyncOptions({ rest });
  if (options.isErr()) {
    options.error.forEach((line) => {
      logger.error({ msg: line });
    });
    logger.error({ msg: BRAZE_SYNC_USAGE });
    return EXIT_USAGE;
  }
  const { home, json: asJson } = options.value;
  const published = await syncBrazePublishedSurfaces({
    at: new Date().toISOString(),
    paths: brazeAtlasPaths({ home }),
  });
  if (published.isErr()) {
    published.error.forEach((line) => {
      logger.error({ msg: line });
    });
    return EXIT_ERROR;
  }
  report({ asJson, outcome: published.value });
  return EXIT_OK;
}
