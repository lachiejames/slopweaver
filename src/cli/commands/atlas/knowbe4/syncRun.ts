/**
 * `slopweaver atlas knowbe4 sync [--json] [--home <dir>]` — read the KnowBe4 account under the stored Reporting
 * API token and publish who owes training and how each person did on each phishing test.
 *
 * Every call is a GET through `live/knowbe4/transport.ts`, which can express nothing else, to
 * `us.api.knowbe4.com`. Eleven paths are called (`atlas/knowbe4/fill/plan.ts` says which and why not the rest);
 * every row is kept as allowlisted fields, so a recipient's IP and device and a user's phone and manager never
 * reach the store.
 *
 * No token is the expected first state, not a fault: the owner provisions it themselves, so the verb prints the
 * ONE hand step — where the token is minted and which file it goes in — and exits `EXIT_EXPECTED_EMPTY` (3),
 * a prerequisite absent rather than anything broken.
 */
import { type Knowbe4FillObservation, runKnowbe4Fill } from "../../../../atlas/knowbe4/fill/run.js";
import { withTokenWithheld } from "../../../../atlas/knowbe4/fill/withheld.js";
import { type Knowbe4SyncReport, syncKnowbe4Atlas } from "../../../../atlas/knowbe4/sync.js";
import { logger } from "../../../../lib/logger.js";
import { scopeIdForToken } from "../../../../lib/providerCall.js";
import { KNOWBE4_TOKEN_HAND_STEP, resolveKnowbe4Token } from "../../../../live/knowbe4/credential.js";
import { knowbe4Get } from "../../../../live/knowbe4/transport.js";
import { defineCommand } from "../../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../exitCodes.js";
import { parseFlagTail, resolveHome, verbTail } from "../../../optionParsers.js";

/** Where a verb sits: past the runtime, the script, the `atlas` noun and the `knowbe4` platform. */
const KNOWBE4_VERB_INDEX = 4;

/**
 * Exported so a test can assert this equals the registration's own copy.
 * @internal
 */
export const KNOWBE4_SYNC_USAGE = "usage: slopweaver atlas knowbe4 sync [--json] [--home <dir>]";

/**
 * Run the `atlas knowbe4 sync` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 * @internal
 */
export async function runKnowbe4SyncVerb(argv: readonly string[]): Promise<number> {
  const rest = verbTail({ argv, at: KNOWBE4_VERB_INDEX, verbs: ["sync"] });
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json"], value: ["home"] } });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      logger.error({ msg: problem });
    });
    logger.error({ msg: KNOWBE4_SYNC_USAGE });
    return EXIT_USAGE;
  }
  const home = resolveHome({ named: parsed.value.values["home"] });
  const token = resolveKnowbe4Token({ home });
  if (token.isErr()) {
    logger.error({ msg: `knowbe4 atlas sync: ${token.error.message}` });
    if (token.error.code === "TOKEN_MISSING") {
      logger.error({ msg: `hand step for the owner: ${KNOWBE4_TOKEN_HAND_STEP}` });
      return EXIT_EXPECTED_EMPTY;
    }
    return EXIT_ERROR;
  }
  const scopeId = scopeIdForToken({ token: token.value });
  const fill = withTokenWithheld({
    fill: await runKnowbe4Fill({
      at: new Date().toISOString(),
      get: ({ url }) => knowbe4Get({ scopeId, token: token.value, url }),
    }),
    token: token.value,
  });
  const published = syncKnowbe4Atlas({ fill, home });
  if (published.isErr()) {
    published.error.forEach((reason) => {
      logger.error({ msg: `knowbe4 atlas sync: publish refused — ${reason}` });
    });
    for (const failure of fill.failed) {
      logger.warn({ msg: `${failure.template} answered ${String(failure.status)} — ${failure.message}` });
    }
    return EXIT_ERROR;
  }
  printSyncReport({ fill, json: parsed.value.flags.has("json"), report: published.value });
  return syncExitCode({ fill });
}

/**
 * The exit for a sync whose generation published. A path that failed, or answered but stopped at a bound, still
 * publishes what it has, but the run is not a whole read, so a scheduler or `sync || alert` sees it. A 403 is the
 * one failure that is not a fault — its own, or its parent list's: the kind is stamped with the subscription tier
 * that would lift it, and a surface the token may not read is the atlas working.
 *
 * @param fill what the run brought back
 * @returns `EXIT_ERROR` when any path failed on anything but a 403 or stopped at a bound, else `EXIT_OK`
 * @internal
 */
export function syncExitCode({ fill }: { fill: Knowbe4FillObservation }): number {
  const faulted = fill.failed.some((failure) => failure.status !== 403);
  const bounded = fill.answered.some((answered) => answered.truncatedBy !== null);
  return faulted || bounded ? EXIT_ERROR : EXIT_OK;
}

/**
 * Print what one sync read and published, as a JSON document or as lines for a reader.
 *
 * @param fill what the run brought back
 * @param report what the publish wrote
 * @param json whether `--json` was passed
 */
function printSyncReport({
  fill,
  report,
  json,
}: {
  fill: Knowbe4FillObservation;
  report: Knowbe4SyncReport;
  json: boolean;
}): void {
  if (json) {
    logger.out({
      line: JSON.stringify(
        {
          answered: fill.answered.map((entry) => ({
            items: entry.items.length,
            path: entry.template,
            truncatedBy: entry.truncatedBy,
          })),
          entitiesByKind: report.entitiesByKind,
          failed: fill.failed.map((entry) => ({ message: entry.message, path: entry.template, status: entry.status })),
          filledAtIso: fill.filledAtIso,
        },
        undefined,
        2,
      ),
    });
    return;
  }
  const items = fill.answered.reduce((total, entry) => total + entry.items.length, 0);
  logger.out({
    line: `knowbe4 atlas sync — ${String(fill.answered.length)} of ${String(fill.answered.length + fill.failed.length)} path(s) answered, ${String(items)} row(s) stored`,
  });
  for (const failure of fill.failed) {
    logger.warn({ msg: `${failure.template} answered ${String(failure.status)} — ${failure.message}` });
  }
  logger.out({
    line: "rows keep allowlisted fields only, never a recipient's IP or device — run `slopweaver atlas knowbe4 coverage` for each kind's cells",
  });
}

export const knowbe4SyncCommand = defineCommand({ run: runKnowbe4SyncVerb });
