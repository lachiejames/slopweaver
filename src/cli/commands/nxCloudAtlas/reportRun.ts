/**
 * `slopweaver atlas nx-cloud report [--json] [--home <dir>]` — where the two surfaces disagree.
 *
 * No network call, and it resolves nothing. `docs/atlas-intent/04-corroboration.md`: corroboration between the surfaces is
 * an OUTPUT the atlas shows, and what a disagreement MEANS is the owner's call. So this prints instances.
 */
import {
  type NxCloudDisagreement,
  nxCloudCorroboration,
  nxCloudDisagreements,
} from "../../../atlas/nxCloud/disagreement.js";
import type { NxCloudAtlasEntity, NxCloudAtlasKindFile } from "../../../atlas/nxCloud/model.js";
import { nxCloudAtlasPaths, readNxCloudAtlas } from "../../../atlas/nxCloud/store.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlagTail, resolveHome, verbTail } from "../../optionParsers.js";

/** Where an Nx Cloud atlas verb sits: past the runtime, the script, the `atlas` noun and the platform. */
const NX_CLOUD_VERB_INDEX = 4;

/**
 * Exported so a test can assert this equals the manifest's own copy.
 *
 * @internal
 */
export const NX_CLOUD_REPORT_USAGE = "usage: slopweaver atlas nx-cloud report [--json] [--home <dir>]";

/**
 * Parse the flag tail this verb accepts.
 *
 * @param rest the argv tail past the verb
 * @returns the options, or why the invocation is unusable
 */
function parseReportOptions({ rest }: { rest: readonly string[] }): Result<{ home: string; json: boolean }> {
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json"], value: ["home"] } });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  return ok({ home: resolveHome({ named: parsed.value.values["home"] }), json: parsed.value.flags.has("json") });
}

/**
 * One disagreement's line.
 *
 * @param row the disagreement
 * @returns the line, naming what each surface has that the other does not
 *
 * @internal
 */
export function disagreementLine({ row }: { row: NxCloudDisagreement }): string {
  if (row.heldBy.length === 1) {
    return `  ${row.providerId.padEnd(58)} ${String(row.heldBy[0])} only`;
  }
  const parts: string[] = [];
  if (row.browserOnlyFields.length > 0) {
    parts.push(`${String(row.browserOnlyFields.length)} field(s) only the rendered client saw`);
  }
  if (row.webDataOnlyFields.length > 0) {
    parts.push(`${String(row.webDataOnlyFields.length)} field(s) only the direct read saw`);
  }
  if (row.browserOnlyParams.length > 0) {
    parts.push(`${String(row.browserOnlyParams.length)} param(s) only the rendered client sent`);
  }
  return `  ${row.providerId.padEnd(58)} ${parts.join(", ")}`;
}

/** The published endpoints — none when the endpoint kind was never published. */
function publishedEndpoints({ file }: { file: NxCloudAtlasKindFile | null }): readonly NxCloudAtlasEntity[] {
  if (file === null) {
    return [];
  }
  return file.entities;
}

/**
 * Print where the two surfaces disagree.
 *
 * @param argv the whole process argv
 * @returns the process exit code
 */
export function nxCloudAtlasReportCommand(argv: readonly string[]): number {
  const rest = verbTail({ argv, at: NX_CLOUD_VERB_INDEX, verbs: ["report"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: NX_CLOUD_REPORT_USAGE });
    return EXIT_OK;
  }
  const options = parseReportOptions({ rest });
  if (options.isErr()) {
    options.error.forEach((line) => {
      logger.error({ msg: line });
    });
    logger.error({ msg: NX_CLOUD_REPORT_USAGE });
    return EXIT_USAGE;
  }
  const { home, json: asJson } = options.value;
  const snapshot = readNxCloudAtlas({ paths: nxCloudAtlasPaths({ home }) });
  if (snapshot.isErr()) {
    snapshot.error.forEach((line) => {
      logger.error({ msg: line });
    });
    return EXIT_ERROR;
  }
  const entities = publishedEndpoints({ file: snapshot.value.files.endpoint });
  const rows = nxCloudDisagreements({ entities });
  const counts = nxCloudCorroboration({ entities });
  if (asJson) {
    logger.out({ line: JSON.stringify({ corroboration: counts, disagreements: rows }, null, 1) });
    return EXIT_OK;
  }
  logger.out({
    line:
      `nx-cloud surfaces — ${String(counts.operationCount)} operation(s): ${String(counts.bothChannels)} held by ` +
      `both, ${String(counts.webDataOnly)} only by the direct read, ${String(counts.browserOnly)} only by the ` +
      `rendered client, ${String(counts.differingDetail)} held by both but differing in detail`,
  });
  for (const row of rows) {
    logger.out({ line: disagreementLine({ row }) });
  }
  logger.out({
    line: "  (this resolves nothing — which surface wins is the owner's call, docs/atlas-intent/04-corroboration.md)",
  });
  return EXIT_OK;
}
