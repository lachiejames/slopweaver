/**
 * `slopweaver atlas figma sync [--json] [--home <dir>]` — publish both compiled surface maps and the honest
 * coverage for every kind neither of them fills.
 *
 * No network call at all: the subjects are Figma's own OpenAPI document, generated into a committed
 * registry and pinned by digest, and a browser route inventory measured without an account. So this is
 * local-state rather than external-read, and it is what lets this atlas exist on an installation that holds
 * no Figma credential.
 */
import { figmaAtlasPaths } from "../../../atlas/figma/store.js";
import { type FigmaSyncOutcome, syncFigmaSurfaces } from "../../../atlas/figma/sync.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlagTail, resolveHome, verbTail } from "../../optionParsers.js";

/** Where a Figma atlas verb sits: past the runtime, the script, `atlas` and the `figma` platform. */
const FIGMA_VERB_INDEX = 4;

/**
 * Exported so a test can assert this equals the manifest's own copy.
 * @internal
 */
export const FIGMA_SYNC_USAGE = "usage: slopweaver atlas figma sync [--json] [--home <dir>]";

/** Parse the flag tail this verb accepts. */
function parseSyncOptions({ rest }: { rest: readonly string[] }): Result<{ home: string; json: boolean }> {
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json"], value: ["home"] } });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  return ok({ home: resolveHome({ named: parsed.value.values["home"] }), json: parsed.value.flags.has("json") });
}

/** Print what the sync published. */
function report({ asJson, outcome }: { asJson: boolean; outcome: FigmaSyncOutcome }): void {
  if (asJson) {
    logger.out({ line: JSON.stringify(outcome, null, 1) });
    return;
  }
  logger.out({
    line:
      `figma surface maps — ${String(outcome.operationCount)} declared operation(s) and ` +
      `${String(outcome.routeCount)} browser route(s), ${String(outcome.confirmedRouteCount)} confirmed to ` +
      `exist and ${String(outcome.absentRouteCount)} confirmed absent; ` +
      `${String(outcome.unreachableKindCount)} entity kind(s) report not-configured, ` +
      `${String(outcome.openGapCount)} gap(s) open`,
  });
}

/**
 * Run the Figma surface-map sync.
 *
 * @param argv the whole process argv
 * @returns the process exit code
 */
export function figmaAtlasSyncCommand(argv: readonly string[]): number {
  const rest = verbTail({ argv, at: FIGMA_VERB_INDEX, verbs: ["sync"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: FIGMA_SYNC_USAGE });
    return EXIT_OK;
  }
  const options = parseSyncOptions({ rest });
  if (options.isErr()) {
    options.error.forEach((line) => {
      logger.error({ msg: line });
    });
    logger.error({ msg: FIGMA_SYNC_USAGE });
    return EXIT_USAGE;
  }
  const { home, json: asJson } = options.value;
  const published = syncFigmaSurfaces({ at: new Date().toISOString(), paths: figmaAtlasPaths({ home }) });
  if (published.isErr()) {
    published.error.forEach((line) => {
      logger.error({ msg: line });
    });
    return EXIT_ERROR;
  }
  report({ asJson, outcome: published.value });
  return EXIT_OK;
}
