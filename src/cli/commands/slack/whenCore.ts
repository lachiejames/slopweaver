/**
 * Pure argument handling and rendering for `slopweaver slack when` — a Slack `ts` to the instant it names.
 *
 * ## Why a verb exists for one line of arithmetic
 *
 * Because the arithmetic is not the hard part; REMEMBERING NOT TO DO IT IN YOUR HEAD is. A Slack `ts` is a
 * ten-digit epoch with a six-digit tail, it appears in every permalink and every thread read, and it looks
 * enough like a date to invite a guess. MEASURED: a run read `1788220579.306599` as
 * an instant 80 minutes later than the real one, and that instant then went
 * into a board row, two cron schedules, a doc's status summary and two supervisors' deadman deadlines. The
 * announcement they governed shipped 53 minutes late. Nothing in the loop could have caught it, because
 * nothing in the loop had a second opinion to compare against.
 *
 * This is that second opinion, and it is deliberately the CHEAPEST thing in the door: no token, no network,
 * no home, one process. A session with a `ts` in hand has no excuse to convert it any other way, and
 * `--json` makes it composable into the writers that used to be handed a hand-typed instant.
 *
 * It accepts a whole permalink as readily as a bare `ts`, because the permalink is what actually gets
 * pasted around and re-deriving the `ts` from it by hand is the same defect one step earlier.
 *
 * Pure: no clock, no filesystem, no network. The shell in `whenRun.ts` only writes what this returns.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import { isSlackTs, slackTsFromPermalink, slackTsToIso } from "../../../lib/slackTs.js";
import { booleanFlagsOf, type FlagSpec, parseFlags, stringFlagsOf } from "../../parseFlags.js";
import { SlackArgumentErrors, type SlackParsed } from "./argumentErrors.js";

/**
 * Every flag this verb accepts.
 *
 * @internal — exported only so {@link SLACK_WHEN_FLAG_NAMES} derives from the real spec rather than a copy.
 */
export const SLACK_WHEN_FLAGS: FlagSpec = {
  boolean: ["json"],
  string: [],
};

/** Every flag NAME, derived from the spec rather than re-listed, so the two cannot drift. */
export const SLACK_WHEN_FLAG_NAMES: readonly string[] = [
  ...booleanFlagsOf({ spec: SLACK_WHEN_FLAGS }),
  ...stringFlagsOf({ spec: SLACK_WHEN_FLAGS }),
]
  .map((name) => `--${name}`)
  .toSorted();

/**
 * The resolved invocation.
 *
 * @internal — the shell in `whenRun.ts` reads it structurally; nothing else names the type.
 */
export interface SlackWhenOptions {
  /** Every `ts` or permalink to convert, in the order given. */
  readonly inputs: readonly string[];
  readonly json: boolean;
}

/**
 * Parse `slack when`'s argv tail.
 *
 * @param rest the argv after the verb
 * @returns the resolved options, or one sentence per refusal
 */
export function parseSlackWhenArgs({ rest }: { rest: readonly string[] }): SlackParsed<SlackWhenOptions> {
  const parsed = parseFlags({ allowPositionals: true, args: rest, spec: SLACK_WHEN_FLAGS });
  if (parsed.isErr()) {
    return err(SlackArgumentErrors.flagsInvalid({ reasons: parsed.error }));
  }
  const inputs = parsed.value.positionals;
  if (inputs.length === 0) {
    return err(SlackArgumentErrors.whenInputMissing());
  }
  return ok({ inputs, json: parsed.value.values["json"] === true });
}

/**
 * One converted input: what was given, the `ts` it resolved to, and the instant that `ts` names.
 *
 * @internal — a member of {@link SlackWhenReport}, which is what consumers hold.
 */
export interface SlackWhenConversion {
  readonly input: string;
  readonly ts: string;
  readonly iso: string;
  /** Present only when the input was a permalink, so a reader can see which half was derived. */
  readonly permalink?: string;
}

/**
 * The document `--json` emits, and the value the text renderer prints.
 *
 * @internal — named by this module's own signatures and its tests; the wire contract is the JSON.
 */
export interface SlackWhenReport {
  readonly schemaVersion: 1;
  readonly kind: "slopweaver.slack.when";
  readonly conversions: readonly SlackWhenConversion[];
}

/** Resolve one input to its `ts`, preferring a permalink's embedded timestamp over the raw string. */
function conversionOf({ input }: { input: string }): SlackWhenConversion | string {
  const trimmed = input.trim();
  const fromPermalink = slackTsFromPermalink({ permalink: trimmed });
  const ts = isSlackTs({ ts: trimmed }) ? trimmed : fromPermalink;
  if (ts === undefined) {
    return `${input}: not a Slack ts and carries no permalink timestamp`;
  }
  const iso = slackTsToIso({ ts });
  if (iso === undefined) {
    return `${input}: resolved to ${ts}, which does not name an instant`;
  }
  return { input, iso, ts, ...(fromPermalink === undefined ? {} : { permalink: trimmed }) };
}

/**
 * Convert every input, refusing the whole invocation when any one of them is not a timestamp.
 *
 * All-or-nothing on purpose: a partial answer would print some instants and swallow the rest, and the
 * caller most likely to script this verb is the one least likely to re-read stderr.
 *
 * @param inputs the `ts` values or permalinks to convert
 * @returns the report, or one sentence per input that could not be resolved
 */
export function slackWhenReport({ inputs }: { inputs: readonly string[] }): Result<SlackWhenReport> {
  const resolved = inputs.map((input) => conversionOf({ input }));
  const problems = resolved.filter((one): one is string => typeof one === "string");
  if (problems.length > 0) {
    return err(problems);
  }
  const conversions = resolved.filter((one): one is SlackWhenConversion => typeof one !== "string");
  return ok({ conversions, kind: "slopweaver.slack.when", schemaVersion: 1 });
}

/**
 * The human rendering: one `<ts>\t<iso>` line per input, so a reader and a `cut -f2` see the same thing.
 *
 * @param report the converted inputs
 * @returns the lines to write to stdout, joined by newlines
 */
export function renderSlackWhen({ report }: { report: SlackWhenReport }): string {
  return report.conversions.map((one) => `${one.ts}\t${one.iso}`).join("\n");
}
