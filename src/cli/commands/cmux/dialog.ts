/**
 * `slopweaver cmux dialog [--dismiss]` — from INSIDE a seat, list the modal dialogs cmux is holding open, and with
 * `--dismiss` press Cancel on the one allowlisted prompt. The hangs were a "Run Project Action?" alert
 * waiting for a click (`../../../cmux/dialog.ts`); a seat's own timed-out call declines it once a minute on its own
 * (`../../../cmux/dialogRecovery.ts`), and this is the same decline on request, never rate-limited.
 *
 * No flag names a title or a button: the allowlist is the whole of what it can press.
 */
import { logger } from "#lib/logger.js";
import type { Result } from "#lib/result.js";

import { type CmuxDialogError } from "../../../cmux/dialog.js";
import {
  type DialogRecoveryDeps,
  type DialogReport,
  inspectDialogs,
  productionDialogRecoveryDeps,
} from "../../../cmux/dialogRecovery.js";
import { slopweaverHome } from "../../../config.js";
import type { FleetError } from "../../../fleet/errors.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseCmuxVerb, stringFlag } from "./core.js";

/** What one invocation asked for. */
export interface DialogRequest {
  readonly dismiss: boolean;
  readonly json: boolean;
  readonly home: string;
}

/** Parse the flags. */
function readRequest({ argv }: { argv: readonly string[] }): DialogRequest | number {
  const parsed = parseCmuxVerb({ argv, verb: "dialog" });
  if (typeof parsed === "number") {
    return parsed;
  }
  if (parsed.positionals.length > 0) {
    logger.error({ msg: `cmux dialog: takes no positional argument (got ${parsed.positionals.join(" ")})` });
    return EXIT_USAGE;
  }
  let home = slopweaverHome();
  const namedHome = stringFlag({ name: "home", parsed });
  if (namedHome !== undefined) {
    home = namedHome;
  }
  return { dismiss: parsed.values["dismiss"] === true, home, json: parsed.values["json"] === true };
}

/**
 * The report as lines: each dialog's title, text and buttons, then what was pressed — or that nothing was.
 *
 * @param report what the look found and did
 * @param dismiss whether a press was asked for
 * @returns the lines
 */
export function dialogLines({ report, dismiss }: { report: DialogReport; dismiss: boolean }): readonly string[] {
  if (report.dialogs.length === 0) {
    return ["cmux dialog: cmux shows no modal dialog"];
  }
  const lines = report.dialogs.flatMap((dialog) => [
    `cmux dialog: "${dialog.title}" — buttons: ${dialog.buttons.join(", ")}`,
    ...dialog.texts.map((text) => `  ${text}`),
  ]);
  if (report.dismissed !== null) {
    lines.push(`pressed ${report.dismissed.button} on "${report.dismissed.title}", and journalled it`);
  } else if (dismiss) {
    lines.push("pressed nothing: no dialog shown is one the fleet may answer");
  } else {
    lines.push("pressed nothing (read only)");
  }
  return lines;
}

/**
 * The exit code a look reads as: 0 read or pressed, 3 a press asked for with nothing allowlisted to press, 1 failed.
 *
 * @param result what the look returned
 * @param dismiss whether a press was asked for
 * @returns the exit code
 */
export function dialogExit({
  result,
  dismiss,
}: {
  result: Result<DialogReport, CmuxDialogError | FleetError>;
  dismiss: boolean;
}): number {
  if (result.isErr()) {
    return EXIT_ERROR;
  }
  return dismiss && result.value.dismissed === null ? EXIT_EXPECTED_EMPTY : EXIT_OK;
}

/**
 * One look, over the given effects.
 *
 * @param request what the invocation asked for
 * @param deps every effect it reaches
 * @returns the exit code
 */
export async function dialogPass({
  request,
  deps,
}: {
  request: DialogRequest;
  deps: DialogRecoveryDeps;
}): Promise<number> {
  const result = await inspectDialogs({ deps, dismiss: request.dismiss, home: request.home });
  if (result.isErr()) {
    logger.error({ msg: `cmux dialog: ${result.error.message}` });
  } else if (request.json) {
    logger.out({ line: JSON.stringify(result.value) });
  } else {
    for (const line of dialogLines({ dismiss: request.dismiss, report: result.value })) {
      logger.out({ line });
    }
  }
  return dialogExit({ dismiss: request.dismiss, result });
}

/**
 * `cmux dialog` — list cmux's modal dialogs, and with `--dismiss` decline the allowlisted one.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runCmuxDialog(argv: readonly string[]): Promise<number> {
  const request = readRequest({ argv });
  if (typeof request === "number") {
    return request;
  }
  return dialogPass({ deps: productionDialogRecoveryDeps(), request });
}

export const cmuxDialogCommand = defineCommand({ run: runCmuxDialog });
