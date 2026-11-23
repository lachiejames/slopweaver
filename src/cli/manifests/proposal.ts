/**
 * Lazy manifest for the `proposal` noun — the golden proposal as a typed form, and its own tracking register.
 *
 * Only ONE verb writes outside `$SLOPWEAVER_HOME`. `intake` seeds the questions a stakeholder
 * must answer first; `draft` renders the house markdown from a validated form; `lint` judges a drafted
 * document; `publish` lint-gates it and hands the bytes to the install's stored destination (`destination`
 * sets it; today `notion page`), also recording (or updating) this proposal's REGISTER entry; `teaser`
 * renders the Slack announce form and never posts it.
 *
 * `publish` declares `external-write` and `doorRouted` because it is the verb an operator invokes to put a
 * page in a workspace, even though the door record is written one layer down by `notion page` itself. There
 * is one Notion write path in this program and a proposal is one caller of it — a second one would have its
 * own ledger, its own ownership rules and its own way to be wrong.
 *
 * The register verbs are the sibling of that publish path: where a proposal is in its org discussion,
 * orthogonal to the drafting workflow `intake`'s own status tracks. None of them is `external-write` — `sync`
 * reads Notion but writes only a local register entry, the same `local-state` classification `refresh` already
 * carries for network ingestion that persists locally rather than mutating anything outside the machine.
 *
 * `drift` is the one register verb that reads the network and persists NOTHING, so it is `external-read`, and
 * the one that is `diagnostic`: a drifted proposal is the verb working, so it exits non-zero the way a
 * blocking `lint` finding does.
 */
import { DRAFT_USAGE, INTAKE_USAGE, LINT_USAGE, TEASER_USAGE } from "../commands/proposal/draftingUsage.js";
import { DESTINATION_USAGE, DRIFT_USAGE, PUBLISH_USAGE, SYNC_USAGE } from "../commands/proposal/publishUsage.js";
import { SETTABLE_STATUS_LIST } from "../commands/proposal/registerUsage.js";
import {
  ANSWER_FEEDBACK_USAGE,
  AUDIENCE_USAGE,
  DECIDE_USAGE,
  FEEDBACK_USAGE,
  FOLLOW_UP_USAGE,
  LIST_USAGE,
  RECORD_FEEDBACK_USAGE,
  SHOW_USAGE,
  STATUS_USAGE,
  SUPERSEDE_USAGE,
} from "../commands/proposal/registerVerbUsage.js";
import { lazy, type VerbManifestEntry } from "../manifest.js";

const RECORD_SLACK_USAGE =
  "usage: slopweaver proposal record-slack <slug> --permalink <url> [--json] [--home <dir>]\n" +
  "  Records a Slack announce permalink against a proposal. Manual, deliberately: `teaser` renders a form\n" +
  "  and never posts, and the owner posts it under their own name — nothing durable records that send.\n" +
  "  --permalink      the Slack message permalink";

export const proposalManifest: Readonly<Record<string, VerbManifestEntry>> = {
  "answer-feedback": lazy({
    load: () => import("../commands/proposal/registerRun.js").then((m) => m.proposalAnswerFeedbackCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example: 'slopweaver proposal answer-feedback an-intake --id f1 --how "reworked the rollout to be opt-in"',
      parseRejectIsIoFree: true,
      summary: "Close one recorded piece of feedback with what was done about it",
      usage: ANSWER_FEEDBACK_USAGE,
    },
  }),
  audience: lazy({
    load: () => import("../commands/proposal/registerRun.js").then((m) => m.proposalAudienceCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example: 'slopweaver proposal audience an-intake --audience "the engineering channel"',
      parseRejectIsIoFree: true,
      summary: "Record who a proposal is addressed to",
      usage: AUDIENCE_USAGE,
    },
  }),
  decide: lazy({
    load: () => import("../commands/proposal/registerRun.js").then((m) => m.proposalDecideCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example:
        'slopweaver proposal decide an-intake --decision "ship it" --decider "the owner" --why "team aligned in thread"',
      parseRejectIsIoFree: true,
      summary: "Record a proposal's decision, atomically setting its status to decided or rejected",
      usage: DECIDE_USAGE,
    },
  }),
  destination: lazy({
    load: () => import("../commands/proposal/destinationRun.js").then((m) => m.proposalDestinationCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      // Writes one file under $SLOPWEAVER_HOME and reaches no provider: the destination is exercised by
      // `publish`, through that destination's own door.
      effect: "local-state",
      example: "slopweaver proposal destination show",
      parseRejectIsIoFree: true,
      summary: "Set or show where this install publishes a proposal — the install's choice, held in the store",
      usage: DESTINATION_USAGE,
    },
  }),
  draft: lazy({
    load: () => import("../commands/proposal/run.js").then((m) => m.proposalDraftCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "none",
      example: "slopweaver proposal draft --form-example",
      parseRejectIsIoFree: true,
      summary: "Render the golden proposal markdown from a typed form — pure code, no model",
      usage: DRAFT_USAGE,
    },
  }),
  drift: lazy({
    load: () => import("../commands/proposal/driftRun.js").then((m) => m.proposalDriftCommand),
    meta: {
      createsWorkItem: false,
      // Finding drift is this verb WORKING, exactly as a blocking `lint` finding is — so its non-zero exit
      // reports a finding rather than signalling a broken tool.
      diagnostic: true,
      doorRouted: false,
      dryParseSafe: true,
      // Reads each destination's last edit and persists NOTHING — not even locally, which is what separates it
      // from `sync`.
      effect: "external-read",
      example: "slopweaver proposal drift",
      parseRejectIsIoFree: true,
      summary: "Every proposal whose destination does not yet say where it ended up — two timestamps, no model",
      usage: DRIFT_USAGE,
    },
  }),
  feedback: lazy({
    load: () => import("../commands/proposal/registerRun.js").then((m) => m.proposalFeedbackCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example: "slopweaver proposal feedback --unanswered",
      parseRejectIsIoFree: true,
      summary: "Every recorded piece of feedback, pushback first, filterable to the unanswered",
      usage: FEEDBACK_USAGE,
    },
  }),
  "follow-up": lazy({
    load: () => import("../commands/proposal/registerRun.js").then((m) => m.proposalFollowUpCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example: "slopweaver proposal follow-up an-intake --ref a-handover-doc-slug",
      parseRejectIsIoFree: true,
      summary: "Record a follow-up a proposal spawned — a handover doc, a Linear ticket, a pull request",
      usage: FOLLOW_UP_USAGE,
    },
  }),
  intake: lazy({
    load: () => import("../commands/proposal/intakeRun.js").then((m) => m.proposalIntakeCommand),
    meta: {
      createsWorkItem: false,
      // A fresh intake correctly has open questions, so its non-zero exit REPORTS that rather than failing.
      diagnostic: true,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example: 'slopweaver proposal intake --brief "an eval harness before we rework the ticket format"',
      parseRejectIsIoFree: true,
      summary: "Seed the questions a stakeholder answers before a proposal is drafted",
      usage: INTAKE_USAGE,
    },
  }),
  lint: lazy({
    load: () => import("../commands/proposal/run.js").then((m) => m.proposalLintCommand),
    meta: {
      createsWorkItem: false,
      // A blocking finding is the verb WORKING: it ran perfectly and found something, exactly like `doctor`
      // reporting an unhealthy environment. A thrown error would still be a real bug.
      diagnostic: true,
      doorRouted: false,
      dryParseSafe: true,
      effect: "none",
      example: "slopweaver proposal lint ./draft.md",
      parseRejectIsIoFree: true,
      summary: "Gate a drafted proposal on structure, citations and the operator's own voice rules",
      usage: LINT_USAGE,
    },
  }),
  list: lazy({
    load: () => import("../commands/proposal/registerRun.js").then((m) => m.proposalListCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example: "slopweaver proposal list --status implemented",
      parseRejectIsIoFree: true,
      summary: "Every tracked proposal, optionally filtered by status",
      usage: LIST_USAGE,
    },
  }),
  publish: lazy({
    load: () => import("../commands/proposal/publishRun.js").then((m) => m.proposalPublishCommand),
    meta: {
      createsWorkItem: true,
      diagnostic: false,
      doorRouted: true,
      dryParseSafe: true,
      effect: "external-write",
      example: "slopweaver proposal publish ./draft.md --intake <id> --dry-run",
      parseRejectIsIoFree: true,
      summary: "Lint-gated publish of a drafted proposal to this install's destination, through its own door",
      usage: PUBLISH_USAGE,
    },
  }),
  "record-feedback": lazy({
    load: () => import("../commands/proposal/registerRun.js").then((m) => m.proposalRecordFeedbackCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example:
        'slopweaver proposal record-feedback an-intake --kind pushback --who "a reviewer" --what "too broad" ' +
        "--where https://example.slack.com/archives/C1/p1",
      parseRejectIsIoFree: true,
      summary: "Record one thing somebody said about a proposal, and what kind of thing it was",
      usage: RECORD_FEEDBACK_USAGE,
    },
  }),
  "record-slack": lazy({
    load: () => import("../commands/proposal/registerRun.js").then((m) => m.proposalRecordSlackCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example: "slopweaver proposal record-slack an-intake --permalink https://example.slack.com/archives/C1/p1",
      parseRejectIsIoFree: true,
      summary: "Record a Slack announce permalink against a proposal — manual, since teaser never posts",
      usage: RECORD_SLACK_USAGE,
    },
  }),
  show: lazy({
    load: () => import("../commands/proposal/registerRun.js").then((m) => m.proposalShowCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example: "slopweaver proposal show an-intake",
      parseRejectIsIoFree: true,
      summary: "One proposal's full register entry",
      usage: SHOW_USAGE,
    },
  }),
  status: lazy({
    load: () => import("../commands/proposal/registerRun.js").then((m) => m.proposalStatusCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example: 'slopweaver proposal status an-intake shared --why "posted to #dev"',
      parseRejectIsIoFree: true,
      summary: `A non-terminal status change — ${SETTABLE_STATUS_LIST} — with its reason`,
      usage: STATUS_USAGE,
    },
  }),
  supersede: lazy({
    load: () => import("../commands/proposal/registerRun.js").then((m) => m.proposalSupersedeCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example: 'slopweaver proposal supersede an-old-intake --by a-newer-intake --why "corpus v2"',
      parseRejectIsIoFree: true,
      summary: "Record a supersession, atomically setting status to superseded",
      usage: SUPERSEDE_USAGE,
    },
  }),
  sync: lazy({
    load: () => import("../commands/proposal/syncRun.js").then((m) => m.proposalSyncCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      // Reads Notion but writes only under $SLOPWEAVER_HOME — the same `local-state` classification
      // `refresh` already carries for network ingestion that persists locally rather than mutating Notion.
      effect: "local-state",
      example: "slopweaver proposal sync --source 39100000-0000-8102-a2f7-d1d8ef1fe6b0",
      parseRejectIsIoFree: true,
      summary: "Discover child pages under a Notion source and register any not already tracked",
      usage: SYNC_USAGE,
    },
  }),
  teaser: lazy({
    load: () => import("../commands/proposal/publishRun.js").then((m) => m.proposalTeaserCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      // It RENDERS the Slack form and prints it. Posting under the owner's own name is their act, not this
      // verb's, so there is deliberately no send here to route through the door.
      effect: "none",
      example: "slopweaver proposal teaser --form - --intake <id>",
      parseRejectIsIoFree: true,
      summary: "Render the Slack announce form for a published proposal — it never posts",
      usage: TEASER_USAGE,
    },
  }),
};
