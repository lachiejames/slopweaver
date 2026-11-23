/**
 * The end-of-day Linear BRIEFING vocabulary: every write the owner should make into Linear today, each proposed as the
 * exact typed form an existing `slopweaver linear` verb already sends, so a yes on the briefing applies them with
 * no second composition step.
 *
 * Each day proposes every write the owner should be making: comments to leave, ranked by confidence (obvious
 * versus less obvious), a ticket that looks superseded, one that looks stale, a move back to backlog. The writes
 * happen only after the owner approves the briefing; with no approval, nothing happens in Linear. The aggregate
 * is a form so the page, the per-item forms and the commands that apply them are derived from one validated
 * source, never authored three times.
 *
 * Nothing here writes. Each proposal embeds a provider form whose own verb is the door
 * (`skills/automation/reference/linear-briefing.md`).
 */
import type { LinearCommentForm, LinearRelationForm } from "./commentTypes.js";
import type { LinearProjectUpdateForm } from "./projectUpdateTypes.js";
import type { LinearIssueForm } from "./types.js";

/**
 * Obvious (`high`) or less obvious (`low`) — the owner's own two-rung ranking, and the order the page reads in.
 *
 * @internal
 */
export type LinearBriefingConfidence = "high" | "low";

/**
 * Every source a briefing must say it read, or say why it could not.
 *
 * `linear-live` is the provider read every proposal is checked against; the rest are the local corpus sources
 * the evidence sweep walks since the floor. `calendar` is the meeting corpus — there is no source named `meeting`.
 */
export const LINEAR_BRIEFING_SOURCES = ["linear-live", "linear", "slack", "notion", "fathom", "calendar"] as const;

/**
 * One of {@link LINEAR_BRIEFING_SOURCES}.
 *
 * @internal
 */
export type LinearBriefingSource = (typeof LINEAR_BRIEFING_SOURCES)[number];

/** What one source's read covered, stated either way: a gap is named, never read as nothing to report. */
export interface LinearBriefingCoverage {
  readonly source: LinearBriefingSource;
  /** True only when the read was exhausted; false is a GAP the page shows above every proposal. */
  readonly read: boolean;
  /** What was read (or why it could not be), in one line. */
  readonly note: string;
}

/** One link the proposal stands on — a Slack thread, a call, a pull request, the ticket's own activity. */
export interface LinearBriefingEvidence {
  readonly label: string;
  readonly url: string;
}

/** The Linear object a proposal is about, as the page shows it. */
export interface LinearBriefingTarget {
  /** The issue key (`ENG-42`); absent for a project. */
  readonly identifier?: string | undefined;
  readonly title: string;
  readonly url: string;
  /** Its workflow state or project status as read live, for the pill. */
  readonly state?: string | undefined;
}

/** A fields-only issue update: the issue it lands on, the state it leaves and enters, and the form that does it. */
export interface LinearBriefingIssueMove {
  readonly issueId: string;
  readonly toState: string;
  readonly update: LinearIssueForm;
}

/**
 * A comment the owner would leave.
 *
 * @internal
 */
export interface LinearBriefingCommentWrite {
  readonly kind: "comment";
  readonly comment: LinearCommentForm;
}

/**
 * A state change on one issue, sent `--fields-only`.
 *
 * @internal
 */
export interface LinearBriefingStateChangeWrite extends LinearBriefingIssueMove {
  readonly kind: "state-change";
}

/**
 * Back to the backlog: the Backlog state, out of the cycle and unassigned, as ONE fields-only form.
 *
 * @internal
 */
export interface LinearBriefingBacklogWrite extends LinearBriefingIssueMove {
  readonly kind: "stale-to-backlog";
}

/**
 * Work another ticket replaced: a comment pointing at it, an optional edge, an optional close.
 *
 * @internal
 */
export interface LinearBriefingSupersededWrite {
  readonly kind: "superseded";
  readonly by: LinearBriefingTarget;
  readonly comment: LinearCommentForm;
  readonly relation?: LinearRelationForm | undefined;
  readonly close?: LinearBriefingIssueMove | undefined;
}

/**
 * A project status update.
 *
 * @internal
 */
export interface LinearBriefingProjectUpdateWrite {
  readonly kind: "project-update";
  readonly update: LinearProjectUpdateForm;
}

/** The write a proposal makes, chosen by `kind`. */
export type LinearBriefingWrite =
  | LinearBriefingBacklogWrite
  | LinearBriefingCommentWrite
  | LinearBriefingProjectUpdateWrite
  | LinearBriefingStateChangeWrite
  | LinearBriefingSupersededWrite;

/** One proposed write, ranked and sourced. */
export interface LinearBriefingProposal {
  /** Stable within the briefing, lower-case kebab: it names the item in the owner's answer and in every file. */
  readonly id: string;
  readonly confidence: LinearBriefingConfidence;
  /** Why Linear should change, naming the uncertainty rather than waiting it out. One line. */
  readonly why: string;
  readonly target: LinearBriefingTarget;
  readonly evidence: readonly LinearBriefingEvidence[];
  readonly write: LinearBriefingWrite;
}

/** One briefing: what it covered, from when, and every write it proposes. */
export interface LinearBriefingForm {
  /** The instant the briefing was composed — the next floor, once an apply-all of it lands. */
  readonly asOfIso: string;
  /** Where the evidence sweep started; null when no briefing was ever fully applied, so the whole corpus was read. */
  readonly evidenceSinceIso: string | null;
  /** The IANA zone the page states times in. */
  readonly zone: string;
  /** What the session would most likely have the owner pick, in one line — the page's marked lean. */
  readonly lean: string;
  readonly coverage: readonly LinearBriefingCoverage[];
  readonly proposals: readonly LinearBriefingProposal[];
}
