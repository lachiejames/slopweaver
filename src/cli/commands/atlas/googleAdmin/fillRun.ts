/**
 * `slopweaver atlas google-admin fill [--json] [--home <dir>]` — the live half of this atlas.
 *
 * It reads the stored grant, calls every published operation that grant reaches, and republishes the
 * generation with the `admin-api` channel filled. It is a SEPARATE verb from `sync` on purpose: `sync`
 * compiles eleven pinned documents and needs no credential and no network, and folding a credentialed read
 * into it would make the one verb every install can run depend on a consent most installs will not have.
 *
 * Nothing it can call changes anything. Every operation in the plan is a GET whose disposition is `entity`,
 * and every scope the grant can carry is a `.readonly` one.
 */
import { runGoogleAdminFill } from "../../../../atlas/googleAdmin/adminApi/fill.js";
import { syncGoogleAdminAtlas } from "../../../../atlas/googleAdmin/sync.js";
import { logger } from "../../../../lib/logger.js";
import { resolveGoogleAdminClient } from "../../../../live/googleAdmin/client.js";
import { defineCommand } from "../../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../exitCodes.js";
import { parseFlagTail, resolveHome, verbTail } from "../../../optionParsers.js";

/** Where a verb sits: past the runtime, the script, the `atlas` noun and the `google-admin` platform. */
const GOOGLE_ADMIN_VERB_INDEX = 4;

/**
 * Exported so a test can assert this equals the manifest's own copy.
 * @internal
 */
export const GOOGLE_ADMIN_FILL_USAGE = "usage: slopweaver atlas google-admin fill [--json] [--home <dir>]";

/**
 * Run the `atlas google-admin fill` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 * @internal
 */
export async function runGoogleAdminFillVerb(argv: readonly string[]): Promise<number> {
  const rest = verbTail({ argv, at: GOOGLE_ADMIN_VERB_INDEX, verbs: ["fill"] });
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json"], value: ["home"] } });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      logger.error({ msg: problem });
    });
    logger.error({ msg: GOOGLE_ADMIN_FILL_USAGE });
    return EXIT_USAGE;
  }
  const home = resolveHome({ named: parsed.value.values["home"] });
  const bound = resolveGoogleAdminClient({ capabilities: [], home });
  if (bound.isErr()) {
    logger.error({ msg: bound.error.message });
    return EXIT_ERROR;
  }
  const at = new Date().toISOString();
  const report = await runGoogleAdminFill({
    account: bound.value.account,
    at,
    client: bound.value.client,
    granted: bound.value.scopes,
  });
  const published = syncGoogleAdminAtlas({ at, fill: report.observation, home });
  if (published.isErr()) {
    logger.error({ msg: published.error.message });
    return EXIT_ERROR;
  }
  if (parsed.value.flags.has("json")) {
    logger.out({
      line: JSON.stringify(
        {
          answered: report.answered,
          excluded: report.observation.excluded.length,
          failed: report.observation.failed,
          filledAtIso: at,
          records: report.records,
          refused: report.refused,
        },
        undefined,
        2,
      ),
    });
    return EXIT_OK;
  }
  logger.out({
    line: `google-admin atlas fill — ${String(report.answered)} operation(s) answered and stored ${String(report.records)} record(s); ${String(report.refused)} refused, ${String(report.observation.excluded.length)} never attempted`,
  });
  for (const failure of report.observation.failed) {
    logger.warn({ msg: `${failure.id} answered ${String(failure.status)} — ${failure.message}` });
  }
  logger.out({
    line: "records carry their key and their field NAMES, never a value — run `slopweaver atlas google-admin coverage` for what each kind's admin-api cell now says",
  });
  return EXIT_OK;
}

export const googleAdminFillCommand = defineCommand({ run: runGoogleAdminFillVerb });
