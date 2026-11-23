/**
 * The views the Workstreams page draws, split out of `./workstreamTiles.ts`, which reads the verb's document into them
 * and re-exports every one of them.
 */

/** One dated entry of a workstream's story, in story order. */
export interface EntryView {
  readonly id: string;
  readonly date: string;
  readonly href: string | null;
  readonly kind: string;
  readonly text: string;
  /** Which of the workstream's own milestones it moves, or `null` when it moves none. */
  readonly milestoneId: string | null;
  /** Whether it finishes `milestoneId`. */
  readonly done: boolean;
}

/** What a link the page draws as a chip points at: everything a workstream links but another workstream. */
export type LinkKind = "queue_card" | "alignment_card" | "automation" | "pull_request" | "linear_project";

/** One link a workstream keeps to something it owns or bears on, other than another workstream. */
export interface LinkView {
  readonly id: string;
  readonly kind: LinkKind;
  /** The canonical identity for its kind: a board slug, a recipe id, `owner/repo#N`, a Linear project UUID. */
  readonly target: string;
  /** Why it is linked, when the target alone does not say. */
  readonly label: string | null;
  /** Which of the workstream's own milestones it serves, or `null` when it serves the workstream as a whole. */
  readonly milestoneId: string | null;
}

/** Where one of a workstream's own milestones is, as the verb derived it from the entries tagging it. */
export type MilestoneState = "done" | "moving" | "ready" | "waiting";

/** One of a workstream's own milestones: a node of its dependency graph. */
export interface MilestoneNodeView {
  readonly id: string;
  readonly name: string;
  readonly anchor: string;
  readonly after: readonly string[];
  readonly state: MilestoneState;
  /** The longest chain of predecessors before it, so milestones that can run side by side share a column. */
  readonly column: number;
  readonly startedOn: string | null;
  readonly lastMovedOn: string | null;
  readonly doneOn: string | null;
  readonly href: string | null;
  readonly waitingFor: readonly string[];
}

/** A workstream's own milestones as a graph: its nodes in authored order, and how many columns they span. */
export interface MilestoneGraphView {
  readonly columns: number;
  readonly milestones: readonly MilestoneNodeView[];
}

/** One feedback line, with what the owner did about it. */
export interface FeedbackView {
  readonly date: string;
  readonly href: string | null;
  readonly response: string | null;
  readonly sign: "positive" | "negative";
  readonly text: string;
  readonly who: string;
}

/** A milestone as progress names it. */
export interface MilestoneRefView {
  readonly id: string;
  readonly name: string;
}

/** Where a workstream stands against its OWN milestones, as the verb counted it. */
export interface ProgressView {
  readonly doneCount: number;
  readonly totalCount: number;
  /** Whether its definition of done, the last milestone, is done. */
  readonly complete: boolean;
  /** Incomplete milestones whose every predecessor is done, in authored order. */
  readonly ready: readonly MilestoneRefView[];
  /** The first of `ready`, or `null` once complete. */
  readonly next: MilestoneRefView | null;
}

/** Which workspace a workstream states it belongs to, the console's context switcher's filter — a role, never a name. */
export type WorkstreamWorkspace = "team" | "self";

/** Where the owner put a workstream, and the steer that put it there. */
export interface PriorityView {
  readonly level: string;
  readonly because: string;
  readonly anchor: string;
  /** Where an `urgent` priority stands among the owner's others, 1 first; `undefined` when unranked. */
  readonly rank: number | undefined;
}

/** Whose move it is when a workstream is held: the owner's decision, or somebody named to chase. */
export type WaitingView =
  | { readonly on: "you"; readonly what: string }
  | { readonly on: "someone"; readonly what: string; readonly who: string };

/** One person involved: their Slack member id, which the roster turns into an identity chip, and their part. */
export interface InvolvedView {
  readonly slack: string;
  readonly part: string;
}

/** Another workstream this one bears on, by id, and why when the link says. */
export interface RelatedView {
  readonly id: string;
  readonly why: string | null;
  /** Which of this workstream's own milestones the relation serves, or `null` when it serves the whole. */
  readonly milestoneId: string | null;
}

/** How a workstream ended without its outcome: why, when, and where the owner said so. */
export interface EndingView {
  readonly kind: "abandoned";
  readonly reason: string;
  readonly on: string;
  readonly anchor: string;
}

/** What every workstream carries, whatever its kind: its identity, its lane, its story and its links. */
export interface PlacedFields {
  readonly id: string;
  readonly name: string;
  readonly workspace: WorkstreamWorkspace;
  /** One of the document's `lanes`, by id. */
  readonly lane: string;
  readonly atRisk: boolean;
  /** Its dated entries, in story order. */
  readonly entries: readonly EntryView[];
  /** Its links to queue cards, alignment cards, automations, pull requests and Linear projects. */
  readonly links: readonly LinkView[];
  /** Its links to other workstreams. */
  readonly related: readonly RelatedView[];
  /** The earliest dated entry's day, or `null` before the story has one. */
  readonly startedOn: string | null;
  /** The latest dated entry's day, or `null` before the story has one. */
  readonly lastMovedOn: string | null;
}

/** The fields every workstream someone drives toward an outcome shares, whoever leads it. */
export interface StoryFields extends PlacedFields {
  readonly initiative: string | null;
  readonly priority: PriorityView | null;
  /**
   * The board's `workstream=` tag value its Queue cards carry, `undefined` when the register names none — the join
   * an `urgent` workstream's Queue lift reads (`./queueFocus.ts`).
   */
  readonly queueWorkstream: string | undefined;
  readonly waitingOn: WaitingView | null;
  readonly outcome: string;
  readonly numbers: string;
  readonly skeptic: string | null;
  readonly tags: readonly string[];
  readonly feedback: readonly FeedbackView[];
  readonly people: readonly InvolvedView[];
  readonly milestoneGraph: MilestoneGraphView;
  readonly progress: ProgressView;
  /** The verb's one line for `progress`: `1 of 3 done, next: Pilot live`. */
  readonly progressLine: string;
  /** `null` while it is live; set when it ended without its outcome, which puts it in the abandoned lane. */
  readonly ending: EndingView | null;
}

/** An outcome tile, or standing upkeep outside the initiatives. */
export interface TileView extends StoryFields {
  readonly kind: "outcome" | "standing";
  readonly agreedBy: string;
  readonly status: string;
  readonly statusNote: string;
  readonly team: string;
}

/** A workstream somebody else leads, drawn as its own gauge. */
export interface LinkedView extends StoryFields {
  readonly kind: "linked";
  readonly leads: string;
  readonly yourPart: string;
  readonly gauge: {
    readonly asOf: string;
    readonly gate: number;
    readonly gateLabel: string;
    readonly of: number;
    readonly source: string;
    readonly value: number;
  };
  /** The gauge as shares of its whole, and how far short of the gate it is, as the verb derived it. */
  readonly reading: { readonly share: number; readonly gateShare: number; readonly short: number };
}

/** Kept on this page only: the means rather than an outcome, so no milestones. */
export interface LocalView extends PlacedFields {
  readonly kind: "local";
  readonly note: string;
}

/**
 * Finished or handed over, or wound down without its outcome when it carries an ending. A completion keeps its
 * evidence: the outcome it reached, its dated entries, who was involved, what it relates to and the day it closed.
 */
export interface ClosingView extends PlacedFields {
  readonly kind: "closing";
  readonly state: string;
  readonly holding: string;
  /** `null` when it finished or was handed over; set when it was abandoned, which puts it in that lane, not done. */
  readonly ending: EndingView | null;
  /** The outcome it reached, or `null` when none is recorded. */
  readonly outcome: string | null;
  /** The day it closed, or `null` when none is recorded. */
  readonly closedOn: string | null;
  readonly people: readonly InvolvedView[];
}

export type WorkstreamView = TileView | LinkedView | LocalView | ClosingView;

/** One lane a workstream can be in, and the rule that puts it there. */
export interface LaneView {
  readonly id: string;
  readonly label: string;
  readonly rule: string;
  readonly atRisk: boolean;
}

/** How the register groups its workstreams, and why. */
export interface GroupingView {
  readonly label: string;
  readonly why: string;
  readonly builtFrom: string;
  readonly anchor: string;
}

/** The whole page. */
export interface WorkstreamsView {
  /** The register document's grouping, or `null` while no register document is written. */
  readonly grouping: GroupingView | null;
  /** The initiatives outcomes sit under; none while no register document is written. */
  readonly initiatives: readonly { readonly id: string; readonly name: string }[];
  readonly lanes: readonly LaneView[];
  /** The owner's priority levels, most pressing first. */
  readonly priorities: readonly string[];
  /** Every workstream in the verb's order: at risk first, then by the owner's priority. */
  readonly workstreams: readonly WorkstreamView[];
  /** How many workstreams carried a kind this page does not draw. */
  readonly skipped: number;
  /**
   * Each Slack channel a citation points into, by conversation id, with its name — a citation says the name. None
   * while no register document is written.
   */
  readonly channels: ReadonlyMap<string, string>;
}
