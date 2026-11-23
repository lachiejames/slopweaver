/**
 * `slopweaver atlas microsoft365 sync [--json] [--home <dir>]` — compile the pinned Microsoft Graph v1.0
 * specification into the atlas's `compiled` surface.
 *
 * The one network call it can make is a GET of an immutable, commit-addressed public document, and only when
 * that document is not already cached under the atlas root — so a second run of this verb makes no request at
 * all. It needs no Microsoft credential, reaches no tenant, and writes only under `$SLOPWEAVER_HOME`, which
 * is why it is `local-state` rather than `external-write` and routes through no door.
 */
import { microsoft365AtlasPaths } from "../../../atlas/microsoft365/store.js";
import { type Microsoft365SyncOutcome, syncMicrosoft365CompiledSurface } from "../../../atlas/microsoft365/sync.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlagTail, resolveHome, verbTail } from "../../optionParsers.js";

/** Where a verb sits: past the runtime, the script, the `atlas` noun and the `microsoft365` platform. */
const MICROSOFT365_VERB_INDEX = 4;

/**
 * Exported so a test can assert this equals the manifest's own copy.
 *
 * @internal
 */
export const MICROSOFT365_SYNC_USAGE = "usage: slopweaver atlas microsoft365 sync [--json] [--home <dir>]";

/** Parse the flag tail this verb accepts. */
function parseSyncOptions({ rest }: { rest: readonly string[] }): Result<{ home: string; json: boolean }> {
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json"], value: ["home"] } });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  return ok({ home: resolveHome({ named: parsed.value.values["home"] }), json: parsed.value.flags.has("json") });
}

/** Print what the sync published. */
function report({ asJson, outcome }: { asJson: boolean; outcome: Microsoft365SyncOutcome }): void {
  if (asJson) {
    logger.out({ line: JSON.stringify(outcome, null, 1) });
    return;
  }
  const counts = outcome.dispositionCounts;
  logger.out({
    line:
      `microsoft365 graph surface — ${String(outcome.operationCount)} operation(s) across ` +
      `${String(outcome.kindCount)} kind(s): ${String(counts.reachable)} reachable, ` +
      `${String(counts.voluminous)} voluminous, ${String(counts.excluded)} excluded`,
  });
  logger.out({
    line:
      `  specification read from ${outcome.specOrigin} at ${outcome.specPath}; ` +
      `${String(outcome.declaredPageCount)} admin-console page(s) declared and none visited`,
  });
  logger.out({
    line: "  the live Graph surface is NOT filled: no Entra application registration is configured, so no entity of this tenant has been read",
  });
}

/**
 * Compile and publish the Graph specification surface.
 *
 * @param argv the whole process argv
 * @returns the process exit code
 */
export async function microsoft365AtlasSyncCommand(argv: readonly string[]): Promise<number> {
  const rest = verbTail({ argv, at: MICROSOFT365_VERB_INDEX, verbs: ["sync"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: MICROSOFT365_SYNC_USAGE });
    return EXIT_OK;
  }
  const options = parseSyncOptions({ rest });
  if (options.isErr()) {
    options.error.forEach((line) => {
      logger.error({ msg: line });
    });
    logger.error({ msg: MICROSOFT365_SYNC_USAGE });
    return EXIT_USAGE;
  }
  const { home, json: asJson } = options.value;
  const published = await syncMicrosoft365CompiledSurface({
    at: new Date().toISOString(),
    paths: microsoft365AtlasPaths({ home }),
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
