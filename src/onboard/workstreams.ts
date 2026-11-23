/**
 * Where onboarding's workstreams step stands: pull a source, mine what it holds, react to what the mine found, or
 * done — and whether the main screen has anything real on it yet.
 *
 * Onboarding ends on what the history says is important to the user, what is stalling and where they need to loop
 * in people. Two failures bound it: a gate that keeps someone in onboarding for hours, and a main screen with
 * nothing on it, which is where trust is lost. So the step answers one
 * question a session can act on — what next — and `reveal` says whether the console has something real to show.
 * One source alone is enough to give the user value, and a source
 * pulled since the last mine read it sends the step back to mining rather than leaving it unread.
 *
 * Mining itself is a visible session's pass (rule 2: no headless model), written through `workstreams candidates-put`;
 * `skills/onboard/reference/mining-workstreams.md` is its brief. Pure: the effectful half is
 * `src/cli/commands/onboard/workstreamsRun.ts`.
 */

/** The four places the step can stand, in the order onboarding walks them. */
const ONBOARD_WORKSTREAMS_STEPS = ["pull", "mine", "react", "answered"] as const;

/**
 * One of the four.
 *
 * @internal
 */
export type OnboardWorkstreamsStep = (typeof ONBOARD_WORKSTREAMS_STEPS)[number];

/**
 * One corpus source and how many bronze bytes it holds on this machine — a readdir and a stat per file, so the step
 * never loads a corpus to answer whether one is there.
 */
export interface SourceHeld {
  readonly source: string;
  readonly bytes: number;
}

/** What the last mine wrote, as `workstreams candidates` joins it. */
export interface MinedState {
  readonly candidates: number;
  readonly unanswered: number;
  /** Proposals of theirs no mine has read into a candidate yet. */
  readonly proposalOwed: number;
  readonly minedIso: string;
  /** The sources the mine says it read; empty for a mine that did not say. */
  readonly minedSources: readonly string[];
}

/** The verdict. */
export interface OnboardWorkstreamsState {
  readonly step: OnboardWorkstreamsStep;
  /** Whether the console's main screen has something real on it: at least one mined candidate. */
  readonly reveal: boolean;
  /** Sources holding records the last mine did not read. */
  readonly unread: readonly string[];
  /** One line saying what to do next, and why. */
  readonly next: string;
}

/** Where the person reacts. */
const CANDIDATES_PAGE = "/workstreams#candidates";

/**
 * The step a fresh install stands at, from what each source holds and what the last mine wrote.
 *
 * @param held each source and the bytes it holds; a source holding none is not counted as pulled
 * @param mined what the last mine wrote, or `null` when nothing has been mined yet
 * @returns the step, whether to reveal the main screen, the sources still unread and the next move
 */
export function onboardWorkstreamsState({
  held,
  mined,
}: {
  held: readonly SourceHeld[];
  mined: MinedState | null;
}): OnboardWorkstreamsState {
  const pulled = held.filter((one) => one.bytes > 0).map((one) => one.source);
  if (mined === null) {
    if (pulled.length === 0) {
      return {
        next: "pull one source first — Notion alone is enough to mine — then come back",
        reveal: false,
        step: "pull",
        unread: [],
      };
    }
    return {
      next: `mine ${pulled.join(", ")} into candidates, then write them with \`workstreams candidates-put\``,
      reveal: false,
      step: "mine",
      unread: pulled,
    };
  }
  const read = new Set(mined.minedSources);
  const unread = mined.minedSources.length === 0 ? [] : pulled.filter((source) => !read.has(source));
  const reveal = mined.candidates > 0;
  if (unread.length > 0 || mined.proposalOwed > 0) {
    const owed = [
      ...(unread.length > 0 ? [`${unread.join(", ")} pulled since the mine read it`] : []),
      ...(mined.proposalOwed > 0 ? [`${String(mined.proposalOwed)} proposal(s) of theirs unread`] : []),
    ];
    return { next: `mine again: ${owed.join("; ")}`, reveal, step: "mine", unread };
  }
  if (mined.unanswered > 0) {
    return {
      next: `${String(mined.unanswered)} candidate(s) wait on their word, on the console at ${CANDIDATES_PAGE}`,
      reveal,
      step: "react",
      unread,
    };
  }
  return { next: "every candidate has their word; nothing waits", reveal, step: "answered", unread };
}
