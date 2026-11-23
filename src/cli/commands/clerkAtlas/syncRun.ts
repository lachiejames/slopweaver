/**
 * `slopweaver atlas clerk sync [--json] [--home <dir>]` — publish the compiled surface from the four Clerk
 * documents pinned in `atlas/clerk/specLock.ts`.
 *
 * It needs no credential and reaches no Clerk account. The one network call it can make is the first fetch
 * of a pinned, commit-addressed document from a source-code host; once cached under the atlas root and
 * digest-verified, later runs are entirely offline. That is why this is `local-state` rather than
 * `external-read` on its manifest row.
 */
import { clerkAtlasPaths } from "../../../atlas/clerk/store.js";
import { type ClerkSyncOutcome, syncClerkCompiledSurface } from "../../../atlas/clerk/sync.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlagTail, resolveHome, verbTail } from "../../optionParsers.js";

/** Where a Clerk atlas verb sits: past the runtime, the script, the `atlas` noun and the `clerk` platform. */
const CLERK_VERB_INDEX = 4;

/**
 * Exported so a test can assert this equals the manifest's own copy.
 *
 * @internal
 */
export const CLERK_SYNC_USAGE = "usage: slopweaver atlas clerk sync [--json] [--home <dir>]";

/** Parse the flag tail this verb accepts. */
function parseSyncOptions({ rest }: { rest: readonly string[] }): Result<{ home: string; json: boolean }> {
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json"], value: ["home"] } });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  return ok({ home: resolveHome({ named: parsed.value.values["home"] }), json: parsed.value.flags.has("json") });
}

/** Print what the sync published. */
function report({ asJson, outcome }: { asJson: boolean; outcome: ClerkSyncOutcome }): void {
  if (asJson) {
    logger.out({ line: JSON.stringify(outcome, null, 1) });
    return;
  }
  const apis = Object.entries(outcome.apiCounts)
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([api, count]) => `${api} ${String(count)}`)
    .join(", ");
  logger.out({
    line: `clerk published surface — ${String(outcome.operationCount)} operation(s) (${apis}) and ${String(outcome.webhookEventCount)} webhook event(s)`,
  });
  logger.out({
    line:
      `clerk dispositions — ${String(outcome.dispositionCounts.reachable)} reachable, ` +
      `${String(outcome.dispositionCounts.voluminous)} voluminous (enumerated, never stored whole), ` +
      `${String(outcome.dispositionCounts.excluded)} excluded. A compiled operation is a DECLARATION, never a capability`,
  });
}

/**
 * Run the Clerk compiled-surface sync.
 *
 * @param argv the whole process argv
 * @returns the process exit code
 */
export async function clerkAtlasSyncCommand(argv: readonly string[]): Promise<number> {
  const rest = verbTail({ argv, at: CLERK_VERB_INDEX, verbs: ["sync"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: CLERK_SYNC_USAGE });
    return EXIT_OK;
  }
  const options = parseSyncOptions({ rest });
  if (options.isErr()) {
    options.error.forEach((line) => {
      logger.error({ msg: line });
    });
    logger.error({ msg: CLERK_SYNC_USAGE });
    return EXIT_USAGE;
  }
  const { home, json: asJson } = options.value;
  const published = await syncClerkCompiledSurface({
    at: new Date().toISOString(),
    paths: clerkAtlasPaths({ home }),
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
