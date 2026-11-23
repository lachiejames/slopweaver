/**
 * The `witness` noun's flag specs and typed option parsers.
 *
 * Pure: no filesystem, no clock, no environment. Every parse refusal is therefore I/O-free, which is what the
 * manifest's `parseRejectIsIoFree` claims. The settle invariants that need the JOURNAL (an unknown id, a
 * second terminal) are the domain's (`../../../live/witness/journal.ts`), and so are the ones about which
 * outcome needs `--why` or `--posted-ts`, so a test of the rule tests one function rather than two copies.
 * The single-field readers every parser here shares are `./argFields.ts`.
 */
import { err, ok, type Result } from "#lib/result.js";
import { parseSlackThreadPermalink } from "../../../live/slack/permalink.js";
import type { WitnessHelpRequest } from "../../../live/witness/help.js";
import type { WitnessReviseRequest } from "../../../live/witness/revise.js";
import type { WitnessStandDownRequest, WitnessThreadStandDownRequest } from "../../../live/witness/standDown.js";
import {
  HELP_OUTCOME,
  isWitnessSettleOutcome,
  STOOD_DOWN_OUTCOME,
  WITNESS_SETTLE_OUTCOMES,
  type WitnessKey,
  type WitnessSelector,
  type WitnessSettleOutcome,
} from "../../../live/witness/types.js";
import { booleanFlagsOf, type FlagSpec, parseFlags, stringFlagsOf } from "../../parseFlags.js";
import { commonOf, keyOf, requiredOf, stringOf, tsOf, witnessIdOfPositionals } from "./argFields.js";

/** How many argv entries precede a verb's own arguments. Four: `[node, cli, noun, verb, …]`. */
export const VERB_ARG_OFFSET = 4;

/** Flags each `witness` verb accepts. */
const SPECS: Readonly<Record<string, FlagSpec>> = {
  dispatch: { boolean: ["json"], string: ["channel", "home", "message-ts", "model", "text", "thread-ts"] },
  help: { string: ["channel", "home", "message-ts", "text", "thread-ts", "user"] },
  list: { boolean: ["json"], string: ["home"] },
  resume: { string: ["home"] },
  revise: { boolean: ["dry-run"], string: ["because", "correction", "home", "wrong"] },
  settle: { boolean: ["json"], string: ["as", "channel", "home", "message-ts", "posted-ts", "thread-ts", "why"] },
  "stand-down": { string: ["channel", "home", "message-ts", "thread-ts", "why"] },
};

/** `--`-prefixed flag names per verb, for the help-truth ratchet. */
export const WITNESS_FLAG_NAMES: Readonly<Record<string, readonly string[]>> = Object.fromEntries(
  Object.entries(SPECS).map(([verb, spec]) => [
    verb,
    [...stringFlagsOf({ spec }), ...booleanFlagsOf({ spec })].map((name) => `--${name}`).toSorted(),
  ]),
);

/** What `witness dispatch` was asked to boot. */
export interface WitnessDispatchOptions {
  readonly key: WitnessKey;
  readonly text: string;
  readonly model: string;
  readonly home: string | undefined;
  readonly json: boolean;
}

/** What `witness resume` was asked to print. */
export interface WitnessResumeOptions {
  readonly witnessId: string;
  readonly home: string | undefined;
}

/** What `witness settle` was asked to journal. */
export interface WitnessSettleOptions {
  readonly selector: WitnessSelector;
  readonly outcome: WitnessSettleOutcome;
  readonly why: string | undefined;
  readonly postedTs: string | undefined;
  readonly home: string | undefined;
  readonly json: boolean;
}

/** What `witness help` was asked to take up. */
export interface WitnessHelpOptions {
  readonly request: WitnessHelpRequest;
  readonly home: string | undefined;
}

/** What `witness stand-down` was asked to record: one message (`--message-ts` given), or the whole thread. */
export type WitnessStandDownOptions =
  | { readonly scope: "message"; readonly request: WitnessStandDownRequest; readonly home: string | undefined }
  | { readonly scope: "thread"; readonly request: WitnessThreadStandDownRequest; readonly home: string | undefined };

/** What `witness revise` was asked to strike, and what to say instead. */
export interface WitnessReviseOptions {
  readonly request: WitnessReviseRequest;
  readonly home: string | undefined;
}

/** What `witness list` was asked to print. */
export interface WitnessListOptions {
  readonly home: string | undefined;
  readonly json: boolean;
}

/**
 * Parse `witness dispatch`.
 *
 * `--model` is required with no default: a spawn with no pin boots onto the launching user's saved default,
 * the drift `cmux/modelPin.ts` exists to stop.
 *
 * @param rest the argv after the noun and verb
 * @returns the options, or every reason it could not be one
 */
export function parseWitnessDispatchArgs({ rest }: { rest: readonly string[] }): Result<WitnessDispatchOptions> {
  const parsed = parseFlags({ args: rest, spec: SPECS["dispatch"]! });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values } = parsed.value;
  const problems: string[] = [];
  const key = keyOf({ problems, required: true, values });
  const text = requiredOf({ name: "text", problems, values, why: "the witnessed message's text, for the worker" });
  const model = requiredOf({
    name: "model",
    problems,
    values,
    why: "name the worker's model (sonnet for a routine check, opus for a deep one); there is no default",
  });
  if (key === undefined || text === undefined || model === undefined) {
    return err(problems);
  }
  return ok({ key, model: model.trim(), text, ...commonOf({ values }) });
}

/**
 * Parse `witness help`: the witness line's coordinates, its author and its text — every field the line
 * carries, so the loop passes them straight through and nothing is re-read from Slack.
 *
 * @param rest the argv after the noun and verb
 * @returns the options, or every reason it could not be one
 */
export function parseWitnessHelpArgs({ rest }: { rest: readonly string[] }): Result<WitnessHelpOptions> {
  const parsed = parseFlags({ args: rest, spec: SPECS["help"]! });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values } = parsed.value;
  const problems: string[] = [];
  const key = keyOf({ problems, required: true, values });
  const userId = requiredOf({ name: "user", problems, values, why: "the witness line's userId — who wrote it" });
  const text = requiredOf({ name: "text", problems, values, why: "the witness line's text — what the card opens on" });
  if (key === undefined || userId === undefined || text === undefined) {
    return err(problems);
  }
  return ok({ home: stringOf({ name: "home", values }), request: { key, text, userId: userId.trim() } });
}

/**
 * Parse `witness stand-down`: the message that told the bot it was in the way — or, with no `--message-ts`, the
 * whole thread — and a `--why` saying what was said, so a later reader of the journal knows why it went quiet.
 *
 * @param rest the argv after the noun and verb
 * @returns the options, or every reason it could not be one
 */
export function parseWitnessStandDownArgs({ rest }: { rest: readonly string[] }): Result<WitnessStandDownOptions> {
  const parsed = parseFlags({ args: rest, spec: SPECS["stand-down"]! });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values } = parsed.value;
  const problems: string[] = [];
  const home = stringOf({ name: "home", values });
  const reason = "what was said that told the bot to stand down";
  if (stringOf({ name: "message-ts", values }) === undefined) {
    const thread = threadOf({ problems, values });
    const why = requiredOf({ name: "why", problems, values, why: reason });
    if (thread === undefined || why === undefined) {
      return err(problems);
    }
    return ok({ home, request: { ...thread, why: why.trim() }, scope: "thread" });
  }
  const key = keyOf({ problems, required: true, values });
  const why = requiredOf({ name: "why", problems, values, why: reason });
  if (key === undefined || why === undefined) {
    return err(problems);
  }
  return ok({ home, request: { key, why: why.trim() }, scope: "message" });
}

/** The whole-thread coordinates — the channel and the thread's root — recording what is missing. */
function threadOf({
  problems,
  values,
}: {
  problems: string[];
  values: Readonly<Record<string, string | boolean>>;
}): { channel: string; threadTs: string } | undefined {
  const before = problems.length;
  const channel = requiredOf({ name: "channel", problems, values, why: "the thread's channel id" });
  const threadTs = tsOf({ name: "thread-ts", problems, values });
  if (stringOf({ name: "thread-ts", values }) === undefined) {
    problems.push("--thread-ts is required — the thread to stand down (add --message-ts to react on one message)");
  }
  if (problems.length > before || channel === undefined || threadTs === undefined) {
    return undefined;
  }
  return { channel, threadTs };
}

/**
 * Parse `witness resume`.
 *
 * @param rest the argv after the noun and verb
 * @returns the options, or every reason it could not be one
 */
export function parseWitnessResumeArgs({ rest }: { rest: readonly string[] }): Result<WitnessResumeOptions> {
  const parsed = parseFlags({ allowPositionals: true, args: rest, spec: SPECS["resume"]! });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const problems: string[] = [];
  const witnessId = witnessIdOfPositionals({ positionals: parsed.value.positionals, problems });
  if (witnessId === undefined) {
    if (problems.length === 0) {
      problems.push("a witness id is required — the pickup line names it");
    }
    return err(problems);
  }
  return ok({ home: stringOf({ name: "home", values: parsed.value.values }), witnessId });
}

/**
 * Parse `witness revise`: the posted witness's id, the claim's exact words, the line to say instead, and the
 * permalink of the message that showed it wrong. There is no `--channel` or `--ts`: the reply it edits is the one
 * the journal recorded as posted, never one the caller names.
 *
 * `--wrong` is kept exactly as given (the strike must match the reply's own words; the correction runner refuses
 * stray whitespace), and `--correction` is a single line the runner checks.
 *
 * @param rest the argv after the noun and verb
 * @returns the options, or every reason it could not be one
 */
export function parseWitnessReviseArgs({ rest }: { rest: readonly string[] }): Result<WitnessReviseOptions> {
  const parsed = parseFlags({ allowPositionals: true, args: rest, spec: SPECS["revise"]! });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { positionals, values } = parsed.value;
  const problems: string[] = [];
  const witnessId = witnessIdOfPositionals({ positionals, problems });
  if (witnessId === undefined && problems.length === 0) {
    problems.push("a witness id is required — the posted witness to revise (slopweaver witness list)");
  }
  const wrong = requiredOf({
    name: "wrong",
    problems,
    values,
    why: "the claim's exact words, as the reply states them",
  });
  const correction = requiredOf({ name: "correction", problems, values, why: "what is true now, in one line" });
  const because = requiredOf({
    name: "because",
    problems,
    values,
    why: "the permalink of the message that showed the reply was wrong",
  });
  if (because !== undefined && parseSlackThreadPermalink({ permalink: because }).isErr()) {
    problems.push(`--because must be a Slack message permalink, got "${because}"`);
  }
  const complete = witnessId !== undefined && wrong !== undefined && correction !== undefined && because !== undefined;
  if (!complete || problems.length > 0) {
    return err(problems);
  }
  return ok({
    home: stringOf({ name: "home", values }),
    request: { because: because.trim(), correction, dryRun: values["dry-run"] === true, witnessId, wrong },
  });
}

/**
 * Parse `witness settle`: a positional witness id OR the complete coordinate triple, never both.
 *
 * @param rest the argv after the noun and verb
 * @returns the options, or every reason it could not be one
 */
export function parseWitnessSettleArgs({ rest }: { rest: readonly string[] }): Result<WitnessSettleOptions> {
  const parsed = parseFlags({ allowPositionals: true, args: rest, spec: SPECS["settle"]! });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { positionals, values } = parsed.value;
  const problems: string[] = [];
  const witnessId = witnessIdOfPositionals({ positionals, problems });
  const key = keyOf({ problems, required: false, values });
  let selector: WitnessSelector | undefined;
  if (witnessId !== undefined && key !== undefined) {
    problems.push("name the witness by its id OR by --channel/--thread-ts/--message-ts, never both");
  } else if (witnessId !== undefined) {
    selector = { kind: "id", witnessId };
  } else if (key !== undefined) {
    selector = { key, kind: "key" };
  } else if (problems.length === 0) {
    problems.push("name the witness: its id, or --channel, --thread-ts and --message-ts");
  }
  const rawAs = stringOf({ name: "as", values });
  let outcome: WitnessSettleOutcome | undefined;
  if (rawAs === HELP_OUTCOME) {
    problems.push(
      "--as helped is journalled by slopweaver witness help alone, which writes it before the card goes up — " +
        "settle never records a help",
    );
  } else if (rawAs === STOOD_DOWN_OUTCOME) {
    problems.push(
      "--as stood-down is journalled by slopweaver witness stand-down alone, which puts the reaction on the " +
        "message first — settle never records one",
    );
  } else if (rawAs !== undefined && isWitnessSettleOutcome(rawAs)) {
    outcome = rawAs;
  } else {
    problems.push(`--as must be one of ${WITNESS_SETTLE_OUTCOMES.join(", ")}`);
  }
  const postedTs = tsOf({ name: "posted-ts", problems, values });
  if (selector === undefined || outcome === undefined || problems.length > 0) {
    return err(problems);
  }
  return ok({ outcome, postedTs, selector, why: stringOf({ name: "why", values }), ...commonOf({ values }) });
}

/**
 * Parse `witness list`.
 *
 * @param rest the argv after the noun and verb
 * @returns the options, or every reason it could not be one
 */
export function parseWitnessListArgs({ rest }: { rest: readonly string[] }): Result<WitnessListOptions> {
  const parsed = parseFlags({ args: rest, spec: SPECS["list"]! });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  return ok(commonOf({ values: parsed.value.values }));
}
