/**
 * The help-truth tables' rows for `proposal` — merged by `./allTables.ts` and swept by `../helpTruth.test.ts`,
 * whose header says what each table proves. Its PROBES rows are `../helpTruthProposalProbes.ts`'s table.
 */

import {
  PROPOSAL_DRAFT_FLAG_NAMES,
  PROPOSAL_LINT_FLAG_NAMES,
  parseProposalDraftArgs,
  parseProposalLintArgs,
} from "../../../../cli/commands/proposal/core.js";
import {
  PROPOSAL_DESTINATION_FLAG_NAMES,
  parseProposalDestinationArgs,
} from "../../../../cli/commands/proposal/destinationCore.js";
import { proposalErrorLines } from "../../../../cli/commands/proposal/errors.js";
import {
  PROPOSAL_INTAKE_FLAG_NAMES,
  PROPOSAL_PUBLISH_FLAG_NAMES,
  PROPOSAL_TEASER_FLAG_NAMES,
  parseProposalIntakeArgs,
  parseProposalPublishArgs,
  parseProposalTeaserArgs,
} from "../../../../cli/commands/proposal/publishCore.js";
import {
  PROPOSAL_AUDIENCE_FLAG_NAMES,
  PROPOSAL_DECIDE_FLAG_NAMES,
  PROPOSAL_FOLLOW_UP_FLAG_NAMES,
  PROPOSAL_RECORD_SLACK_FLAG_NAMES,
  PROPOSAL_STATUS_FLAG_NAMES,
  PROPOSAL_SUPERSEDE_FLAG_NAMES,
  parseProposalAudienceArgs,
  parseProposalDecideArgs,
  parseProposalFollowUpArgs,
  parseProposalRecordSlackArgs,
  parseProposalStatusArgs,
  parseProposalSupersedeArgs,
} from "../../../../cli/commands/proposal/registerCore.js";
import {
  PROPOSAL_ANSWER_FEEDBACK_FLAG_NAMES,
  PROPOSAL_FEEDBACK_FLAG_NAMES,
  PROPOSAL_RECORD_FEEDBACK_FLAG_NAMES,
  parseProposalAnswerFeedbackArgs,
  parseProposalFeedbackArgs,
  parseProposalRecordFeedbackArgs,
} from "../../../../cli/commands/proposal/registerCoreFeedback.js";
import {
  PROPOSAL_DRIFT_FLAG_NAMES,
  PROPOSAL_LIST_FLAG_NAMES,
  PROPOSAL_SHOW_FLAG_NAMES,
  parseProposalDriftArgs,
  parseProposalListArgs,
  parseProposalShowArgs,
} from "../../../../cli/commands/proposal/registerCoreRead.js";
import { PROPOSAL_SYNC_FLAG_NAMES, parseProposalSyncArgs } from "../../../../cli/commands/proposal/syncCore.js";
import { PROPOSAL_PROBES } from "../helpTruthProposalProbes.js";
import { type HelpTruthSlice } from "./mergeSlices.js";
import { dedupeFlags } from "./sharedProbes.js";

const guarded: NonNullable<HelpTruthSlice["guarded"]> = {
  "proposal answer-feedback": PROPOSAL_ANSWER_FEEDBACK_FLAG_NAMES,
  "proposal audience": PROPOSAL_AUDIENCE_FLAG_NAMES,
  "proposal decide": PROPOSAL_DECIDE_FLAG_NAMES,
  "proposal destination": PROPOSAL_DESTINATION_FLAG_NAMES,
  "proposal drift": PROPOSAL_DRIFT_FLAG_NAMES,
  "proposal feedback": PROPOSAL_FEEDBACK_FLAG_NAMES,
  "proposal draft": PROPOSAL_DRAFT_FLAG_NAMES,
  "proposal follow-up": PROPOSAL_FOLLOW_UP_FLAG_NAMES,
  "proposal intake": PROPOSAL_INTAKE_FLAG_NAMES,
  "proposal lint": PROPOSAL_LINT_FLAG_NAMES,
  "proposal list": PROPOSAL_LIST_FLAG_NAMES,
  "proposal publish": PROPOSAL_PUBLISH_FLAG_NAMES,
  "proposal record-feedback": PROPOSAL_RECORD_FEEDBACK_FLAG_NAMES,
  "proposal record-slack": PROPOSAL_RECORD_SLACK_FLAG_NAMES,
  "proposal show": PROPOSAL_SHOW_FLAG_NAMES,
  "proposal status": PROPOSAL_STATUS_FLAG_NAMES,
  "proposal supersede": PROPOSAL_SUPERSEDE_FLAG_NAMES,
  "proposal sync": PROPOSAL_SYNC_FLAG_NAMES,
  "proposal teaser": PROPOSAL_TEASER_FLAG_NAMES,
};

const parsers: NonNullable<HelpTruthSlice["parsers"]> = {
  "proposal answer-feedback": ({ fragment }) =>
    parseProposalAnswerFeedbackArgs({ rest: ["a-slug", ...fragment] }).mapErr((error) => proposalErrorLines({ error })),
  "proposal audience": ({ fragment }) =>
    parseProposalAudienceArgs({ rest: ["a-slug", ...fragment] }).mapErr((error) => proposalErrorLines({ error })),
  "proposal decide": ({ fragment }) =>
    parseProposalDecideArgs({ rest: ["a-slug", ...fragment] }).mapErr((error) => proposalErrorLines({ error })),
  "proposal drift": ({ fragment }) =>
    parseProposalDriftArgs({ rest: [...fragment] }).mapErr((error) => proposalErrorLines({ error })),
  "proposal feedback": ({ fragment }) =>
    parseProposalFeedbackArgs({ rest: [...fragment] }).mapErr((error) => proposalErrorLines({ error })),
  "proposal draft": ({ fragment }) =>
    parseProposalDraftArgs({ rest: ["--form", "-", ...fragment] }).mapErr((error) => proposalErrorLines({ error })),
  "proposal follow-up": ({ fragment }) =>
    parseProposalFollowUpArgs({ rest: ["a-slug", ...fragment] }).mapErr((error) => proposalErrorLines({ error })),
  "proposal intake": ({ fragment }) =>
    parseProposalIntakeArgs({ rest: ["--brief", "a brief", ...fragment] }).mapErr((error) =>
      proposalErrorLines({ error }),
    ),
  "proposal lint": ({ fragment }) =>
    parseProposalLintArgs({ rest: ["draft.md", ...fragment] }).mapErr((error) => proposalErrorLines({ error })),
  "proposal list": ({ fragment }) =>
    parseProposalListArgs({ rest: [...fragment] }).mapErr((error) => proposalErrorLines({ error })),
  "proposal publish": ({ fragment }) =>
    parseProposalPublishArgs({ rest: ["draft.md", ...fragment] }).mapErr((error) => proposalErrorLines({ error })),
  "proposal destination": ({ fragment }) =>
    parseProposalDestinationArgs({ rest: [...fragment] }).mapErr((error) => proposalErrorLines({ error })),
  "proposal record-feedback": ({ fragment }) =>
    parseProposalRecordFeedbackArgs({ rest: ["a-slug", ...fragment] }).mapErr((error) => proposalErrorLines({ error })),
  "proposal record-slack": ({ fragment }) =>
    parseProposalRecordSlackArgs({ rest: ["a-slug", ...fragment] }).mapErr((error) => proposalErrorLines({ error })),
  "proposal show": ({ fragment }) =>
    parseProposalShowArgs({ rest: ["a-slug", ...fragment] }).mapErr((error) => proposalErrorLines({ error })),
  "proposal status": ({ fragment }) =>
    parseProposalStatusArgs({ rest: ["a-slug", "shared", ...fragment] }).mapErr((error) =>
      proposalErrorLines({ error }),
    ),
  "proposal supersede": ({ fragment }) =>
    parseProposalSupersedeArgs({ rest: ["a-slug", ...fragment] }).mapErr((error) => proposalErrorLines({ error })),
  "proposal sync": ({ fragment }) =>
    parseProposalSyncArgs({ rest: [...fragment] }).mapErr((error) => proposalErrorLines({ error })),
  "proposal teaser": ({ fragment }) =>
    parseProposalTeaserArgs({
      rest: dedupeFlags({ base: ["--form", "-", "--page", "https://app.notion.com/p/a-1"], fragment }),
    }).mapErr((error) => proposalErrorLines({ error })),
};

/** The rows for `proposal`. */
export const proposalSlice: HelpTruthSlice = { guarded, probes: PROPOSAL_PROBES, parsers };
