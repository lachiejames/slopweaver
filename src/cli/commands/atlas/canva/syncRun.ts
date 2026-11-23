/**
 * `slopweaver atlas canva sync [--json] [--home <dir>]` — publish the compiled generation.
 *
 * The verb is deliberately thin. Every decision worth reviewing — which operations exist, what disposition
 * each takes, which coverage cell each channel earns, which gaps the generation carries — lives under
 * `src/atlas/canva` where it is pure and testable. What is here is argument parsing and turning a
 * report into lines.
 *
 * It reaches no network and needs no credential, which is not an accident of this build: the compiled
 * channel is the one surface of this platform that can be current on an installation holding no Canva
 * integration. The two live channels report `not-configured` with their own remedies, which is what the
 * summary lines print — a sync that said only "published 17 kinds" would hide the whole point, and the two
 * remedies are not the same shape: one needs an integration nobody has registered, the other needs only the
 * walk itself.
 */
import { type CanvaSyncReport, syncCanvaAtlas } from "../../../../atlas/canva/sync.js";
import { logger } from "../../../../lib/logger.js";
import { defineCommand } from "../../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../exitCodes.js";
import { parseFlagTail, resolveHome, verbTail } from "../../../optionParsers.js";

/** Where a Canva verb sits: past the runtime, the script, the `atlas` noun and the `canva` platform. */
const CANVA_VERB_INDEX = 4;

/**
 * Exported so a test can assert this equals the manifest's own copy.
 * @internal
 */
export const CANVA_SYNC_USAGE = "usage: slopweaver atlas canva sync [--json] [--home <dir>]";

/**
 * Turn a report into the lines a human reads, or one JSON document.
 *
 * @param json whether the caller asked for JSON
 * @param report what the publish produced
 * @returns the process exit code
 */
function reportCanvaSync({ json, report }: { json: boolean; report: CanvaSyncReport }): number {
  if (json) {
    logger.out({ line: JSON.stringify(report, null, 2) });
    return EXIT_OK;
  }
  const entities = report.entitiesByKind.reduce((total, row) => total + row.entities, 0);
  logger.out({
    line: `canva atlas sync — published ${entities} compiled entities across ${report.entitiesByKind.length} kinds, with ${report.gaps} open gaps`,
  });
  for (const row of report.entitiesByKind) {
    logger.out({ line: `  ${row.kind}: ${row.entities}` });
  }
  logger.out({
    line: "the published-api surface is filled and needs no credential; connect-api and web-app report not-configured — run `slopweaver atlas canva coverage` for what would fill each",
  });
  return EXIT_OK;
}

/**
 * Run the `atlas canva sync` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 * @internal
 */
export function runCanvaSync(argv: readonly string[]): number {
  const rest = verbTail({ argv, at: CANVA_VERB_INDEX, verbs: ["sync"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: CANVA_SYNC_USAGE });
    return EXIT_OK;
  }
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json"], value: ["home"] } });
  if (parsed.isErr()) {
    parsed.error.forEach((error) => {
      logger.error({ msg: error });
    });
    logger.error({ msg: CANVA_SYNC_USAGE });
    return EXIT_USAGE;
  }
  const { values, flags } = parsed.value;
  const report = syncCanvaAtlas({
    at: new Date().toISOString(),
    home: resolveHome({ named: values["home"] }),
  });
  if (report.isErr()) {
    logger.error({ msg: report.error.message });
    return EXIT_ERROR;
  }
  return reportCanvaSync({ json: flags.has("json"), report: report.value });
}

export const canvaSyncCommand = defineCommand({ run: runCanvaSync });
