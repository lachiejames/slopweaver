/**
 * The PURE core of `slopweaver datadog triage`: its flag parser and the lines it prints. No client, no clock,
 * no env — `triageRun.ts` does every credential resolution and every call.
 */
import { ERROR_TRACKING_STATE_LABELS, parseErrorTrackingState } from "../../../datadog/errorTracking.js";
import { TRIAGE_TARGET_STATES, type TriagePlan, type TriageTargetState } from "../../../datadog/errorTrackingTriage.js";
import type { IssueStateRow } from "../../../datadog/errorTrackingTriageErrors.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { collectRepeated, parseFlagTail, withoutRepeated } from "../../optionParsers.js";
import { type DatadogArgsError, DatadogArgsErrors } from "./errors.js";

/** The validated invocation for `datadog triage`. */
export interface DatadogTriageOptions {
  /** Every issue id named, split on commas across every `--issue`, in the order written. */
  readonly issues: readonly string[];
  readonly state: TriageTargetState;
  /** `--dry-run`: read and plan, move nothing. */
  readonly dryRun: boolean;
  readonly home: string | undefined;
  readonly json: boolean;
}

/**
 * Every flag `datadog triage` accepts, as the parser itself reads them. `issue` is repeatable, so it is
 * collected before the single-value tokeniser sees the tail.
 *
 * @internal the spec itself stays in this file; {@link DATADOG_TRIAGE_FLAG_NAMES} is what the help ratchet reads.
 */
export const DATADOG_TRIAGE_FLAG_SPEC = {
  boolean: ["dry-run", "json"],
  repeatable: ["issue"],
  value: ["state", "home"],
} as const;

/** {@link DATADOG_TRIAGE_FLAG_SPEC}'s names in `--flag` form, for the help ratchet. */
export const DATADOG_TRIAGE_FLAG_NAMES: readonly string[] = [
  ...DATADOG_TRIAGE_FLAG_SPEC.repeatable.map((name) => `--${name}`),
  ...DATADOG_TRIAGE_FLAG_SPEC.value.map((name) => `--${name}`),
  ...DATADOG_TRIAGE_FLAG_SPEC.boolean.map((name) => `--${name}`),
];

/** The kebab-case words `--state` takes, in the order the usage line names them. */
const TARGET_WORDS = "reviewed, ignored, resolved, for-review";

/** `--state` read as a state a triage may move into, or the one reason it is not. */
function parseTargetState({ raw }: { raw: string | undefined }): {
  state: TriageTargetState | undefined;
  reasons: string[];
} {
  if (raw === undefined) {
    return { reasons: [`--state is required: one of ${TARGET_WORDS}`], state: undefined };
  }
  const parsed = parseErrorTrackingState({ value: raw });
  const state = TRIAGE_TARGET_STATES.find((each) => each === parsed);
  if (state === undefined) {
    return { reasons: [`--state '${raw}' is not one a triage moves into — one of ${TARGET_WORDS}`], state };
  }
  return { reasons: [], state };
}

/**
 * Every `--issue` occurrence read strictly: each must carry a value, and no comma member may be empty. A
 * dropped member would be an issue the caller named and the verb silently never moved, then exited 0 on.
 */
function parseIssueList({ rest }: { rest: readonly string[] }): { issues: string[]; reasons: string[] } {
  const occurrences = rest.filter((token) => token === "--issue" || token.startsWith("--issue=")).length;
  const values = collectRepeated({ name: "--issue", rest });
  const reasons: string[] = [];
  if (values.length < occurrences) {
    reasons.push("--issue was given without a value — pass one or more issue ids after each --issue");
  }
  const members = values.flatMap((value) => value.split(",")).map((value) => value.trim());
  if (members.some((member) => member === "")) {
    reasons.push("--issue carries an empty member — every comma-separated entry must be an issue id");
  }
  if (occurrences === 0) {
    reasons.push("--issue is required: one or more Error Tracking issue ids, comma-separated or repeated");
  }
  return { issues: members.filter((member) => member !== ""), reasons };
}

/**
 * Parse `datadog triage`'s flags.
 *
 * @param rest the argv tail
 * @returns the validated options, or every rejection
 */
export function parseDatadogTriageOptions({
  rest,
}: {
  rest: readonly string[];
}): Result<DatadogTriageOptions, DatadogArgsError> {
  const { issues, reasons: issueReasons } = parseIssueList({ rest });
  const parsed = parseFlagTail({
    rest: withoutRepeated({ name: "--issue", rest }),
    spec: { boolean: [...DATADOG_TRIAGE_FLAG_SPEC.boolean], value: [...DATADOG_TRIAGE_FLAG_SPEC.value] },
  });
  if (parsed.isErr()) {
    return err(DatadogArgsErrors.flagsInvalid({ reasons: parsed.error }));
  }
  const { values, flags } = parsed.value;
  const reasons = [...issueReasons];
  const { state, reasons: stateReasons } = parseTargetState({ raw: values["state"] });
  reasons.push(...stateReasons);
  if (reasons.length > 0 || state === undefined) {
    return err(DatadogArgsErrors.optionsRefused({ reasons }));
  }
  return ok({
    dryRun: flags.has("dry-run"),
    home: values["home"],
    issues,
    json: flags.has("json"),
    state,
  });
}

/**
 * The lines a plan prints before anything is moved.
 *
 * @param plan which issues are already in the target state and which this run moves
 * @param verb `would move` for a dry run, `plan: move` before the door decides a real one
 * @returns the lines
 */
export function triagePlanLines({ plan, verb }: { plan: TriagePlan; verb: string }): readonly string[] {
  const target = ERROR_TRACKING_STATE_LABELS[plan.target];
  return [
    `${verb} ${String(plan.toMove.length)} issue(s) to ${target}; ${String(plan.alreadyThere.length)} already ${target}`,
    ...plan.toMove.map((row) => `  ${row.id}  ${ERROR_TRACKING_STATE_LABELS[row.state]} → ${target}`),
  ];
}

/**
 * One line per issue as the read-back found it.
 *
 * @param rows each issue's state after the moves
 * @returns the lines, in the order the issues were named
 */
export function triageStateLines({ rows }: { rows: readonly IssueStateRow[] }): readonly string[] {
  return rows.map((row) => `${ERROR_TRACKING_STATE_LABELS[row.state].padEnd(10)}  ${row.id}`);
}
