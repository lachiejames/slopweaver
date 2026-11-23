/**
 * `slopweaver browser console-shot --walk <name> --out <file.png>` — photograph one registered click-through of THIS
 * checkout's console over a throwaway store and home holding the synthetic organisation, and file the capture receipt
 * `github attach` accepts.
 *
 * The browser is Playwright's own headless Chromium, launched by Playwright Test with no profile, no user data
 * directory and no debugging port, and the server is the console lane's `next start`, both behind
 * `config/playwright/capture.ts`: the same route `yarn test:e2e` takes, so this verb adds no browser door and no async
 * child process of its own. The steps and their environments are `./consoleShotCore.ts`; the observation and the
 * receipt are `../../../visualEvidence/consoleShot.ts`. This file reads, runs, writes and reports.
 *
 * The receipt is filed before the picture moves onto `--out`, and a failed move withdraws it (`./consoleShotPlace.ts`).
 * Nothing is recorded as VIEWED here: the session opens the PNG and records what it saw with `browser image-record`.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { logger } from "#lib/logger.js";
import { installedTreeRoot } from "#lib/pluginRoot.js";
import { err, ok, type Result } from "#lib/result.js";
import { safeJsonParse } from "#lib/safeJson.js";
import { refuseProofOutputInTree } from "../../../proofPath/outputGuardEffects.js";
import { storeUrl } from "../../../store/config.js";
import { captureIdFor } from "../../../visualEvidence/captureRecord.js";
import {
  CONSOLE_OBSERVATION_FILE,
  CONSOLE_RAW_SHOT_FILE,
  type ConsoleObservation,
  consoleMaintenanceUrl,
  consoleShotReceipt,
  parseConsoleObservation,
} from "../../../visualEvidence/consoleShot.js";
import { type ConsoleShotError, ConsoleShotErrors } from "../../../visualEvidence/consoleShotErrors.js";
import { CONSOLE_WALKS, type ConsoleWalk, consoleWalkNamed } from "../../../visualEvidence/consoleWalks.js";
import { identifyImageBytes } from "../../../visualEvidence/imageIo.js";
import { stripImageMetadata } from "../../../visualEvidence/pngMetadata.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { type ConsoleShotDirectories, type ConsoleShotStep, consoleShotSteps } from "./consoleShotCore.js";
import { placeConsoleShot, refuseNonFileOut } from "./consoleShotPlace.js";
import type { BrowserOptions } from "./profileCore.js";

/** How long one build or the walk may run before it is ended: a cold console build is the longest, in minutes. */
const STEP_TIMEOUT_MS = 20 * 60 * 1000;

/** What one finished shot reports. */
interface ShotResult {
  readonly receiptPath: string;
  readonly captureId: string;
  readonly words: number;
}

/**
 * Run one step to completion with inherited output, so the seat watches the build and the walk as they run.
 *
 * @param cwd the checkout
 * @param step the step
 * @returns nothing, or the step that failed
 */
function runStep({ cwd, step }: { cwd: string; step: ConsoleShotStep }): Result<null, ConsoleShotError> {
  logger.error({ msg: `console-shot: ${step.name}: ${step.command} ${step.args.join(" ")}` });
  const child = spawnSync(step.command, step.args, { cwd, env: step.env, stdio: "inherit", timeout: STEP_TIMEOUT_MS });
  if (child.status === 0) {
    return ok(null);
  }
  const status = child.status === null ? `ended by ${String(child.signal)}` : `exit ${String(child.status)}`;
  return err(ConsoleShotErrors.laneFailed({ status, step: step.name }));
}

/**
 * The maintenance connection for the throwaway database, from the store this installation selects.
 *
 * @param home the state home whose selection names the local server
 * @returns the maintenance connection, or why none is safe
 */
function maintenanceUrlFor({ home }: { home: string }): Result<string, ConsoleShotError> {
  const selected = storeUrl({ env: process.env, home });
  if (selected.isErr()) {
    return err(ConsoleShotErrors.storeUnavailable({ detail: selected.error.message }));
  }
  return consoleMaintenanceUrl({ storeUrl: selected.value });
}

/**
 * The observation and the raw picture the walk left.
 *
 * @param capture the capture directory
 * @param walk the walk asked for
 * @returns both, or why they cannot be used
 */
function readCapture({
  capture,
  walk,
}: {
  capture: string;
  walk: ConsoleWalk;
}): Result<{ readonly observation: ConsoleObservation; readonly raw: Uint8Array }, ConsoleShotError> {
  let decoded: unknown;
  let raw: Uint8Array;
  try {
    const path = join(capture, CONSOLE_OBSERVATION_FILE);
    decoded = safeJsonParse({ label: `console-shot observation at ${path}`, text: readFileSync(path, "utf8") });
    raw = new Uint8Array(readFileSync(join(capture, CONSOLE_RAW_SHOT_FILE)));
  } catch (error) {
    return err(
      ConsoleShotErrors.observationInvalid({ detail: error instanceof Error ? error.message : String(error) }),
    );
  }
  return parseConsoleObservation({ value: decoded, walk }).map((observation) => ({ observation, raw }));
}

/**
 * Build the CLI and the console, then run the one walk, each child under the shot's own throwaway environment.
 *
 * @param cwd the checkout
 * @param home the installation's state home, read ONLY for which local server to create the throwaway database on
 * @param walk the walk
 * @param directories the shot's throwaway directories
 * @returns nothing, or the first step that failed
 */
function buildAndWalk({
  cwd,
  home,
  walk,
  directories,
}: {
  cwd: string;
  home: string;
  walk: ConsoleWalk;
  directories: ConsoleShotDirectories;
}): Result<null, ConsoleShotError> {
  const adminUrl = maintenanceUrlFor({ home });
  if (adminUrl.isErr()) {
    return err(adminUrl.error);
  }
  const steps = consoleShotSteps({
    adminUrl: adminUrl.value,
    cwd,
    directories,
    nodeBinDir: dirname(process.execPath),
    os: process.platform,
    source: process.env,
    userHome: homedir(),
    walk: walk.name,
  });
  for (const step of steps) {
    const ran = runStep({ cwd, step });
    if (ran.isErr()) {
      return err(ran.error);
    }
  }
  return ok(null);
}

/**
 * Build, walk, and leave the stripped picture and its receipt.
 *
 * @param cwd the checkout
 * @param home the installation's state home: read ONLY for which local server to create the throwaway database on,
 *   and written only with the capture receipt
 * @param walk the walk
 * @param out where the final picture goes
 * @param capturedAtIso when the shot is taken
 * @param directories the shot's throwaway directories
 * @returns the receipt's path, the capture id and the frame text's word count, or the failure
 */
async function shoot({
  cwd,
  home,
  walk,
  out,
  capturedAtIso,
  directories,
}: {
  cwd: string;
  home: string;
  walk: ConsoleWalk;
  out: string;
  capturedAtIso: string;
  directories: ConsoleShotDirectories;
}): Promise<Result<ShotResult, ConsoleShotError>> {
  const walked = buildAndWalk({ cwd, directories, home, walk });
  if (walked.isErr()) {
    return err(walked.error);
  }
  const captured = readCapture({ capture: directories.capture, walk });
  if (captured.isErr()) {
    return err(captured.error);
  }
  const stripped = await stripImageMetadata({ bytes: captured.value.raw });
  if (stripped.isErr()) {
    return err(ConsoleShotErrors.imageFailed({ detail: stripped.error.message }));
  }
  const identity = await identifyImageBytes({ bytes: stripped.value });
  if (identity.isErr()) {
    return err(ConsoleShotErrors.imageFailed({ detail: identity.error.message }));
  }
  const captureId = captureIdFor({ digest: identity.value.digest });
  const receipt = consoleShotReceipt({
    capturedAtIso,
    captureId,
    final: { ...identity.value, path: out },
    observation: captured.value.observation,
    walk,
  });
  if (receipt.isErr()) {
    return err(receipt.error);
  }
  const placed = placeConsoleShot({ bytes: stripped.value, home, out, receipt: receipt.value });
  if (placed.isErr()) {
    return err(placed.error);
  }
  return ok({ captureId, receiptPath: placed.value, words: receipt.value.frameText.items.length });
}

/**
 * The walk and `--out` a shot was asked for, once every refusal that needs no build has been made; each refusal is
 * logged here.
 *
 * @param options the parsed `browser` flags, read for `--walk` and `--out`
 * @param home the state home, which `--out` may sit under and a checkout may not
 * @returns the walk and the output path, or `undefined` once a refusal was logged
 */
function shotRequest({
  options,
  home,
}: {
  options: Pick<BrowserOptions, "walk" | "out">;
  home: string;
}): { readonly walk: ConsoleWalk; readonly out: string } | undefined {
  const known = CONSOLE_WALKS.map((w) => w.name);
  if (options.walk === undefined) {
    logger.error({ msg: `\`browser console-shot\` needs --walk <name>; the registered walks are ${known.join(", ")}` });
    return undefined;
  }
  const named = consoleWalkNamed({ name: options.walk });
  if (named === undefined) {
    logger.error({ msg: ConsoleShotErrors.walkUnknown({ known, name: options.walk }).message });
    return undefined;
  }
  const { out } = options;
  if (out === undefined || !out.endsWith(".png")) {
    logger.error({ msg: "`browser console-shot` needs --out <file.png>, where the picture is written" });
    return undefined;
  }
  const replaceable = refuseNonFileOut({ out });
  if (replaceable.isErr()) {
    logger.error({ msg: replaceable.error.message });
    return undefined;
  }
  // Proof lives under the state home, never in a checkout: the same placement rule every other capture verb keeps.
  const placement = refuseProofOutputInTree({ cwd: process.cwd(), env: process.env, home, output: out });
  if (placement.isErr()) {
    logger.error({ msg: placement.error.join("\n") });
    return undefined;
  }
  return { out, walk: named };
}

/**
 * Print what a finished shot left and the step the session owes next.
 *
 * @param shot the finished shot
 * @param walk the walk photographed
 * @param out where the picture is
 * @param json whether machine-readable output was asked for
 */
function reportShot({
  shot,
  walk,
  out,
  json,
}: {
  shot: ShotResult;
  walk: ConsoleWalk;
  out: string;
  json: boolean;
}): void {
  const { captureId, receiptPath, words } = shot;
  const next = "open the picture, look at it, then record what you saw: slopweaver browser image-record --form <form>";
  if (json) {
    logger.out({ line: JSON.stringify({ captureId, next, out, receiptPath, walk: walk.name }, null, 2) });
    return;
  }
  logger.out({ line: `console-shot: ${out}` });
  logger.out({ line: `  walk ${walk.name}: ${walk.summary}` });
  logger.out({ line: `  capture receipt ${captureId}: ${String(words)} word(s) of frame text` });
  logger.out({ line: `  ${next}, citing capture id ${captureId}` });
}

/**
 * Run `browser console-shot`.
 *
 * @param options the parsed `browser` flags, read for `--walk`, `--out` and `--json`
 * @param home the state home the capture receipt is filed under
 * @param capturedAtIso when the shot is taken
 * @returns the process exit code
 */
export async function runBrowserConsoleShot({
  options,
  home,
  capturedAtIso,
}: {
  options: Pick<BrowserOptions, "walk" | "out" | "json">;
  home: string;
  capturedAtIso: string;
}): Promise<number> {
  const request = shotRequest({ home, options });
  if (request === undefined) {
    return EXIT_USAGE;
  }
  const root = mkdtempSync(join(tmpdir(), "sw-console-shot-"));
  const directories: ConsoleShotDirectories = {
    cache: join(root, "cache"),
    capture: join(root, "capture"),
    config: join(root, "config"),
    home: join(root, "home"),
    user: join(root, "user"),
  };
  let shot: Result<ShotResult, ConsoleShotError>;
  try {
    for (const directory of Object.values(directories)) {
      mkdirSync(directory, { recursive: true });
    }
    const cwd = installedTreeRoot({ importMetaUrl: import.meta.url });
    shot = await shoot({ capturedAtIso, cwd, directories, home, out: request.out, walk: request.walk });
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
  if (shot.isErr()) {
    logger.error({ msg: shot.error.message });
    return EXIT_ERROR;
  }
  reportShot({ json: options.json, out: request.out, shot: shot.value, walk: request.walk });
  return EXIT_OK;
}
