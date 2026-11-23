/**
 * Argument parsing for the proposal register's lifecycle-write verbs: `status`, `decide`, `supersede`,
 * `record-slack`, `follow-up` and `audience`, whose effectful shell is `./registerRun.ts` — plus the shared
 * pure parsing helpers (`Parsed`, `flagNames`, `isoDate`, `text`, `requireSlug`) that `./registerCoreRead.ts`
 * (`list`, `show`, `drift`) and `./registerCoreFeedback.ts` (`record-feedback`, `answer-feedback`,
 * `feedback`) import.
 */
import { parseIsoMs } from "../../../lib/date.js";
import { err, ok, type Result } from "../../../lib/result.js";
import {
  isRegisterDecisionOutcome,
  isSettableRegisterStatus,
  type RegisterDecisionOutcome,
  type SettableRegisterStatus,
} from "../../../outbound/proposal/register/events.js";
import { booleanFlagsOf, type FlagSpec, parseFlags, stringFlagOr, stringFlagsOf } from "../../parseFlags.js";
import { type ProposalError, ProposalErrors } from "./errors.js";
import { SETTABLE_STATUS_LIST } from "./registerUsage.js";

/** What every parser here answers: the parsed arguments, or the one typed failure that refused them. */
export type Parsed<T> = Result<T, ProposalError>;

/** A parsed `proposal status` invocation. */
export interface ProposalStatusArgs {
  readonly slug: string;
  readonly status: SettableRegisterStatus;
  readonly occurredIso: string | undefined;
  readonly why: string;
  readonly json: boolean;
  readonly home: string | undefined;
}

/** A parsed `proposal decide` invocation. */
export interface ProposalDecideArgs {
  readonly slug: string;
  readonly decision: string;
  readonly decider: string;
  readonly decidedIso: string | undefined;
  readonly outcome: RegisterDecisionOutcome;
  readonly why: string;
  readonly json: boolean;
  readonly home: string | undefined;
}

/** A parsed `proposal supersede` invocation. */
export interface ProposalSupersedeArgs {
  readonly slug: string;
  readonly by: string;
  readonly occurredIso: string | undefined;
  readonly why: string;
  readonly json: boolean;
  readonly home: string | undefined;
}

/** A parsed `proposal record-slack` invocation. */
export interface ProposalRecordSlackArgs {
  readonly slug: string;
  readonly permalink: string;
  readonly json: boolean;
  readonly home: string | undefined;
}

/** A parsed `proposal follow-up` invocation. */
export interface ProposalFollowUpArgs {
  readonly slug: string;
  readonly ref: string;
  readonly occurredIso: string | undefined;
  readonly label: string | undefined;
  readonly json: boolean;
  readonly home: string | undefined;
}

const STATUS_FLAGS: FlagSpec = { boolean: ["json"], string: ["why", "date", "home"] };
const DECIDE_FLAGS: FlagSpec = {
  boolean: ["json"],
  string: ["decision", "decider", "date", "outcome", "why", "home"],
};
const SUPERSEDE_FLAGS: FlagSpec = { boolean: ["json"], string: ["by", "why", "date", "home"] };
const RECORD_SLACK_FLAGS: FlagSpec = { boolean: ["json"], string: ["permalink", "home"] };
const FOLLOW_UP_FLAGS: FlagSpec = { boolean: ["json"], string: ["ref", "label", "date", "home"] };
const AUDIENCE_FLAGS: FlagSpec = { boolean: ["json"], string: ["audience", "home"] };

/**
 * Every declared flag name of a spec, prefixed.
 *
 * @returns each string and boolean flag of the spec, with its leading `--`
 */
export function flagNames({ spec }: { spec: FlagSpec }): readonly string[] {
  return [...stringFlagsOf({ spec }), ...booleanFlagsOf({ spec })].map((name) => `--${name}`);
}

/** Every `proposal status` flag, WITH the `--`, for the help-truth ratchet. */
export const PROPOSAL_STATUS_FLAG_NAMES: readonly string[] = flagNames({ spec: STATUS_FLAGS });
/** Every `proposal decide` flag, WITH the `--`, for the help-truth ratchet. */
export const PROPOSAL_DECIDE_FLAG_NAMES: readonly string[] = flagNames({ spec: DECIDE_FLAGS });
/** Every `proposal supersede` flag, WITH the `--`, for the help-truth ratchet. */
export const PROPOSAL_SUPERSEDE_FLAG_NAMES: readonly string[] = flagNames({ spec: SUPERSEDE_FLAGS });
/** Every `proposal record-slack` flag, WITH the `--`, for the help-truth ratchet. */
export const PROPOSAL_RECORD_SLACK_FLAG_NAMES: readonly string[] = flagNames({ spec: RECORD_SLACK_FLAGS });
/** Every `proposal follow-up` flag, WITH the `--`, for the help-truth ratchet. */
export const PROPOSAL_FOLLOW_UP_FLAG_NAMES: readonly string[] = flagNames({ spec: FOLLOW_UP_FLAGS });
/** Every `proposal audience` flag, WITH the `--`, for the help-truth ratchet. */
export const PROPOSAL_AUDIENCE_FLAG_NAMES: readonly string[] = flagNames({ spec: AUDIENCE_FLAGS });

/**
 * A `--date` that is present and parseable, `undefined` when absent, or the operator-facing refusal.
 *
 * Validated rather than stored as typed. `--date` used to accept any string at all while the help promised
 * ISO-8601, which was harmless while nothing read it back; `./drift.ts` now does arithmetic on it, so an
 * unparseable date would turn a comparison into an `unassessable` verdict long after the typo was made.
 *
 * @returns the validated ISO string or `undefined` when the flag is absent, else the `dateInvalid` refusal
 */
export function isoDate({
  values,
  name,
}: {
  values: Readonly<Record<string, string | boolean>>;
  name: string;
}): { readonly iso: string | undefined } | { readonly error: ProposalError } {
  const raw = typeof values[name] === "string" ? values[name] : undefined;
  if (raw === undefined) {
    return { iso: undefined };
  }
  return parseIsoMs({ tsIso: raw }) === undefined ? { error: ProposalErrors.dateInvalid({ name, raw }) } : { iso: raw };
}

/**
 * Read a declared string flag, or nothing.
 *
 * @returns the flag's string value, or `undefined` when it is absent or boolean
 */
export function text({
  values,
  name,
}: {
  values: Readonly<Record<string, string | boolean>>;
  name: string;
}): string | undefined {
  return typeof values[name] === "string" ? values[name] : undefined;
}

/**
 * Pull the leading `<slug>` positional off a verb's args, or the usage refusal.
 *
 * @returns the slug and the flags after it, or the `usage` refusal when no slug leads the args
 */
export function requireSlug({
  rest,
  usage,
}: {
  rest: readonly string[];
  usage: string;
}): { readonly slug: string; readonly flags: readonly string[] } | { readonly error: ProposalError } {
  const [slug, ...flags] = rest;
  if (slug === undefined || slug.startsWith("-")) {
    return { error: ProposalErrors.usage({ usage }) };
  }
  return { flags, slug };
}

/**
 * Parse `proposal status <slug> <strawman|shared|discussed|withdrawn> --why <text>`.
 *
 * @param rest the verb's arguments
 * @returns the parsed arguments, or the operator-facing errors
 */
export function parseProposalStatusArgs({ rest }: { rest: readonly string[] }): Parsed<ProposalStatusArgs> {
  const usage =
    `usage: slopweaver proposal status <slug> <${SETTABLE_STATUS_LIST}> --why <text> [--date <iso>] [--json] ` +
    "[--home <dir>]\n" +
    "  `decided`, `rejected` and `superseded` are set only by `proposal decide`/`proposal supersede` — never here.";
  const head = requireSlug({ rest, usage });
  if ("error" in head) {
    return err(head.error);
  }
  const [status, ...flags] = head.flags;
  if (status === undefined || status.startsWith("-")) {
    return err(ProposalErrors.usage({ usage }));
  }
  if (!isSettableRegisterStatus(status)) {
    return err(ProposalErrors.statusNotSettable({ status }));
  }
  const parsed = parseFlags({ args: flags, spec: STATUS_FLAGS });
  if (parsed.isErr()) {
    return err(ProposalErrors.flagsInvalid({ reasons: parsed.error }));
  }
  const { values } = parsed.value;
  const why = text({ name: "why", values });
  if (why === undefined || why.trim().length === 0) {
    return err(ProposalErrors.whyRequired());
  }
  const date = isoDate({ name: "date", values });
  if ("error" in date) {
    return err(date.error);
  }
  return ok({
    home: text({ name: "home", values }),
    json: values["json"] === true,
    occurredIso: date.iso,
    slug: head.slug,
    status,
    why: why.trim(),
  });
}

/**
 * Parse `proposal decide <slug> --decision <text> --decider <name> --why <text> [--date <iso>]`.
 *
 * @param rest the verb's arguments
 * @returns the parsed arguments, or the operator-facing errors
 */
export function parseProposalDecideArgs({ rest }: { rest: readonly string[] }): Parsed<ProposalDecideArgs> {
  const usage =
    "usage: slopweaver proposal decide <slug> --decision <text> --decider <name> --why <text> " +
    "[--outcome approved|rejected] [--date <iso>] [--json] [--home <dir>]";
  const head = requireSlug({ rest, usage });
  if ("error" in head) {
    return err(head.error);
  }
  const parsed = parseFlags({ args: head.flags, spec: DECIDE_FLAGS });
  if (parsed.isErr()) {
    return err(ProposalErrors.flagsInvalid({ reasons: parsed.error }));
  }
  const { values } = parsed.value;
  const decision = text({ name: "decision", values });
  const decider = text({ name: "decider", values });
  const why = text({ name: "why", values });
  if (decision === undefined || decider === undefined || why === undefined) {
    return err(ProposalErrors.decisionFieldsRequired());
  }
  // A rejection IS a decision — same decider, same date, same reason — so it is an outcome on this one verb
  // rather than a second one whose fields would have to be kept in step with these.
  const outcome = stringFlagOr({ fallback: "approved", name: "outcome", parsed: parsed.value });
  if (!isRegisterDecisionOutcome(outcome)) {
    return err(ProposalErrors.decisionOutcomeUnknown({ outcome }));
  }
  const date = isoDate({ name: "date", values });
  if ("error" in date) {
    return err(date.error);
  }
  return ok({
    decidedIso: date.iso,
    decider,
    decision,
    home: text({ name: "home", values }),
    json: values["json"] === true,
    outcome,
    slug: head.slug,
    why,
  });
}

/**
 * Parse `proposal supersede <slug> --by <text> --why <text>`.
 *
 * @param rest the verb's arguments
 * @returns the parsed arguments, or the operator-facing errors
 */
export function parseProposalSupersedeArgs({ rest }: { rest: readonly string[] }): Parsed<ProposalSupersedeArgs> {
  const usage =
    "usage: slopweaver proposal supersede <slug> --by <slug-or-url> --why <text> [--date <iso>] [--json] " +
    "[--home <dir>]";
  const head = requireSlug({ rest, usage });
  if ("error" in head) {
    return err(head.error);
  }
  const parsed = parseFlags({ args: head.flags, spec: SUPERSEDE_FLAGS });
  if (parsed.isErr()) {
    return err(ProposalErrors.flagsInvalid({ reasons: parsed.error }));
  }
  const { values } = parsed.value;
  const by = text({ name: "by", values });
  const why = text({ name: "why", values });
  if (by === undefined || why === undefined) {
    return err(ProposalErrors.supersedeFieldsRequired());
  }
  const date = isoDate({ name: "date", values });
  if ("error" in date) {
    return err(date.error);
  }
  return ok({
    by,
    home: text({ name: "home", values }),
    json: values["json"] === true,
    occurredIso: date.iso,
    slug: head.slug,
    why,
  });
}

/**
 * Parse `proposal record-slack <slug> --permalink <url>`.
 *
 * @param rest the verb's arguments
 * @returns the parsed arguments, or the operator-facing errors
 */
export function parseProposalRecordSlackArgs({ rest }: { rest: readonly string[] }): Parsed<ProposalRecordSlackArgs> {
  const usage = "usage: slopweaver proposal record-slack <slug> --permalink <url> [--json] [--home <dir>]";
  const head = requireSlug({ rest, usage });
  if ("error" in head) {
    return err(head.error);
  }
  const parsed = parseFlags({ args: head.flags, spec: RECORD_SLACK_FLAGS });
  if (parsed.isErr()) {
    return err(ProposalErrors.flagsInvalid({ reasons: parsed.error }));
  }
  const { values } = parsed.value;
  const permalink = text({ name: "permalink", values });
  if (permalink === undefined) {
    return err(ProposalErrors.permalinkRequired());
  }
  return ok({ home: text({ name: "home", values }), json: values["json"] === true, permalink, slug: head.slug });
}

/**
 * Parse `proposal follow-up <slug> --ref <text> [--label <text>]`.
 *
 * @param rest the verb's arguments
 * @returns the parsed arguments, or the operator-facing errors
 */
export function parseProposalFollowUpArgs({ rest }: { rest: readonly string[] }): Parsed<ProposalFollowUpArgs> {
  const usage =
    "usage: slopweaver proposal follow-up <slug> --ref <handover-doc|linear-ticket|pr-url> [--label <text>] " +
    "[--date <iso>] [--json] [--home <dir>]";
  const head = requireSlug({ rest, usage });
  if ("error" in head) {
    return err(head.error);
  }
  const parsed = parseFlags({ args: head.flags, spec: FOLLOW_UP_FLAGS });
  if (parsed.isErr()) {
    return err(ProposalErrors.flagsInvalid({ reasons: parsed.error }));
  }
  const { values } = parsed.value;
  const ref = text({ name: "ref", values });
  if (ref === undefined) {
    return err(ProposalErrors.followUpRefRequired());
  }
  const date = isoDate({ name: "date", values });
  if ("error" in date) {
    return err(date.error);
  }
  return ok({
    home: text({ name: "home", values }),
    json: values["json"] === true,
    label: text({ name: "label", values }),
    occurredIso: date.iso,
    ref,
    slug: head.slug,
  });
}

/** A parsed `proposal audience` invocation. */
export interface ProposalAudienceArgs {
  readonly slug: string;
  readonly audience: string;
  readonly json: boolean;
  readonly home: string | undefined;
}

/**
 * Parse `proposal audience <slug> --audience <text>`.
 *
 * The `audience-set` event and the folded `audience` field have existed since the register shipped, and
 * `docs/proposals/feedback-identity-and-sync.md` told a reader to classify a synced entry's audience — while
 * no verb could write one. This is that missing writer rather than a new capability.
 *
 * @param rest the verb's arguments
 * @returns the parsed arguments, or the operator-facing errors
 */
export function parseProposalAudienceArgs({ rest }: { rest: readonly string[] }): Parsed<ProposalAudienceArgs> {
  const usage = "usage: slopweaver proposal audience <slug> --audience <text> [--json] [--home <dir>]";
  const head = requireSlug({ rest, usage });
  if ("error" in head) {
    return err(head.error);
  }
  const parsed = parseFlags({ args: head.flags, spec: AUDIENCE_FLAGS });
  if (parsed.isErr()) {
    return err(ProposalErrors.flagsInvalid({ reasons: parsed.error }));
  }
  const { values } = parsed.value;
  const audience = text({ name: "audience", values });
  if (audience === undefined || audience.trim().length === 0) {
    return err(ProposalErrors.audienceRequired());
  }
  return ok({
    audience: audience.trim(),
    home: text({ name: "home", values }),
    json: values["json"] === true,
    slug: head.slug,
  });
}
