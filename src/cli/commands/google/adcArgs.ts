/**
 * `google adc`'s flags and its I/O-free parser — the half the help-truth ratchet probes, apart from the verb's
 * read-and-wait flow in `./adc.ts`.
 */
import { err, ok, type Result } from "#lib/result.js";

import { adcSigninUnblocks } from "../../../hand/adcSignin.js";
import type { HandContext } from "../../../hand/step.js";
import { parseWaitOptions, WAIT_FLAG_SPEC } from "../../../wait/flags.js";
import { type FlagSpec, parseFlags } from "../../parseFlags.js";

/** `google adc`'s own flags, plus the shared `--wait`/`--timeout-seconds`. */
const STRING_FLAGS: readonly string[] = [...WAIT_FLAG_SPEC.string, "row", "unblocks", "cites", "context", "home"];
const BOOLEAN_FLAGS: readonly string[] = [...WAIT_FLAG_SPEC.boolean];
const FLAGS: FlagSpec = { boolean: BOOLEAN_FLAGS, string: STRING_FLAGS };

/** `--`-prefixed, for the help-truth ratchet. */
export const GOOGLE_ADC_FLAG_NAMES: readonly string[] = [...BOOLEAN_FLAGS, ...STRING_FLAGS]
  .map((name) => `--${name}`)
  .toSorted();

/** A parsed invocation. */
export interface GoogleAdcArgs {
  readonly row: string | undefined;
  /** What waits on the sign-in; built from `row` when only that was given, undefined when neither was. */
  readonly unblocks: string | undefined;
  readonly cites: readonly string[];
  readonly context: HandContext;
  readonly home: string | undefined;
  readonly wait: boolean;
  readonly timeoutSeconds: number;
}

/**
 * A string flag's value, or undefined when it was not passed.
 *
 * @param values the parsed flags
 * @param name the flag, without `--`
 * @returns its value
 */
function stringFlag({
  values,
  name,
}: {
  values: Readonly<Record<string, string | boolean>>;
  name: string;
}): string | undefined {
  const value = values[name];
  return typeof value === "string" ? value : undefined;
}

/**
 * `--context`, checked: the step's context is immutable once posted, so a typo is refused here.
 *
 * @param stated what `--context` carried
 * @returns the context, `work` when none was stated, or the refusal
 */
function contextOf({ stated }: { stated: string | undefined }): Result<HandContext> {
  if (stated === undefined) {
    return ok("work");
  }
  if (stated === "work" || stated === "slopweaver") {
    return ok(stated);
  }
  return err([`--context must be work or slopweaver, not ${stated}`]);
}

/**
 * What the note says the sign-in unblocks: the seat's own words, else the row's, else nothing yet.
 *
 * @param stated what `--unblocks` carried
 * @param row what `--row` carried
 * @returns the text, or undefined when neither flag was passed
 */
function unblocksOf({ stated, row }: { stated: string | undefined; row: string | undefined }): string | undefined {
  if (stated !== undefined) {
    return stated;
  }
  if (row === undefined) {
    return undefined;
  }
  return adcSigninUnblocks({ row });
}

/**
 * Parse one `google adc` invocation. I/O-free; exported so the help-truth ratchet probes the REAL parser.
 *
 * @param rest the argv tail after `google adc`
 * @returns the invocation, or every problem found
 */
export function parseGoogleAdcArgs({ rest }: { rest: readonly string[] }): Result<GoogleAdcArgs> {
  const parsed = parseFlags({ args: rest, spec: FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values } = parsed.value;
  const wait = parseWaitOptions({ values });
  if (wait.isErr()) {
    return err(wait.error);
  }
  const context = contextOf({ stated: stringFlag({ name: "context", values }) });
  if (context.isErr()) {
    return err(context.error);
  }
  const row = stringFlag({ name: "row", values });
  const unblocks = unblocksOf({ row, stated: stringFlag({ name: "unblocks", values }) });
  const cites = stringFlag({ name: "cites", values });
  return ok({
    cites: cites === undefined ? [] : cites.split(",").filter((entry) => entry.trim().length > 0),
    context: context.value,
    home: stringFlag({ name: "home", values }),
    row,
    timeoutSeconds: wait.value.timeoutSeconds,
    unblocks,
    wait: wait.value.wait,
  });
}
