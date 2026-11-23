/**
 * `slopweaver atlas nx-cloud sync [--org <id>] [--workspace <id>] [--json] [--home <dir>]` — fill the
 * `web-data` surface by reading Nx Cloud with the owner's own signed-in session.
 *
 * It opens no browser (`docs/browser-route.md`): `docs/browser-route/proof-and-capture-verbs.md`'s first mechanism is a READ of the owner's own Chrome cookie jar, and
 * the calls themselves are ordinary HTTP. Nothing is written outside `$SLOPWEAVER_HOME`.
 */
import { createFetchTransport } from "../../../atlas/nxCloud/client.js";
import { nxCloudAtlasPaths } from "../../../atlas/nxCloud/store.js";
import { type NxCloudSyncOutcome, syncNxCloudWebData } from "../../../atlas/nxCloud/sync.js";
import { recordedProfilePort } from "../../../browser/recordedProfile.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlagTail, resolveHome, verbTail } from "../../optionParsers.js";

import { resolveNxCloudScopes } from "./scope.js";

/** Where an Nx Cloud atlas verb sits: past the runtime, the script, the `atlas` noun and the platform. */
const NX_CLOUD_VERB_INDEX = 4;

/**
 * Exported so a test can assert this equals the manifest's own copy.
 *
 * @internal
 */
export const NX_CLOUD_SYNC_USAGE =
  "usage: slopweaver atlas nx-cloud sync [--org <id>] [--workspace <id>] [--json] [--home <dir>]";

/** What this verb accepts. */
interface SyncOptions {
  readonly home: string;
  readonly json: boolean;
  readonly orgId: string | undefined;
  readonly workspaceId: string | undefined;
}

/**
 * Parse the flag tail this verb accepts.
 *
 * @param rest the argv tail past the verb
 * @returns the options, or why the invocation is unusable
 */
function parseSyncOptions({ rest }: { rest: readonly string[] }): Result<SyncOptions> {
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json"], value: ["home", "org", "workspace"] } });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  return ok({
    home: resolveHome({ named: parsed.value.values["home"] }),
    json: parsed.value.flags.has("json"),
    orgId: parsed.value.values["org"],
    workspaceId: parsed.value.values["workspace"],
  });
}

/**
 * Print what one scope's sync published.
 *
 * @param asJson whether to print the machine shape
 * @param outcomes what each scope's sync did
 */
function report({ asJson, outcomes }: { asJson: boolean; outcomes: readonly NxCloudSyncOutcome[] }): void {
  if (asJson) {
    logger.out({ line: JSON.stringify(outcomes, null, 1) });
    return;
  }
  for (const outcome of outcomes) {
    const counts = Object.entries(outcome.entityCounts)
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([kind, count]) => `${String(count)} ${kind}`)
      .join(", ");
    logger.out({
      line:
        `nx-cloud web-data — workspace ${outcome.scope.workspaceId}: ${counts}; ` +
        `${String(outcome.openGapCount)} open gap(s)`,
    });
  }
}

/**
 * Run the Nx Cloud `web-data` sync.
 *
 * @param argv the whole process argv
 * @returns the process exit code
 */
export async function nxCloudAtlasSyncCommand(argv: readonly string[]): Promise<number> {
  const rest = verbTail({ argv, at: NX_CLOUD_VERB_INDEX, verbs: ["sync"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: NX_CLOUD_SYNC_USAGE });
    return EXIT_OK;
  }
  const options = parseSyncOptions({ rest });
  if (options.isErr()) {
    options.error.forEach((line) => {
      logger.error({ msg: line });
    });
    logger.error({ msg: NX_CLOUD_SYNC_USAGE });
    return EXIT_USAGE;
  }
  const { home, json: asJson, orgId, workspaceId } = options.value;
  const paths = nxCloudAtlasPaths({ home });
  const scopes = resolveNxCloudScopes({ orgId, paths, workspaceId });
  if (scopes.isErr()) {
    scopes.error.forEach((line) => {
      logger.error({ msg: line });
    });
    return EXIT_USAGE;
  }
  const deps = {
    nowIso: (): string => new Date().toISOString(),
    profiles: recordedProfilePort(),
    transport: createFetchTransport(),
  };
  const outcomes: NxCloudSyncOutcome[] = [];
  for (const scope of scopes.value) {
    const synced = await syncNxCloudWebData({ deps, home, paths, scope });
    if (synced.isErr()) {
      synced.error.forEach((line) => {
        logger.error({ msg: line });
      });
      return EXIT_ERROR;
    }
    outcomes.push(synced.value);
  }
  report({ asJson, outcomes });
  return EXIT_OK;
}
