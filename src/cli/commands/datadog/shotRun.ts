/**
 * `slopweaver datadog shot <monitor|explorer|file>` — the one door for Datadog IMAGES.
 *
 * The sibling of `datadog probe|metrics|raw`, which emit numbers. This verb ends in a PNG plus the evidence
 * it was taken over the right window, because the proof a monitor pull request is asked for is a picture of
 * the console's own backtest panel and no API returns one.
 *
 * ## It launches nothing; `monitor` captures through the relay into their real Chrome
 *
 * Per `docs/browser-route.md`, their real work Chrome is the only browser anything here
 * uses, and no verb launches one. Datadog is not a doored provider, so nothing in
 * `src/admit/browserSurface.ts` stands between a session and that console.
 *
 * - **`monitor` takes the capture itself.** It runs the `datadog-monitor-backtest` relay arm
 *   (`browser/datadogMonitorBacktestSnippet.ts`) in their already signed-in Chrome — set the backtest to Past 1
 *   Week, wait for the panel to settle, box the Alert count, photograph the panel column — then judges it
 *   (`datadog/shot/monitorShot.ts`) and grades and files the PNG exactly as `file` would. It clicks the
 *   time picker and its preset and nothing else; it never saves, types or changes the monitor.
 * - **An `explorer --url` prints one `slopweaver browser shot` command**,
 *   and a SEEDED `explorer` prints a brief whose read-back step rides `browser/brief.ts`'s `no-verb-yet` arm.
 *   `datadog/shot/plan.ts` carries the reasoning and the boundary.
 * - **`file` grades** an image captured elsewhere.
 *
 * ## The exit-code contract
 *
 * | situation                                                                   | code |
 * | --------------------------------------------------------------------------- | ---- |
 * | a bad flag, an unknown sub-verb, or a refused address                       | `2`  |
 * | `DD_SITE` unset or unknown                                                  | `3`  |
 * | no capture, a panel that never settled, an unusable image, a wrong window   | `1`  |
 * | a brief was printed, or an image was graded and filed                       | `0`  |
 *
 * ## This verb needs `DD_SITE` and NEITHER key
 *
 * The console is reached with the reader's own browser session, not a bearer token, so
 * `resolveDatadogConfig`'s full credential check would refuse a machine that can capture perfectly well.
 * `resolveSite` is exported from `datadog/config.ts` for exactly this caller.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { relayDepsFor } from "../../../atlas/kit/walkTransport.js";
import { renderBrief } from "../../../browser/brief.js";
import { captureMonitorBacktest } from "../../../browser/datadogMonitorBacktest.js";
import { BACKTEST_READINESS_MS } from "../../../browser/datadogMonitorBacktestSnippet.js";
import { type RecordedProfilePort, recordedProfilePort } from "../../../browser/recordedProfile.js";
import { consoleHostFor, resolveSite } from "../../../datadog/config.js";
import { datadogConfigErrorLines } from "../../../datadog/configErrors.js";
import { datadogDomainErrorLines } from "../../../datadog/domainErrors.js";
import type { DatadogShotError } from "../../../datadog/shot/errors.js";
import { DatadogShotErrors } from "../../../datadog/shot/errors.js";
import type { PngDimensions } from "../../../datadog/shot/imageCheck.js";
import { cropMonitorPanel, judgeMonitorCapture } from "../../../datadog/shot/monitorShot.js";
import { PAST_ONE_WEEK } from "../../../datadog/shot/panelScript.js";
import { explorerBrief, relayExplorerPlan } from "../../../datadog/shot/plan.js";
import { judgeWindowProof, previewSpanSeconds, type WindowProof } from "../../../datadog/shot/proof.js";
import {
  type BacktestReading,
  explorerShotFilename,
  formatReadingLine,
  monitorShotFilename,
} from "../../../datadog/shot/reading.js";
import { metricExplorerSeedUrl, monitorEditUrl, validateExplorerUrl } from "../../../datadog/shot/targetUrl.js";
import { gradeAndCommit, gradeAndCommitBytes } from "../../../datadog/shot/write.js";
import { datadogSite } from "../../../datadog/source.js";
import { resolveWindow } from "../../../datadog/window.js";
import { slopweaverHome } from "../../../homeDir.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { refuseProofOutputInTree } from "../../../proofPath/outputGuardEffects.js";
import { stateHomePaths } from "../../../stateHome.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { verbTail } from "../../optionParsers.js";
import { datadogArgsErrorLines } from "./errors.js";
import { type DatadogShotOptions, parseDatadogShotOptions, requiredViewFragments } from "./shotCore.js";
import { DATADOG_SHOT_USAGE } from "./usage.js";

/**
 * The exit code one typed capture failure earns.
 *
 * A total switch with a `never` default, so a new error variant fails to COMPILE here rather than silently
 * falling through to a wrong code at runtime.
 *
 * @param error the typed failure
 * @returns the process exit code
 */
export function exitCodeForShotError({ error }: { error: DatadogShotError }): number {
  switch (error.code) {
    case "URL_REFUSED":
      return EXIT_USAGE;
    case "BACKTEST_UNSUPPORTED":
    case "CAPTURE_FAILED":
    case "IMAGE_UNUSABLE":
    case "OUTPUT_UNWRITABLE":
    case "PANEL_CROP_REFUSED":
    case "PANEL_NEVER_SETTLED":
    case "PANEL_UNREADABLE":
    case "PREVIEW_WINDOW_WRONG":
    case "VIEW_STATE_UNCONFIRMED":
      return EXIT_ERROR;
    default: {
      const unreachable: never = error;
      return unreachable;
    }
  }
}

/** Report every reason a run refused, then the usage line when the reasons are caller-args ones. */
function reportErrors({ errors, withUsage }: { errors: readonly string[]; withUsage: boolean }): void {
  errors.forEach((error) => {
    logger.error({ msg: error });
  });
  if (withUsage) {
    logger.error({ msg: DATADOG_SHOT_USAGE });
  }
}

/** Where this run's graded images go: the `--out` the caller named, else this install's own shots directory. */
function outDirFor({ outDir }: { outDir: string | null }): string {
  if (outDir === null) {
    return stateHomePaths().datadogShotsDir;
  }
  return outDir;
}

/** Print a brief and succeed: saying what to capture IS this sub-verb's whole job. */
function printBrief({ lines }: { lines: readonly string[] }): number {
  for (const line of lines) {
    logger.out({ line });
  }
  return EXIT_OK;
}

/**
 * Run the `monitor` sub-verb: capture one monitor's seven-day backtest panel in their Chrome, judge it, file it.
 *
 * @param flags the validated invocation
 * @param consoleHost the console host this install is configured for
 * @returns the process exit code
 */
async function runMonitorShot({
  flags,
  consoleHost,
}: {
  flags: DatadogShotOptions;
  consoleHost: string;
}): Promise<number> {
  const { monitorId } = flags;
  if (monitorId === null) {
    reportErrors({ errors: ["--id is required for `shot monitor`"], withUsage: true });
    return EXIT_USAGE;
  }
  const prepared = prepareOutDir({ outDir: outDirFor({ outDir: flags.outDir }) });
  if (prepared.isErr()) {
    reportErrors({ errors: [prepared.error.message], withUsage: false });
    return exitCodeForShotError({ error: prepared.error });
  }
  const url = monitorEditUrl({ consoleHost, monitorId });
  const filed = await captureAndFile({
    consoleHost,
    imagePath: join(prepared.value, monitorShotFilename({ monitorId })),
    monitorId,
    profiles: recordedProfilePort(),
    url,
  });
  if (filed.isErr()) {
    reportErrors({ errors: [filed.error.message], withUsage: false });
    return exitCodeForShotError({ error: filed.error });
  }
  const { imagePath, dimensions, proof, reading } = filed.value;
  const readingLine = formatReadingLine({ reading, windowLabel: PAST_ONE_WEEK });
  logger.out({
    line: flags.json
      ? JSON.stringify({ dimensions, imagePath, reading, url, windowProof: proof }, null, 2)
      : `filed ${imagePath} — ${String(dimensions.widthPx)}x${String(dimensions.heightPx)}, window proved by ${proof} — ${readingLine}`,
  });
  return EXIT_OK;
}

/**
 * The effectful half of `shot monitor`: relay capture, the pure judgement, the crop, the grade and the write.
 *
 * @param url the monitor's edit page
 * @param consoleHost the console host, which is also the one origin the relay lease is bound to
 * @param monitorId the monitor, for the refusal that names it
 * @param imagePath where the graded PNG belongs
 * @param profiles the door the recorded work profile is read through
 * @returns what was filed, or the one typed refusal
 */
async function captureAndFile({
  url,
  consoleHost,
  monitorId,
  imagePath,
  profiles,
}: {
  url: string;
  consoleHost: string;
  monitorId: string;
  imagePath: string;
  profiles: RecordedProfilePort;
}): Promise<Result<FiledMonitorShot, DatadogShotError>> {
  const directory = mkdtempSync(join(tmpdir(), "slopweaver-dd-monitor-shot-"));
  try {
    const origins = [`https://${consoleHost}`];
    const deps = await relayDepsFor({ directory, home: slopweaverHome(), origins, platform: "datadog", profiles });
    if (deps.isErr()) {
      return err(DatadogShotErrors.captureFailed({ detail: deps.error.join("; "), url }));
    }
    const captured = await captureMonitorBacktest({ deps: deps.value, readinessTimeoutMs: BACKTEST_READINESS_MS, url });
    if (captured.isErr()) {
      return err(DatadogShotErrors.captureFailed({ detail: captured.error.message, url }));
    }
    const judged = judgeMonitorCapture({ consoleHost, monitorId, observation: captured.value });
    if (judged.isErr()) {
      return err(judged.error);
    }
    const cropped = await cropMonitorPanel({ frame: judged.value.frame, png: judged.value.png });
    if (cropped.isErr()) {
      return err(cropped.error);
    }
    const committed = gradeAndCommitBytes({ bytes: cropped.value, imagePath });
    if (committed.isErr()) {
      return err(committed.error);
    }
    return ok({ dimensions: committed.value, imagePath, proof: judged.value.proof, reading: judged.value.reading });
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

/** What `shot monitor` filed, for the line it prints. */
interface FiledMonitorShot {
  readonly imagePath: string;
  readonly dimensions: PngDimensions;
  readonly proof: WindowProof;
  readonly reading: BacktestReading;
}

/** Run the `explorer` sub-verb: the brief for an address you have, or one seeded and then read back. */
function runExplorerShot({ flags, consoleHost }: { flags: DatadogShotOptions; consoleHost: string }): number {
  const nowIso = new Date().toISOString();
  const resolved = resolveExplorerTarget({ consoleHost, flags });
  if (resolved.isErr()) {
    reportErrors({ errors: resolved.error.errors, withUsage: resolved.error.withUsage });
    return resolved.error.code;
  }
  const { target, required, label } = resolved.value;
  const imagePath = join(outDirFor({ outDir: flags.outDir }), explorerShotFilename({ label, nowIso }));
  if (required.length === 0) {
    // A supplied address needs nothing done to it before the shutter, so the whole capture is one relay
    // command and there is no session leg at all — `datadog/shot/plan.ts` carries why.
    const plan = relayExplorerPlan({ imagePath, url: target });
    return printBrief({
      lines: flags.json ? [JSON.stringify({ command: plan[2]?.trim(), imagePath, url: target }, null, 2)] : plan,
    });
  }
  const brief = explorerBrief({ imagePath, requiredFragments: required, url: target });
  return printBrief({ lines: flags.json ? [JSON.stringify(brief, null, 2)] : renderBrief({ brief }) });
}

/**
 * Run the `file` sub-verb: prove the window, then grade the image and commit it.
 *
 * The window is proved BEFORE the image is graded, deliberately. A picture of a panel computed over the
 * wrong span is a perfectly valid PNG, so grading it first would report a good capture and then refuse it —
 * and the order a reader sees a refusal in is the order they believe the cause.
 *
 * @returns the process exit code
 */
function runFileShot({ flags }: { flags: DatadogShotOptions }): number {
  if (flags.image === null) {
    reportErrors({ errors: ["--image <png> is required for `shot file`"], withUsage: true });
    return EXIT_USAGE;
  }
  const spans = flags.previewUrls
    .map((url) => previewSpanSeconds({ url }))
    .filter((span: number | null) => span !== null);
  const proof = judgeWindowProof({ spans });
  if (proof.isErr()) {
    reportErrors({ errors: [proof.error.message], withUsage: false });
    return exitCodeForShotError({ error: proof.error });
  }
  const prepared = prepareOutDir({ outDir: outDirFor({ outDir: flags.outDir }) });
  if (prepared.isErr()) {
    reportErrors({ errors: [prepared.error.message], withUsage: false });
    return exitCodeForShotError({ error: prepared.error });
  }
  const imagePath = join(prepared.value, basenameOf({ path: flags.image }));
  const committed = gradeAndCommit({ imagePath, sourcePath: flags.image });
  if (committed.isErr()) {
    reportErrors({ errors: [committed.error.message], withUsage: false });
    return exitCodeForShotError({ error: committed.error });
  }
  logger.out({
    line: flags.json
      ? JSON.stringify({ dimensions: committed.value, imagePath, windowProof: proof.value }, null, 2)
      : `filed ${imagePath} — ${String(committed.value.widthPx)}x${String(committed.value.heightPx)}, window proved by ${proof.value}`,
  });
  return EXIT_OK;
}

/**
 * The file's own name, without depending on the caller's directory layout.
 *
 * @param path the source path
 * @returns its last segment
 */
function basenameOf({ path }: { path: string }): string {
  // Invariant: splitting a string on a string separator always yields at least one element, so a last one exists.
  return path.split("/").at(-1)!;
}

/**
 * Make the output directory, turning a filesystem refusal into the typed one.
 *
 * @param outDir where graded images belong
 * @returns the directory, or why it could not be made
 */
function prepareOutDir({ outDir }: { outDir: string }): Result<string, DatadogShotError> {
  try {
    mkdirSync(outDir, { recursive: true });
    return ok(outDir);
  } catch (cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return err(DatadogShotErrors.outputUnwritable({ detail, path: outDir }));
  }
}

/**
 * Work out which address an Explorer brief opens, and what the rendered view must then carry.
 *
 * The two modes differ in exactly one way that matters: `--url` opens a state this verb did not construct,
 * so there is nothing to check it against and `required` is empty; `--metric` SEEDS a state, so the view
 * has to be read back before it is photographed.
 *
 * @param flags the validated invocation
 * @param consoleHost the console host this install is configured for
 * @returns the address, the fragments to confirm and the shot's file label, or the refusal to report
 */
function resolveExplorerTarget({
  flags,
  consoleHost,
}: {
  flags: DatadogShotOptions;
  consoleHost: string;
}): Result<
  { readonly target: string; readonly required: readonly string[]; readonly label: string },
  { readonly errors: readonly string[]; readonly withUsage: boolean; readonly code: number }
> {
  if (flags.url !== null) {
    const validated = validateExplorerUrl({ consoleHost, url: flags.url });
    if (validated.isErr()) {
      return err({
        code: exitCodeForShotError({ error: validated.error }),
        errors: [validated.error.message],
        withUsage: false,
      });
    }
    return ok({ label: new URL(validated.value).pathname, required: [], target: validated.value });
  }
  if (flags.metric === null) {
    return err({
      code: EXIT_USAGE,
      errors: ["`shot explorer` needs either --url or --metric"],
      withUsage: true,
    });
  }
  const window = resolveWindow({ from: flags.from, nowMs: Date.now(), to: flags.to });
  if (window.isErr()) {
    return err({ code: EXIT_USAGE, errors: datadogDomainErrorLines({ error: window.error }), withUsage: true });
  }
  return ok({
    label: [flags.metric, flags.group].filter((part) => part !== null && part !== "").join("-by-"),
    required: requiredViewFragments({ group: flags.group, metric: flags.metric, scope: flags.scope }),
    target: metricExplorerSeedUrl({ agg: flags.agg, consoleHost, metric: flags.metric, window: window.value }),
  });
}

/**
 * Run the `datadog shot` verb.
 *
 * @param argv the full process argv (verb tail starts at index 3)
 * @returns the process exit code
 */
export async function runDatadogShot(argv: readonly string[]): Promise<number> {
  const rest = verbTail({ argv, verbs: ["shot"] });
  if (rest.length === 0 || rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: DATADOG_SHOT_USAGE });
    return EXIT_OK;
  }
  const parsed = parseDatadogShotOptions({ rest });
  if (parsed.isErr()) {
    reportErrors({ errors: datadogArgsErrorLines({ error: parsed.error }), withUsage: true });
    return EXIT_USAGE;
  }
  const flags = parsed.value;
  if (flags.outDir !== null) {
    // Every sub-verb names where its image lands, the briefs included, so every one is asked.
    const placement = refuseProofOutputInTree({
      cwd: process.cwd(),
      env: process.env,
      home: slopweaverHome(),
      output: flags.outDir,
    });
    if (placement.isErr()) {
      reportErrors({ errors: placement.error, withUsage: false });
      return EXIT_ERROR;
    }
  }
  if (flags.subverb === "file") {
    return runFileShot({ flags });
  }
  const site = resolveSite({ raw: datadogSite({}) });
  if (site.isErr()) {
    reportErrors({ errors: datadogConfigErrorLines({ error: site.error }), withUsage: false });
    return EXIT_EXPECTED_EMPTY;
  }
  const consoleHost = consoleHostFor({ site: site.value });
  return flags.subverb === "monitor" ? runMonitorShot({ consoleHost, flags }) : runExplorerShot({ consoleHost, flags });
}

export const datadogShotCommand = defineCommand({ run: runDatadogShot });
