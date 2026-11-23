/**
 * `slopweaver atlas vanta vulnerabilities [...]` — the live read leg. Walks Vanta's vulnerability surface with
 * the caller's filters, renders the lay of the land, and optionally writes a self-contained HTML page the
 * session can screenshot.
 *
 * ## The exit-code contract
 *
 * | situation                            | code |
 * | ------------------------------------ | ---- |
 * | a bad flag                           | `2`  |
 * | credentials genuinely not configured | `3`  |
 * | the walk or the HTML write failed    | `1`  |
 * | the read succeeded, findings or not  | `0`  |
 *
 * An empty result is `0`, not `3`: "no critical vulnerabilities" is an ANSWER, and the day the posture is
 * actually clean is the worst possible day for the verb to look broken.
 *
 * ## Why this verb writes a file at all
 *
 * `--html` is the screenshot-able surface. Giving Vanta a door makes app.vanta.com off-limits to a
 * hand-driven browser (doctrine rule 3, `admit/browserSurface.ts`), so the shot the owner asked for has to
 * come from a doorless page carrying what the door read. `atlas/vanta/vulnerabilityReport.ts`'s header
 * carries the full reasoning — including the measured fact that this device's capture extension refuses a
 * `file://` URL, so the page is served over `127.0.0.1` for the shot. This shell only decides where the
 * bytes land.
 */
import { writeFileSync } from "node:fs";

import { createVantaManageClient } from "../../../atlas/vanta/client.js";
import {
  buildVantaVulnerabilityReport,
  renderVantaVulnerabilityHtml,
  renderVantaVulnerabilityLines,
  type VantaVulnerabilityReport,
} from "../../../atlas/vanta/vulnerabilityReport.js";
import { slopweaverHome } from "../../../homeDir.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { isVantaVerbUnconfigured, type VantaVerbError, VantaVerbErrors, vantaVerbErrorLines } from "./errors.js";

/** Where a Vanta verb sits: past the runtime, the script, the `atlas` noun and the `vanta` platform. */
const VANTA_VERB_INDEX = 4;

import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { verbTail } from "../../optionParsers.js";
import { bindVanta } from "./binding.js";
import { parseVantaVulnerabilitiesOptions, type VantaVulnerabilitiesOptions } from "./vulnerabilityCore.js";

/** The one copy. The manifest row names the platform's verbs; each verb's own usage lives with the verb. */
export const VANTA_VULNERABILITIES_USAGE =
  "usage: slopweaver atlas vanta vulnerabilities [--severity CRITICAL|HIGH|MEDIUM|LOW] [--active|--deactivated]\n" +
  "       [--fixable] [--html <path>] [--json] [--home <dir>]\n" +
  "       [--client-id-file <path> --client-secret-file <path>]\n" +
  "  Reads Vanta's vulnerability surface LIVE — nothing is published into the stored atlas, because a\n" +
  "  finding's whole value is that it is current\n" +
  "  --severity   only findings Vanta grades at this level\n" +
  "  --active     only findings still monitored · --deactivated  only ones already ignored\n" +
  "  --fixable    only findings with a fix available\n" +
  "  --html       also write a self-contained page to this path — the doorless surface to screenshot,\n" +
  "               since giving Vanta a door puts app.vanta.com off-limits to a hand-driven browser\n" +
  "  --json       emit the whole report as one machine-readable document\n" +
  "  Credentials come from --client-id-file/--client-secret-file (two owner-only 0600 files), else\n" +
  "  VANTA_CLIENT_ID/VANTA_CLIENT_SECRET, else the secrets store (slopweaver secrets set vanta-client-id)";

/** Walk the live surface with the caller's filters and reduce it to the report. */
async function readReport({
  options,
  observedAt,
}: {
  options: VantaVulnerabilitiesOptions;
  observedAt: string;
}): Promise<Result<VantaVulnerabilityReport, VantaVerbError>> {
  const bound = bindVanta({
    clientIdFile: options.clientIdFile,
    clientSecretFile: options.clientSecretFile,
    env: process.env,
    home: options.home,
  });
  if (bound.isErr()) {
    return err(VantaVerbErrors.credentialsUnresolved({ errors: bound.error }));
  }
  const client = createVantaManageClient(bound.value);
  const findings = await client.listVulnerabilities({
    filters: {
      isDeactivated: options.isDeactivated,
      isFixAvailable: options.isFixAvailable,
      severity: options.severity,
    },
  });
  if (findings.isErr()) {
    return err(VantaVerbErrors.readFailed({ reasons: findings.error }));
  }
  return ok(buildVantaVulnerabilityReport({ findings: findings.value, observedAt, severityFilter: options.severity }));
}

/** Write the screenshot-able page, when one was asked for. */
function writeHtml({ path, report }: { path: string; report: VantaVulnerabilityReport }): Result<null, VantaVerbError> {
  try {
    writeFileSync(path, renderVantaVulnerabilityHtml({ report }), "utf8");
    return ok(null);
  } catch (error: unknown) {
    return err(VantaVerbErrors.htmlUnwritable({ cause: error, path }));
  }
}

/** Print the report in whichever form the caller asked for. */
function printReport({
  options,
  value,
}: {
  options: VantaVulnerabilitiesOptions;
  value: VantaVulnerabilityReport;
}): void {
  if (options.json) {
    logger.out({ line: JSON.stringify(value, null, 2) });
    return;
  }
  for (const line of renderVantaVulnerabilityLines({ report: value })) {
    logger.out({ line });
  }
  if (options.htmlPath !== null) {
    logger.out({ line: "" });
    logger.out({ line: `wrote the screenshot-able page to ${options.htmlPath}` });
  }
}

/**
 * Run the `vanta vulnerabilities` verb.
 *
 * @param argv the full process argv (verb tail starts at index 3)
 * @returns the process exit code
 * @internal
 */
export async function runVantaVulnerabilities(argv: readonly string[]): Promise<number> {
  const rest = verbTail({ argv, at: VANTA_VERB_INDEX, verbs: ["vulnerabilities"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: VANTA_VULNERABILITIES_USAGE });
    return EXIT_OK;
  }
  const parsed = parseVantaVulnerabilitiesOptions({ defaultHome: slopweaverHome(), rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      logger.error({ msg: problem });
    });
    logger.error({ msg: VANTA_VULNERABILITIES_USAGE });
    return EXIT_USAGE;
  }
  const options = parsed.value;

  const read = await readReport({ observedAt: new Date().toISOString(), options });
  if (read.isErr()) {
    vantaVerbErrorLines({ error: read.error }).forEach((problem) => {
      logger.error({ msg: problem });
    });
    // A credential that is simply absent is an expected empty, not a broken run — `vanta sync` grades it
    // the same way, and a demo host with no Vanta app configured should not read as a crash.
    return isVantaVerbUnconfigured({ error: read.error }) ? EXIT_EXPECTED_EMPTY : EXIT_ERROR;
  }

  if (options.htmlPath !== null) {
    const written = writeHtml({ path: options.htmlPath, report: read.value });
    if (written.isErr()) {
      vantaVerbErrorLines({ error: written.error }).forEach((problem) => {
        logger.error({ msg: problem });
      });
      return EXIT_ERROR;
    }
  }
  printReport({ options, value: read.value });
  return EXIT_OK;
}

export const vantaVulnerabilitiesCommand = defineCommand({ run: runVantaVulnerabilities });
