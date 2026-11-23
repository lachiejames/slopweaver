/**
 * `slopweaver atlas notion sync [--json] [--home <dir>]` — publish the API surface from the installed
 * `@notionhq/client`'s own generated declarations.
 *
 * No network call at all: the subject is the package on disk, so this is local-state rather than
 * external-read, and it is the half of the atlas that can be brought current with the browser closed.
 */
import { notionAtlasPaths } from "../../../atlas/notion/store.js";
import { type NotionSyncOutcome, syncNotionApiSurface } from "../../../atlas/notion/sync.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlagTail, resolveHome, verbTail } from "../../optionParsers.js";

/** Where a Notion atlas verb sits: past the runtime, the script, the `atlas` noun and the `notion` platform. */
const NOTION_VERB_INDEX = 4;

/**
 * Exported so a test can assert this equals the manifest's own copy.
 *
 * @internal
 */
export const NOTION_SYNC_USAGE = "usage: slopweaver atlas notion sync [--json] [--home <dir>]";

/** Parse the flag tail this verb accepts. */
function parseSyncOptions({ rest }: { rest: readonly string[] }): Result<{ home: string; json: boolean }> {
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json"], value: ["home"] } });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  return ok({ home: resolveHome({ named: parsed.value.values["home"] }), json: parsed.value.flags.has("json") });
}

/** Print what the sync published. */
function report({ asJson, outcome }: { asJson: boolean; outcome: NotionSyncOutcome }): void {
  if (asJson) {
    logger.out({ line: JSON.stringify(outcome, null, 1) });
    return;
  }
  logger.out({
    line:
      `notion api surface — ${String(outcome.endpointCount)} declared endpoint(s) over ` +
      `${String(outcome.routeCount)} route(s) across ${String(outcome.moduleCount)} module(s), ` +
      `from @notionhq/client ${outcome.sdkVersion}`,
  });
}

/**
 * Run the Notion API-surface sync.
 *
 * @param argv the whole process argv
 * @returns the process exit code
 */
export function notionAtlasSyncCommand(argv: readonly string[]): number {
  const rest = verbTail({ argv, at: NOTION_VERB_INDEX, verbs: ["sync"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: NOTION_SYNC_USAGE });
    return EXIT_OK;
  }
  const options = parseSyncOptions({ rest });
  if (options.isErr()) {
    options.error.forEach((line) => {
      logger.error({ msg: line });
    });
    logger.error({ msg: NOTION_SYNC_USAGE });
    return EXIT_USAGE;
  }
  const { home, json: asJson } = options.value;
  const published = syncNotionApiSurface({ at: new Date().toISOString(), paths: notionAtlasPaths({ home }) });
  if (published.isErr()) {
    published.error.forEach((line) => {
      logger.error({ msg: line });
    });
    return EXIT_ERROR;
  }
  report({ asJson, outcome: published.value });
  return EXIT_OK;
}
