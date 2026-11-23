/**
 * `slopweaver atlas prisma-data-platform sync [--json] [--home <dir>]` — publish all three compiled surface
 * maps and the honest coverage for every kind none of them fills.
 *
 * No network call at all: the subjects are the platform's own OpenAPI document, generated into a committed
 * registry and pinned by digest, and two unauthenticated probe inventories whose results are committed. So
 * this is local-state rather than external-read, and it is what lets this atlas exist on an installation
 * that holds no Prisma credential.
 */
import { prismaDataPlatformAtlasPaths } from "../../../atlas/prismaDataPlatform/store.js";
import { type PrismaSyncOutcome, syncPrismaDataPlatformSurfaces } from "../../../atlas/prismaDataPlatform/sync.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlagTail, resolveHome, verbTail } from "../../optionParsers.js";

/** Where a verb sits: past the runtime, the script, `atlas` and the `prisma-data-platform` platform. */
const PRISMA_VERB_INDEX = 4;

/**
 * Exported so a test can assert this equals the manifest's own copy.
 * @internal
 */
export const PRISMA_DATA_PLATFORM_SYNC_USAGE =
  "usage: slopweaver atlas prisma-data-platform sync [--json] [--home <dir>]";

/** Parse the flag tail this verb accepts. */
function parseSyncOptions({ rest }: { rest: readonly string[] }): Result<{ home: string; json: boolean }> {
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json"], value: ["home"] } });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  return ok({ home: resolveHome({ named: parsed.value.values["home"] }), json: parsed.value.flags.has("json") });
}

/** Print what the sync published. */
function report({ asJson, outcome }: { asJson: boolean; outcome: PrismaSyncOutcome }): void {
  if (asJson) {
    logger.out({ line: JSON.stringify(outcome, null, 1) });
    return;
  }
  logger.out({
    line:
      `prisma-data-platform surface maps — ${String(outcome.operationCount)} declared operation(s), ` +
      `${String(outcome.documentedOperationCount)} of them documented; ` +
      `${String(outcome.confirmedAuthEndpointCount)} of ${String(outcome.authEndpointCount)} ` +
      `authorization endpoint(s) confirmed; ${String(outcome.consoleRouteCount)} console route(s) ` +
      `established; ${String(outcome.unreachableKindCount)} entity kind(s) report not-configured, ` +
      `${String(outcome.openGapCount)} gap(s) open`,
  });
}

/**
 * Run the Prisma Data Platform surface-map sync.
 *
 * @param argv the whole process argv
 * @returns the process exit code
 */
export function prismaDataPlatformAtlasSyncCommand(argv: readonly string[]): number {
  const rest = verbTail({ argv, at: PRISMA_VERB_INDEX, verbs: ["sync"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: PRISMA_DATA_PLATFORM_SYNC_USAGE });
    return EXIT_OK;
  }
  const options = parseSyncOptions({ rest });
  if (options.isErr()) {
    options.error.forEach((line) => {
      logger.error({ msg: line });
    });
    logger.error({ msg: PRISMA_DATA_PLATFORM_SYNC_USAGE });
    return EXIT_USAGE;
  }
  const { home, json: asJson } = options.value;
  const published = syncPrismaDataPlatformSurfaces({
    at: new Date().toISOString(),
    paths: prismaDataPlatformAtlasPaths({ home }),
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
