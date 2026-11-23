/**
 * One valid end-of-day Linear briefing carrying every write kind, shared by the schema, plan, page and verb
 * tests so each of them reads the same world.
 */
import type { LinearBriefingForm, LinearBriefingProposal } from "../../../../outbound/linear/briefingTypes.js";
import type { LinearIssueForm } from "../../../../outbound/linear/types.js";

/** A fields-only issue form, as `linear issue update --fields-only` takes one. */
function issueForm({ fields }: { fields: Partial<LinearIssueForm["fields"]> }): LinearIssueForm {
  return {
    artifact: {
      aiPrompt: [{ kind: "para", text: "**Goal.** Ship it." }],
      kind: "structured",
      problem: [{ kind: "para", text: "It is stale." }],
      solution: [{ kind: "para", text: "Move it." }],
    },
    fields: { teamId: "00000000-0000-4000-8000-000000000001", title: "The ticket", ...fields },
  };
}

/** Issue ids in the UUID v4 shape `linear issue update --issue-id` requires. */
const ENG_9_ID = "9e000000-0000-4000-8000-000000000009";
const ENG_3_ID = "3e000000-0000-4000-8000-000000000003";
const ENG_12_ID = "12e00000-0000-4000-8000-000000000012";

const EVIDENCE = [{ label: "the thread that settled it", url: "https://example.test/thread/1" }];

const COMMENT = {
  artifact: { evidence: EVIDENCE, summary: "Shipped in #42; closing once the canary holds." },
  fields: { issueId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301" },
};

/** A low-confidence comment, listed FIRST so ordering has something to move. */
export const LOW_COMMENT: LinearBriefingProposal = {
  confidence: "low",
  evidence: EVIDENCE,
  id: "eng-7-comment",
  target: {
    identifier: "ENG-7",
    state: "In Progress",
    title: "Ship the canary",
    url: "https://linear.app/x/issue/ENG-7",
  },
  why: "The canary may still be running; say so rather than wait.",
  write: { comment: COMMENT, kind: "comment" },
};

/** A high-confidence backlog move: all three of state, cycle and assignee. */
export const BACKLOG: LinearBriefingProposal = {
  confidence: "high",
  evidence: EVIDENCE,
  id: "eng-9-backlog",
  target: { identifier: "ENG-9", state: "Todo", title: "Old idea", url: "https://linear.app/x/issue/ENG-9" },
  why: "Untouched for six weeks and out of this cycle's goal.",
  write: {
    issueId: ENG_9_ID,
    kind: "stale-to-backlog",
    toState: "Backlog",
    update: issueForm({ fields: { assignee: null, cycleId: null, stateId: "state-backlog" } }),
  },
};

/** A high-confidence supersession with its comment, edge and close. */
const SUPERSEDED: LinearBriefingProposal = {
  confidence: "high",
  evidence: EVIDENCE,
  id: "eng-3-superseded",
  target: { identifier: "ENG-3", state: "Todo", title: "First attempt", url: "https://linear.app/x/issue/ENG-3" },
  why: "ENG-12 does the same work and is the one in flight.",
  write: {
    by: { identifier: "ENG-12", title: "Second attempt", url: "https://linear.app/x/issue/ENG-12" },
    close: { issueId: ENG_3_ID, toState: "Canceled", update: issueForm({ fields: { stateId: "state-canceled" } }) },
    comment: COMMENT,
    kind: "superseded",
    relation: { fields: { issueId: ENG_3_ID, relatedIssueId: ENG_12_ID, type: "duplicate" } },
  },
};

/** A low-confidence project update. */
const PROJECT_UPDATE: LinearBriefingProposal = {
  confidence: "low",
  evidence: EVIDENCE,
  id: "alpha-update",
  target: { state: "At risk", title: "Project Alpha", url: "https://linear.app/x/project/alpha" },
  why: "The backfill slipped a day; the date may still hold.",
  write: {
    kind: "project-update",
    update: {
      artifact: { summary: "Migration is at risk by one day." },
      fields: { health: "atRisk", projectId: "proj-alpha" },
    },
  },
};

/** Every source, read, bar the one named gap. */
export const COVERAGE: LinearBriefingForm["coverage"] = [
  { note: "every open issue in the owner's teams, live", read: true, source: "linear-live" },
  { note: "since the floor", read: true, source: "linear" },
  { note: "since the floor", read: true, source: "slack" },
  { note: "since the floor", read: true, source: "notion" },
  { note: "no recorded calls since the floor", read: true, source: "fathom" },
  { note: "the calendar corpus was not refreshed", read: false, source: "calendar" },
];

/** The whole briefing. */
export const BRIEFING: LinearBriefingForm = {
  asOfIso: "2026-10-26T06:30:00Z",
  coverage: COVERAGE,
  evidenceSinceIso: "2026-10-25T06:30:00Z",
  lean: "Apply the two obvious ones; hold the project update until the backfill lands.",
  proposals: [LOW_COMMENT, BACKLOG, SUPERSEDED, PROJECT_UPDATE],
  zone: "Australia/Melbourne",
};
