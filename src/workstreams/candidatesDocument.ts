/**
 * The candidates, the reactions, the definitions of done, the loop-in drafts and the register joined into the one
 * document `workstreams candidates --json` prints and the console's Proposed workstreams section reads — with what
 * the Workstreams seat owes named in it.
 *
 * Pure.
 */
import type { SlackDraftItem } from "../outbound/slack/draftRegister.js";

import type { CandidateCatalog, MinedProvenance } from "./candidateCatalog.js";
import { type OwedList, owedLists } from "./candidateOwed.js";
import { type Candidate, type CandidateLoopIn, type Reaction, type ReactionRow, STORY_OWED } from "./candidates.js";
import { type DefinitionRow, type DefinitionSelection, latestDefinitions } from "./definitions.js";
import { type LoopInDraftState, loopInDraftOf, loopInWhyOf } from "./loopIn.js";
import { heldAs } from "./promotion.js";
import { type ProposalRow, type ProposalView, proposalViews } from "./proposals.js";
import { type CandidateState, latestReactions, standingState } from "./reactionFold.js";
import { typedWorkstreamDetail } from "./store/decode.js";
import { isEmptyRegister } from "./store/register.js";
import type { WorkstreamAggregate, WorkstreamKind, WorkstreamRegisterSnapshot } from "./store/types.js";
import { latestTitles, type TitleRow } from "./titles.js";
import { latestWhoFirst, type WhoFirst, type WhoFirstRow } from "./whoFirst.js";

/**
 * One person a candidate says is owed a conversation, and the draft parked for it on the owner's Queue.
 *
 * @internal
 */
export type LoopInView = CandidateLoopIn & { readonly draftId: string | null; readonly draftState: LoopInDraftState };

/** One candidate as `workstreams candidates --json` prints it. */
export type CandidateView = Omit<Candidate, "loopIn"> &
  CandidateState & {
    readonly registerId: string | null;
    /** The title the owner gave it, or `null` while it carries its mined name. */
    readonly title: string | null;
    /** Who the owner says the first conversation is with and which team owns it, or `null` until they say. */
    readonly whoFirst: WhoFirst | null;
    /** What done means for it, as picked — `null` until one is. */
    readonly definition: { readonly iso: string; readonly selection: DefinitionSelection } | null;
    readonly loopIn: readonly LoopInView[];
  };

/**
 * One register entry, as a placing word may name it: its id, its name, and what kind of entry it is.
 *
 * @internal
 */
export interface RegisterEntryView {
  readonly id: string;
  readonly name: string;
  readonly kind: WorkstreamKind;
}

/** The document `workstreams candidates --json` prints and the console reads. */
export interface CandidatesDocument {
  readonly schemaVersion: 1;
  /**
   * Where the mined candidates came from — when, from what, and each source the mine read with how many records — or
   * `null` before any mining pass, when the candidates are the owner's stated outcomes alone. Each candidate's own evidence is
   * its provenance either way.
   */
  readonly mined: MinedProvenance | null;
  readonly counts: Readonly<Record<Reaction | "unanswered", number>>;
  readonly candidates: readonly CandidateView[];
  /** Whether the register holds anything yet; a fresh install holds nothing until the first accepted candidate. */
  readonly registerExists: boolean;
  /** Every register entry a same-as, milestone-of or covered-by word may name, shown beside the candidates. */
  readonly register: readonly RegisterEntryView[];
  /** The workstreams the owner proposed in their own words, each with the candidate a mine read it into. */
  readonly proposals: readonly ProposalView[];
  /** Proposals no mine has read into a candidate yet: the mining seat's work. */
  readonly proposalOwed: readonly string[];
  /** A same-as, milestone-of, outcome-of or covered-by word whose note is not on the workstream it names. */
  readonly placementOwed: readonly string[];
  /**
   * A yes or abandoned whose register entry is not there, or an abandoned whose entry carries no ending — never
   * written, or dropped by a later put.
   */
  readonly promotionOwed: readonly string[];
  /** Accepted candidates whose tile does not yet say their standing definition of done — a failed register write. */
  readonly definitionOwed: readonly string[];
  /** Register ids still carrying {@link STORY_OWED}: the seat's work. */
  readonly storyOwed: readonly string[];
  /** Candidates promoted by a yes the owner has since replaced with another word; the entry stays until the seat acts. */
  readonly retractions: readonly string[];
}

/**
 * Every word's count, and the unanswered one, at zero.
 *
 * @returns the counts to add to
 */
function zeroCounts(): Record<Reaction | "unanswered", number> {
  return {
    abandoned: 0,
    done: 0,
    "lets-talk": 0,
    "milestone-of": 0,
    no: 0,
    "not-sure": 0,
    "outcome-of": 0,
    "same-as": 0,
    "sort-of": 0,
    superseded: 0,
    unanswered: 0,
    yes: 0,
  };
}

/** The state of a candidate no word has been given on yet. */
const UNANSWERED: CandidateState = {
  coveredBy: null,
  heard: null,
  milestoneOf: null,
  outcomeOf: null,
  owner: null,
  promotedAs: null,
  reactedIso: null,
  reaction: null,
  reason: null,
  sameAs: null,
  steer: null,
  supersededBy: null,
  via: null,
};

/**
 * What a candidate's view carries whatever word it stands on: the candidate, its definition, loop-in drafts, register
 * id, title and who-first answer, each `null` while absent.
 *
 * @param held the register id the candidate is held under
 * @param standing its standing definition, if any
 * @returns the fields every view shares
 */
function sharedView({
  candidate,
  drafts,
  held,
  standing,
  title,
  who,
}: {
  candidate: Candidate;
  drafts: readonly SlackDraftItem[];
  held: string | undefined;
  standing: DefinitionRow | undefined;
  title: string | undefined;
  who: WhoFirst | undefined;
}): Omit<CandidateView, keyof CandidateState> {
  return {
    ...candidate,
    definition: standing === undefined ? null : { iso: standing.iso, selection: standing.selection },
    loopIn: loopInViews({ candidate, drafts }),
    // oxlint-disable-next-line prefer-nullish-coalescing -- no-silent-fallback bans `?? null`; unheld is by design
    registerId: held === undefined ? null : held,
    // oxlint-disable-next-line prefer-nullish-coalescing -- no-silent-fallback bans `?? null`; no title is by design
    title: title === undefined ? null : title,
    // oxlint-disable-next-line prefer-nullish-coalescing -- no-silent-fallback bans `?? null`; unasked is by design
    whoFirst: who === undefined ? null : who,
  };
}

/**
 * Each person a candidate says is owed a conversation, with the draft parked for them.
 *
 * @param drafts the draft register, folded
 * @returns the people, each with a draft id and state
 */
function loopInViews({
  candidate,
  drafts,
}: {
  candidate: Candidate;
  drafts: readonly SlackDraftItem[];
}): readonly LoopInView[] {
  return candidate.loopIn.map((one) => {
    const why = loopInWhyOf({
      candidateId: candidate.id,
      candidateName: candidate.name,
      name: one.name,
      person: one.slack,
    });
    const standing = loopInDraftOf({ items: drafts, why });
    return { ...one, draftId: standing.draftId, draftState: standing.state };
  });
}

/**
 * Join the candidates, the owner's reactions, the definitions, the loop-in drafts and the register into one document.
 *
 * @param catalog every candidate the owner can answer, stated then mined (`./candidateCatalog.ts`)
 * @param rows every reaction row, in file order
 * @param definitions every definition row, in file order
 * @param titles every title row, in file order
 * @param proposals every proposal row, in file order
 * @param whoFirst every who-first row, in file order
 * @param drafts the Slack draft register, folded — where each loop-in conversation stands
 * @param register the register as it stands; empty before the first accepted candidate
 * @returns the document
 */
export function candidatesDocument({
  catalog,
  rows,
  definitions,
  titles,
  proposals,
  whoFirst,
  drafts,
  register,
}: {
  catalog: CandidateCatalog;
  rows: readonly ReactionRow[];
  definitions: readonly DefinitionRow[];
  titles: readonly TitleRow[];
  proposals: readonly ProposalRow[];
  whoFirst: readonly WhoFirstRow[];
  drafts: readonly SlackDraftItem[];
  register: WorkstreamRegisterSnapshot;
}): CandidatesDocument {
  const { workstreams } = register;
  const joined = joinCandidates({
    candidates: catalog.candidates,
    definitions,
    drafts,
    rows,
    titles,
    whoFirst,
    workstreams,
  });
  const proposed = proposalViews({ catalog, rows: proposals });
  const storyOwed = workstreams.flatMap((one) => {
    const typed = typedWorkstreamDetail({ aggregate: one });
    const owes = (typed.kind === "standing" || typed.kind === "outcome") && typed.detail.agreedBy === STORY_OWED;
    return owes ? [one.id] : [];
  });
  return {
    ...joined,
    mined: catalog.mined,
    proposalOwed: proposed.flatMap((one) => (one.minedAs === null ? [one.id] : [])),
    proposals: proposed,
    register: workstreams.map((one) => ({ id: one.id, kind: one.kind, name: one.name })),
    registerExists: !isEmptyRegister({ snapshot: register }),
    schemaVersion: 1,
    storyOwed,
  };
}

/**
 * Each candidate joined with its standing word, definition, title, who-first answer and drafts, counted, and filed on
 * every list of what the seat owes it belongs on.
 *
 * @param workstreams the register's workstreams, empty before the first accepted candidate
 * @returns the candidates, the counts and the owed lists
 */
function joinCandidates({
  candidates: offered,
  rows,
  definitions,
  titles,
  whoFirst,
  drafts,
  workstreams,
}: {
  candidates: readonly Candidate[];
  rows: readonly ReactionRow[];
  definitions: readonly DefinitionRow[];
  titles: readonly TitleRow[];
  whoFirst: readonly WhoFirstRow[];
  drafts: readonly SlackDraftItem[];
  workstreams: readonly WorkstreamAggregate[];
}): Pick<CandidatesDocument, "candidates" | "counts" | OwedList> {
  const states = latestReactions({ rows });
  const defined = latestDefinitions({ rows: definitions });
  const titled = latestTitles({ rows: titles });
  const answeredWho = latestWhoFirst({ rows: whoFirst });
  const counts = zeroCounts();
  const owed: Record<OwedList, string[]> = {
    definitionOwed: [],
    placementOwed: [],
    promotionOwed: [],
    retractions: [],
  };
  const candidates = offered.map((candidate): CandidateView => {
    const state = states.get(candidate.id);
    const held = heldAs({
      candidate,
      state: standingState({ candidateId: candidate.id, held: rows, states }),
      workstreams,
    });
    const standing = defined.get(candidate.id);
    const shared = sharedView({
      candidate,
      drafts,
      held,
      standing,
      title: titled.get(candidate.id),
      who: answeredWho.get(candidate.id),
    });
    if (state === undefined) {
      counts.unanswered += 1;
      return { ...shared, ...UNANSWERED };
    }
    if (state.reaction !== null) {
      counts[state.reaction] += 1;
    }
    for (const list of owedLists({ candidate, held, standing, state, workstreams })) {
      owed[list].push(candidate.id);
    }
    return { ...shared, ...state };
  });
  return { ...owed, candidates, counts };
}
