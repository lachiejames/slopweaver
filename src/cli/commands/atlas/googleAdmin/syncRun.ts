/**
 * `slopweaver atlas google-admin sync [--json] [--home <dir>]` — publish the compiled generation.
 *
 * The verb is deliberately thin. Every decision worth reviewing — which methods exist, what disposition
 * each takes, which coverage cell each channel earns, which gaps the generation carries — lives under
 * `src/atlas/googleAdmin` where it is pure and testable. What is here is argument parsing and turning a
 * report into lines.
 *
 * It reaches no network and needs no credential, which is not an accident of this build: the compiled
 * channel is the one surface of this platform that can be current on an installation whose Google grant
 * holds no administrator scope. The two live channels report `not-configured` with their own remedies,
 * which is what the summary line prints — a sync that said only "published 83 kinds" would hide the whole
 * point.
 */
import { type GoogleAdminSyncReport, syncGoogleAdminAtlas } from "../../../../atlas/googleAdmin/sync.js";
import { logger } from "../../../../lib/logger.js";
import { defineCommand } from "../../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../exitCodes.js";
import { parseFlagTail, resolveHome, verbTail } from "../../../optionParsers.js";

/** Where a verb sits: past the runtime, the script, the `atlas` noun and the `google-admin` platform. */
const GOOGLE_ADMIN_VERB_INDEX = 4;

/**
 * Exported so a test can assert this equals the manifest's own copy.
 * @internal
 */
export const GOOGLE_ADMIN_SYNC_USAGE = "usage: slopweaver atlas google-admin sync [--json] [--home <dir>]";

/**
 * Turn a report into the lines a human reads, or one JSON document.
 *
 * Only the kinds that actually hold something are listed. Eighty-three lines of which four are zero is a
 * wall a reader skips, and the per-kind detail is one `--json` away.
 *
 * @param json whether the caller asked for JSON
 * @param report what the publish produced
 * @returns the process exit code
 */
function reportGoogleAdminSync({ json, report }: { json: boolean; report: GoogleAdminSyncReport }): number {
  if (json) {
    logger.out({ line: JSON.stringify(report, null, 2) });
    return EXIT_OK;
  }
  const entities = report.entitiesByKind.reduce((total, row) => total + row.entities, 0);
  logger.out({
    line: `google-admin atlas sync — published ${entities} compiled entities across ${report.entitiesByKind.length} kinds, with ${report.gaps} open gaps`,
  });
  for (const row of report.entitiesByKind.filter((candidate) => candidate.entities > 0)) {
    logger.out({ line: `  ${row.kind}: ${row.entities}` });
  }
  logger.out({
    line: "the discovery surface is filled and needs no credential; admin-api and admin-console report not-configured — run `slopweaver atlas google-admin coverage` for what would fill each",
  });
  return EXIT_OK;
}

/**
 * Run the `atlas google-admin sync` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 * @internal
 */
export function runGoogleAdminSync(argv: readonly string[]): number {
  const rest = verbTail({ argv, at: GOOGLE_ADMIN_VERB_INDEX, verbs: ["sync"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: GOOGLE_ADMIN_SYNC_USAGE });
    return EXIT_OK;
  }
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json"], value: ["home"] } });
  if (parsed.isErr()) {
    parsed.error.forEach((error) => {
      logger.error({ msg: error });
    });
    logger.error({ msg: GOOGLE_ADMIN_SYNC_USAGE });
    return EXIT_USAGE;
  }
  const { values, flags } = parsed.value;
  const report = syncGoogleAdminAtlas({
    at: new Date().toISOString(),
    home: resolveHome({ named: values["home"] }),
  });
  if (report.isErr()) {
    logger.error({ msg: report.error.message });
    return EXIT_ERROR;
  }
  return reportGoogleAdminSync({ json: flags.has("json"), report: report.value });
}

export const googleAdminSyncCommand = defineCommand({ run: runGoogleAdminSync });
