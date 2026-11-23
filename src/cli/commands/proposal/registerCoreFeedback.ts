/**
 * Argument parsing for the proposal register's feedback verbs: the two mutations `record-feedback` and
 * `answer-feedback`, whose effectful shell is `./registerRunFeedbackWrite.ts`, and the read-only `feedback`,
 * whose shell is `./registerRunRead.ts`. The shared parsing helpers live in `./registerCore.ts`.
 */
import { err, ok } from "../../../lib/result.js";
import {
  ANSWER_OWING_FEEDBACK_KINDS,
  isRegisterFeedbackKind,
  type RegisterFeedbackKind,
} from "../../../outbound/proposal/register/events.js";
import { type FlagSpec, parseFlags } from "../../parseFlags.js";
import { ProposalErrors } from "./errors.js";
import { flagNames, isoDate, type Parsed, requireSlug, text } from "./registerCore.js";
import { FEEDBACK_KIND_LIST } from "./registerUsage.js";

const RECORD_FEEDBACK_FLAGS: FlagSpec = {
  boolean: ["json"],
  string: ["kind", "who", "what", "where", "date", "home"],
};
const ANSWER_FEEDBACK_FLAGS: FlagSpec = { boolean: ["json"], string: ["id", "how", "home"] };
const FEEDBACK_FLAGS: FlagSpec = { boolean: ["json", "unanswered"], string: ["slug", "kind", "home"] };

/** Every `proposal record-feedback` flag, WITH the `--`, for the help-truth ratchet. */
export const PROPOSAL_RECORD_FEEDBACK_FLAG_NAMES: readonly string[] = flagNames({ spec: RECORD_FEEDBACK_FLAGS });
/** Every `proposal answer-feedback` flag, WITH the `--`, for the help-truth ratchet. */
export const PROPOSAL_ANSWER_FEEDBACK_FLAG_NAMES: readonly string[] = flagNames({ spec: ANSWER_FEEDBACK_FLAGS });
/** Every `proposal feedback` flag, WITH the `--`, for the help-truth ratchet. */
export const PROPOSAL_FEEDBACK_FLAG_NAMES: readonly string[] = flagNames({ spec: FEEDBACK_FLAGS });

/** A parsed `proposal record-feedback` invocation. */
export interface ProposalRecordFeedbackArgs {
  readonly slug: string;
  readonly feedbackKind: RegisterFeedbackKind;
  readonly who: string;
  readonly what: string;
  readonly where: string | undefined;
  readonly occurredIso: string | undefined;
  readonly json: boolean;
  readonly home: string | undefined;
}

/** A parsed `proposal answer-feedback` invocation. */
export interface ProposalAnswerFeedbackArgs {
  readonly slug: string;
  readonly id: string;
  readonly how: string;
  readonly json: boolean;
  readonly home: string | undefined;
}

/** A parsed `proposal feedback` invocation — the read side, across every proposal unless narrowed. */
export interface ProposalFeedbackArgs {
  readonly slug: string | undefined;
  readonly feedbackKind: RegisterFeedbackKind | undefined;
  readonly unansweredOnly: boolean;
  readonly json: boolean;
  readonly home: string | undefined;
}

/**
 * Parse `proposal record-feedback <slug> --kind <k> --who <name> --what <text> [--where <url>]`.
 *
 * @param rest the verb's arguments
 * @returns the parsed arguments, or the operator-facing errors
 */
export function parseProposalRecordFeedbackArgs({
  rest,
}: {
  rest: readonly string[];
}): Parsed<ProposalRecordFeedbackArgs> {
  const usage =
    `usage: slopweaver proposal record-feedback <slug> --kind <${FEEDBACK_KIND_LIST}> --who <name> ` +
    "--what <text> [--where <permalink>] [--date <iso>] [--json] [--home <dir>]";
  const head = requireSlug({ rest, usage });
  if ("error" in head) {
    return err(head.error);
  }
  const parsed = parseFlags({ args: head.flags, spec: RECORD_FEEDBACK_FLAGS });
  if (parsed.isErr()) {
    return err(ProposalErrors.flagsInvalid({ reasons: parsed.error }));
  }
  const { values } = parsed.value;
  const kind = text({ name: "kind", values });
  const who = text({ name: "who", values });
  const what = text({ name: "what", values });
  if (kind === undefined || who === undefined || what === undefined) {
    return err(ProposalErrors.feedbackFieldsRequired({ usage }));
  }
  if (!isRegisterFeedbackKind(kind)) {
    return err(ProposalErrors.feedbackKindUnknown({ kind }));
  }
  const where = text({ name: "where", values });
  // Required for the kinds that OWE an answer, optional for the rest. Answering pushback means going back to
  // whoever raised it, and a recorded objection with nowhere to go back to is a debt with no address.
  if (where === undefined && ANSWER_OWING_FEEDBACK_KINDS.includes(kind)) {
    return err(ProposalErrors.feedbackLocationRequired({ kinds: ANSWER_OWING_FEEDBACK_KINDS }));
  }
  const date = isoDate({ name: "date", values });
  if ("error" in date) {
    return err(date.error);
  }
  return ok({
    feedbackKind: kind,
    home: text({ name: "home", values }),
    json: values["json"] === true,
    occurredIso: date.iso,
    slug: head.slug,
    what,
    where,
    who,
  });
}

/**
 * Parse `proposal answer-feedback <slug> --id <fN> --how <text>`.
 *
 * @param rest the verb's arguments
 * @returns the parsed arguments, or the operator-facing errors
 */
export function parseProposalAnswerFeedbackArgs({
  rest,
}: {
  rest: readonly string[];
}): Parsed<ProposalAnswerFeedbackArgs> {
  const usage = "usage: slopweaver proposal answer-feedback <slug> --id <fN> --how <text> [--json] [--home <dir>]";
  const head = requireSlug({ rest, usage });
  if ("error" in head) {
    return err(head.error);
  }
  const parsed = parseFlags({ args: head.flags, spec: ANSWER_FEEDBACK_FLAGS });
  if (parsed.isErr()) {
    return err(ProposalErrors.flagsInvalid({ reasons: parsed.error }));
  }
  const { values } = parsed.value;
  const id = text({ name: "id", values });
  const how = text({ name: "how", values });
  if (id === undefined || how === undefined) {
    return err(ProposalErrors.answerFieldsRequired({ usage }));
  }
  return ok({ home: text({ name: "home", values }), how, id, json: values["json"] === true, slug: head.slug });
}

/**
 * Parse `proposal feedback [--slug <s>] [--kind <k>] [--unanswered]`.
 *
 * @param rest the verb's arguments
 * @returns the parsed arguments, or the operator-facing errors
 */
export function parseProposalFeedbackArgs({ rest }: { rest: readonly string[] }): Parsed<ProposalFeedbackArgs> {
  const parsed = parseFlags({ args: rest, spec: FEEDBACK_FLAGS });
  if (parsed.isErr()) {
    return err(ProposalErrors.flagsInvalid({ reasons: parsed.error }));
  }
  const { values } = parsed.value;
  const kind = text({ name: "kind", values });
  if (kind !== undefined && !isRegisterFeedbackKind(kind)) {
    return err(ProposalErrors.feedbackKindUnknown({ kind }));
  }
  return ok({
    feedbackKind: kind,
    home: text({ name: "home", values }),
    json: values["json"] === true,
    slug: text({ name: "slug", values }),
    unansweredOnly: values["unanswered"] === true,
  });
}
