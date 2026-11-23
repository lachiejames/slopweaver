/**
 * The one `hand post` line a seat hands the chair when a Google Application Default Credential needs the owner's sign-in,
 * built and CHECKED here so the chair's post is admitted by construction rather than refused at the owner's note.
 *
 * The literal is the sign-in command itself, run in the OWNER's terminal: that is where its localhost redirect listener
 * lives for as long as they take, which is the whole fix (`../gcloud/adc.ts` has the incident). The
 * seat never runs it; it waits on the credential with `slopweaver google adc --wait`.
 *
 * The step is run through the real `buildHandStep` and `postingRefusal` (`./checkedPost.ts`), so every pure posting rule — the id
 * shape, one plain sentence, a sign-in's address, a cited `#N`, no proof witness — is asked before the line is
 * printed. What stays the register's to judge, under its lock: the row being on the board, one open card per row,
 * and an id already taken.
 */
import type { Result } from "#lib/result.js";
import { shellCommandLine } from "#lib/shellCommandLine.js";

import { ADC_SIGNIN_COMMAND } from "../gcloud/adc.js";

import { checkedPostLine } from "./checkedPost.js";
import type { HandStepError } from "./errors.js";
import type { HandContext } from "./step.js";

/** Every ADC sign-in step's id starts with this, so a second seat can see one is already open. */
export const ADC_SIGNIN_ID_PREFIX = "adc-signin";

/** The longest id `hand post` accepts (`./step.ts`'s `ID_MAX`). */
const ID_MAX = 60;

/** The sentence the note leads with. */
const WHAT = "Sign in to Google Cloud from a plain terminal of yours, so the paused work can read Google Cloud again";

/** Where the paste goes — never a Claude pane, whose shell is exactly the listener that dies. */
const WHERE = "a plain terminal, not a Claude session; pick your work Google account when the browser opens";

/** What a seat asks for. */
export interface AdcSigninInput {
  /** The board row the seat is running, so the card leaves when that row does. */
  readonly row?: string;
  /** What waits on the sign-in, in the owner's words. */
  readonly unblocks: string;
  /** Addresses for any `#N` the step names. */
  readonly cites: readonly string[];
  readonly context: HandContext;
  /** The seat's `CLOUDSDK_CONFIG`, so the owner's sign-in writes the file the seat reads. */
  readonly cloudsdkConfig?: string;
  /** The seat that is stopped, as `hand post --by-session` records it; absent outside cmux. */
  readonly bySession?: string;
}

/** The checked line, as argv and as one pasteable command. */
export interface AdcSigninLine {
  readonly id: string;
  readonly argv: readonly string[];
  readonly line: string;
}

/**
 * The step id for a row: `adc-signin-<row>`, cut to the id limit without a dangling separator.
 *
 * @param row the board row, when the step belongs to one
 * @returns the id
 */
export function adcSigninId({ row }: { row?: string | undefined }): string {
  if (row === undefined) {
    return ADC_SIGNIN_ID_PREFIX;
  }
  return `${ADC_SIGNIN_ID_PREFIX}-${row}`.slice(0, ID_MAX).replace(/[-.]+$/u, "");
}

/**
 * What a row's step says it unblocks when the seat gave no sentence of its own.
 *
 * @param row the board row the seat is running
 * @returns the default `--unblocks` text
 */
export function adcSigninUnblocks({ row }: { row: string }): string {
  return `board row ${row}, stopped until Google Cloud application credentials work`;
}

/**
 * Build the `hand post` line and ask every pure posting rule of it.
 *
 * @param input the row, what waits, citations, context and the seat's gcloud config directory
 * @returns the id, argv and line, or the first rule that refused the step
 */
export function adcSigninLine({ input }: { input: AdcSigninInput }): Result<AdcSigninLine, HandStepError> {
  const { row, unblocks, cites, context, cloudsdkConfig, bySession } = input;
  const id = adcSigninId({ row });
  // Only the VALUE is quoted: a quoted whole assignment is read by the shell as a command name, not an assignment.
  const literal =
    cloudsdkConfig === undefined
      ? ADC_SIGNIN_COMMAND
      : `CLOUDSDK_CONFIG=${shellCommandLine({ command: [cloudsdkConfig] })} ${ADC_SIGNIN_COMMAND}`;
  const witness = shellCommandLine({ command: ["slopweaver", "hand", "done", id, "--did", "signed-in"] });
  const draft = {
    context,
    id,
    literal,
    postedBy: "google adc",
    postedIso: "1970-01-01T00:00:00.000Z",
    unblocks,
    what: WHAT,
    where: WHERE,
    witness,
    ...(cites.length === 0 ? {} : { cites }),
    ...(row === undefined ? {} : { row }),
  };
  const argv = [
    "slopweaver",
    "hand",
    "post",
    "--id",
    id,
    "--what",
    WHAT,
    "--literal",
    literal,
    "--where",
    WHERE,
    "--unblocks",
    unblocks,
    "--witness",
    witness,
    "--context",
    context,
    ...(row === undefined ? ["--standalone"] : ["--row", row]),
    "--blocks",
    ...(cites.length === 0 ? [] : ["--cites", cites.join(",")]),
    ...(bySession === undefined ? [] : ["--by-session", bySession]),
  ];
  return checkedPostLine({ argv, draft }).map((checked) => ({ ...checked, id }));
}
