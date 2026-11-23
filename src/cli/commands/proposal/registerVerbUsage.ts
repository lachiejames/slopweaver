/**
 * The usage text `slopweaver proposal`'s register verbs print, and nothing else: whole usage blocks, where
 * `./registerUsage.ts` holds only the value lists they quote. `record-slack`'s usage stays in the manifest.
 *
 * A LEAF on purpose, like `./registerUsage.ts`: `cli/manifests/proposal.ts` reads these strings on EVERY
 * invocation, so they live apart from the command modules that would drag the register's whole import graph onto
 * every unrelated verb's load path. Import only other leaves:
 * `src/__tests__/unit/cli/manifestBarrelClosure.test.ts` fails on anything else.
 */

import { ANSWER_OWING_FEEDBACK_KINDS } from "../../../outbound/proposal/register/events.js";
import { FEEDBACK_KIND_LIST, REGISTER_STATUS_LIST, SETTABLE_STATUS_LIST } from "./registerUsage.js";

/** The kinds that owe an answer, joined for the usage text — so help and code cannot disagree. */
const ANSWER_OWING_LIST = ANSWER_OWING_FEEDBACK_KINDS.join(" and ");

/** `proposal list --help`. */
export const LIST_USAGE =
  `usage: slopweaver proposal list [--status <${REGISTER_STATUS_LIST}>] [--json] [--home <dir>]\n` +
  "  Every tracked proposal, one per line: slug, status, title.\n" +
  "  --status         only proposals currently at this status; an unknown one is refused, never filtered to nothing";

/** `proposal show --help`. */
export const SHOW_USAGE =
  "usage: slopweaver proposal show <slug> [--history] [--json] [--home <dir>]\n" +
  "  One proposal's full register entry: page, status, decision, supersession, Slack links, follow-ups,\n" +
  "  feedback.\n" +
  "  --history        also print the journal in order — what happened, with the reason attached to each move";

/** `proposal status --help`. */
export const STATUS_USAGE =
  `usage: slopweaver proposal status <slug> <${SETTABLE_STATUS_LIST}> --why <text> [--date <iso>] [--json] ` +
  "[--home <dir>]\n" +
  "  A non-terminal status change, with its reason. `decided`, `rejected` and `superseded` are set only by\n" +
  "  `proposal decide`/`proposal supersede` — never here.\n" +
  "  --why            why the status changed now\n" +
  "  --date           when it actually changed, if that is not now — what `proposal drift` compares against";

/** `proposal decide --help`. */
export const DECIDE_USAGE =
  "usage: slopweaver proposal decide <slug> --decision <text> --decider <name> --why <text> " +
  "[--outcome approved|rejected] [--date <iso>] [--json] [--home <dir>]\n" +
  "  Records a decision atomically and sets status to `decided` or `rejected`. A rejection IS a decision —\n" +
  "  same decider, same date, same reason — so it is an outcome here rather than a separate verb.\n" +
  "  --decision       what was decided\n" +
  "  --decider        who decided it\n" +
  "  --outcome        approved (the default) or rejected\n" +
  "  --date           when it was decided (ISO 8601); defaults to now\n" +
  "  --why            why this decision is credible now";

/** `proposal supersede --help`. */
export const SUPERSEDE_USAGE =
  "usage: slopweaver proposal supersede <slug> --by <slug-or-url> --why <text> [--date <iso>] [--json] " +
  "[--home <dir>]\n" +
  "  Records a supersession atomically and sets status to `superseded`.\n" +
  "  --by             the slug or URL of what supersedes this proposal\n" +
  "  --why            why this proposal was superseded\n" +
  "  --date           when it was actually superseded, if that is not now";

/** `proposal follow-up --help`. */
export const FOLLOW_UP_USAGE =
  "usage: slopweaver proposal follow-up <slug> --ref <handover-doc|linear-ticket|pr-url> [--label <text>] " +
  "[--date <iso>] [--json] [--home <dir>]\n" +
  "  Records a follow-up this proposal spawned.\n" +
  "  --ref            the handover doc slug, Linear ticket, or pull request URL\n" +
  "  --label          a short human label for the follow-up\n" +
  "  --date           when it actually landed, if that is not now — what `proposal drift` compares against";

/** `proposal audience --help`. */
export const AUDIENCE_USAGE =
  "usage: slopweaver proposal audience <slug> --audience <text> [--json] [--home <dir>]\n" +
  "  Records who a proposal is addressed to.\n" +
  "  --audience       the audience, in plain words";

/** `proposal record-feedback --help`. */
export const RECORD_FEEDBACK_USAGE =
  `usage: slopweaver proposal record-feedback <slug> --kind <${FEEDBACK_KIND_LIST}> --who <name> --what <text> ` +
  "[--where <permalink>] [--date <iso>] [--json] [--home <dir>]\n" +
  "  Records one thing somebody said about a proposal. Manual, on purpose: nothing infers an objection from a\n" +
  "  Slack thread, because an inferred one is a guess wearing a fact's clothes.\n" +
  `  --kind           ${FEEDBACK_KIND_LIST}; only ${ANSWER_OWING_LIST} ever count as unanswered\n` +
  "  --who            who said it\n" +
  "  --what           what they said, in your words or theirs\n" +
  `  --where          the permalink it was said at; REQUIRED for ${ANSWER_OWING_LIST}\n` +
  "  --date           when they said it, if that is not now";

/** `proposal answer-feedback --help`. */
export const ANSWER_FEEDBACK_USAGE =
  "usage: slopweaver proposal answer-feedback <slug> --id <fN> --how <text> [--json] [--home <dir>]\n" +
  "  Closes one recorded piece of feedback with what was done about it. An unknown id is refused.\n" +
  "  --id             the feedback id `record-feedback` assigned, as `proposal show` prints it\n" +
  "  --how            what was done or said in reply";

/** `proposal feedback --help`. */
export const FEEDBACK_USAGE =
  `usage: slopweaver proposal feedback [--slug <s>] [--kind <${FEEDBACK_KIND_LIST}>] [--unanswered] [--json] ` +
  "[--home <dir>]\n" +
  "  Every recorded piece of feedback across every proposal, pushback first.\n" +
  "  --slug           only this proposal\n" +
  "  --kind           only this kind\n" +
  `  --unanswered     only ${ANSWER_OWING_LIST} with no answer recorded against them`;
