/**
 * The words and shapes of the Proposed workstreams section: every word the owner can have on a candidate, the labels
 * the page draws them with, and the view each part of `slopweaver workstreams candidates --json` narrows into. Split
 * out of `./workstreamCandidates.ts`, which reads the document into them.
 */

/** Every word the owner can have on a candidate — the verb's `REACTIONS`, restated because `src/` is out of reach. */
export const CANDIDATE_REACTIONS = [
  "yes",
  "no",
  "sort-of",
  "not-sure",
  "lets-talk",
  "done",
  "same-as",
  "milestone-of",
  "outcome-of",
  "superseded",
  "abandoned",
] as const;

/** One of the owner's words. */
export type CandidateReaction = (typeof CANDIDATE_REACTIONS)[number];

/**
 * The words a single press records, in order. The rest each need something a press cannot carry — a register entry
 * to name, what replaced it, the owner's reason and where they said it — so each has its own control on the open candidate.
 */
export const PRESS_REACTIONS = [
  "yes",
  "no",
  "sort-of",
  "not-sure",
  "lets-talk",
  "done",
] as const satisfies readonly CandidateReaction[];

/**
 * The words the console voice relays: those that stand alone, the mirror of `STANDALONE_REACTIONS`
 * (`src/workstreams/candidates.ts`). same-as, milestone-of, outcome-of and superseded name a target a relay cannot
 * carry.
 */
export const SPOKEN_REACTIONS = [
  "yes",
  "no",
  "sort-of",
  "not-sure",
  "lets-talk",
  "done",
  "abandoned",
] as const satisfies readonly CandidateReaction[];

/** One word a single press records. */
export type PressReaction = (typeof PRESS_REACTIONS)[number];

/** How each word reads in the summary line and on an answered candidate. */
export const REACTION_LABEL: Readonly<Record<CandidateReaction, string>> = {
  abandoned: "abandoned",
  done: "already done",
  "lets-talk": "let's talk",
  "milestone-of": "milestone of",
  no: "not mine",
  "not-sure": "not sure",
  "outcome-of": "outcome of",
  "same-as": "same as",
  "sort-of": "sort of",
  superseded: "superseded",
  yes: "accepted",
};

/**
 * How each pressable word reads on its button. The section asks one question — accept this as a workstream, done
 * meaning what you picked — so the yes button says that rather than "yes".
 */
export const PRESS_LABEL: Readonly<Record<PressReaction, string>> = {
  done: "Already done",
  "lets-talk": "Let's talk",
  no: "Not mine",
  "not-sure": "Not sure",
  "sort-of": "Sort of",
  yes: "Accept as a workstream",
};

/** The live slug the section reads, and every act row's `readsSlug`. */
export const CANDIDATES_SLUG = "workstream-candidates";

/**
 * How many unanswered candidates the section opens on: the three highest priorities as inferred from everything the
 * mine could see, because a wall of seventy is never read. The rest sit behind one link as one ranked list, never
 * drawn until the owner asks.
 */
export const OPENING_FEW = 3;

/** One cited line in the person's own words: a link, or the anchor that names where it was said. */
export interface CandidateEvidenceView {
  readonly date: string;
  readonly href: string | null;
  readonly anchor: string | null;
  readonly quote: string;
}

/** The ways a definition of done is judged — the verb's `DONE_LENSES`, restated. */
export const DONE_LENSES = ["result", "people", "adoption"] as const;

/** One lens. */
export type DoneLens = (typeof DONE_LENSES)[number];

/** One offered definition of done, what choosing it costs, and the rung beyond it when there is one. */
export interface DoneOptionView {
  readonly id: string;
  readonly lens: DoneLens;
  readonly text: string;
  readonly tradeoff: string;
  readonly stretch: string | null;
}

/** How each lens reads beside an option: what that definition of done is judged by. */
export const LENS_LABEL: Readonly<Record<DoneLens, string>> = {
  adoption: "adoption by teammates",
  people: "people across it and owning it",
  result: "the result",
};

/** Where a loop-in draft stands on the Queue — the verb's `LoopInDraftState`, restated. */
export const LOOP_IN_STATES = ["none", "held", "released"] as const;

/** One person the candidate says is owed a conversation, and where the draft for it stands. */
export interface LoopInPersonView {
  readonly name: string;
  readonly slack: string;
  readonly why: string;
  readonly opener: string;
  readonly draftId: string | null;
  readonly draftState: (typeof LOOP_IN_STATES)[number];
}

/** One offered option as a definition snapshotted it. */
export interface PickedOptionView {
  readonly optionId: string;
  readonly lens: DoneLens;
  readonly text: string;
  readonly tradeoff: string;
  readonly stretch: string | null;
}

/** What was picked as done: an offered option, their own words with an optional stretch, or all of the options. */
export type DefinitionView =
  | ({ readonly kind: "option" } & PickedOptionView)
  | { readonly kind: "words"; readonly text: string; readonly stretch: string | null }
  | {
      readonly kind: "all";
      readonly text: string;
      /** The option the owner said leads, or `null` while the page still owes them that question. */
      readonly first: string | null;
      readonly options: readonly PickedOptionView[];
    };

/** A steer the owner gave before this mine, dated, which the tile shows and an accept may be tied to. */
export interface PriorSteerView {
  readonly anchor: string;
  readonly date: string;
  readonly text: string;
}

/** The word standing on a candidate and what it names: the register entry, what replaced it, whose it is. */
export interface CandidateWordView {
  /** The owner's standing word, or `null` while they have not answered. */
  readonly reaction: CandidateReaction | null;
  readonly sameAs: string | null;
  readonly milestoneOf: string | null;
  readonly outcomeOf: string | null;
  readonly supersededBy: string | null;
  readonly owner: string | null;
  readonly coveredBy: string | null;
  readonly steer: string | null;
  readonly reason: string | null;
  /** The owner's own words as heard when they gave the word — the voice keeps them on the row — or `null` for a press. */
  readonly heard: string | null;
  /** When the owner's standing word was recorded, or `null` while they have not answered. */
  readonly reactedIso: string | null;
}

/** One mined candidate and where it stands. */
export interface CandidateRowView extends CandidateWordView {
  readonly id: string;
  readonly n: number;
  readonly name: string;
  /** The title the owner gave it, or `null` while it carries its mined name. */
  readonly title: string | null;
  readonly outcome: string;
  readonly theme: string;
  readonly first: string;
  readonly last: string;
  readonly evidenceCount: number;
  readonly people: readonly string[];
  readonly evidence: readonly CandidateEvidenceView[];
  /** Two or three definitions of done to react to, or none from an older mine. */
  readonly doneOptions: readonly DoneOptionView[];
  /** What looks stalled, and since when, or `null`. */
  readonly stalled: { readonly since: string; readonly what: string } | null;
  readonly loopIn: readonly LoopInPersonView[];
  readonly priorSteers: readonly PriorSteerView[];
  /** The team the mine says owns it, apart from who the first conversation is with. */
  readonly owningTeam: { readonly name: string; readonly why: string } | null;
  /** Who the owner says the first conversation is with and which team owns it, or `null` until they say. */
  readonly whoFirst: { readonly people: readonly string[]; readonly team: string | null } | null;
  /** The proposal of the owner's this candidate was mined from, or `null`. */
  readonly proposal: string | null;
  /** The definition of done picked, or `null` until one is. */
  readonly definition: DefinitionView | null;
  /** The register id this candidate is held under, or `null`. */
  readonly registerId: string | null;
}

/** One register entry a placing word may name. */
export interface RegisterEntryView {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
}

/** How a proposal stands to the candidate it was said beside — the verb's `PROPOSAL_RELATIONS`, restated. */
export const PROPOSAL_RELATIONS = ["split", "instead", "sibling", "own"] as const;

/** One proposal relation. */
export type ProposalRelation = (typeof PROPOSAL_RELATIONS)[number];

/** A workstream the owner proposed in their own words, and the candidate a mine read it into. */
export interface ProposalView {
  readonly id: string;
  readonly title: string;
  readonly relation: ProposalRelation;
  readonly from: string | null;
  readonly why: string | null;
  readonly minedAs: string | null;
}

/** Where the mined candidates came from: when, from what, and each source the mine read. */
export interface MinedView {
  readonly minedIso: string;
  readonly minedFrom: string;
  /** Each source the mine read and how many records, as the mine said; empty when it did not. */
  readonly minedSources: readonly { readonly source: string; readonly recordsRead: number }[];
}

/** The whole section. */
export interface CandidatesView {
  /** The last mine's provenance, or `null` before any mine — the candidates are then the owner's stated outcomes alone. */
  readonly mined: MinedView | null;
  readonly counts: Readonly<Record<CandidateReaction | "unanswered", number>>;
  readonly candidates: readonly CandidateRowView[];
  readonly registerExists: boolean;
  readonly register: readonly RegisterEntryView[];
  readonly proposals: readonly ProposalView[];
  readonly proposalOwed: readonly string[];
  readonly placementOwed: readonly string[];
  readonly promotionOwed: readonly string[];
  readonly definitionOwed: readonly string[];
  readonly storyOwed: readonly string[];
  readonly retractions: readonly string[];
}
