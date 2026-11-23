/**
 * The owner's one-word reactions, by number — `"12 yes, 13 no 14-16 sort of; 17 let's talk"` — parsed against the candidates.
 *
 * Pure. The spoken or typed half of `workstreams react`; a console press names one id and one word and needs none of
 * this.
 */
import { err, ok, type Result } from "#lib/result.js";

import { type CandidatesError, CandidatesErrors } from "./candidateErrors.js";
import type { Candidate, Reaction } from "./candidates.js";

/**
 * Every spelling of a reaction the one-word path accepts, mapped to the word it means. Closed on purpose. `cancelled`
 * is a natural word for an abandoned one.
 */
const SPELLINGS: Readonly<Record<string, Reaction>> = {
  abandoned: "abandoned",
  canceled: "abandoned",
  cancelled: "abandoned",
  "let's talk": "lets-talk",
  "lets talk": "lets-talk",
  "lets-talk": "lets-talk",
  letstalk: "lets-talk",
  n: "no",
  no: "no",
  "not sure": "not-sure",
  "not-sure": "not-sure",
  notsure: "not-sure",
  "sort of": "sort-of",
  "sort-of": "sort-of",
  sortof: "sort-of",
  unsure: "not-sure",
  y: "yes",
  yes: "yes",
};

/** One candidate and the word the owner gave it. */
export interface ReactionPick {
  readonly candidate: string;
  readonly reaction: Reaction;
}

/** What the parse has gathered so far: the problems, the answered candidates, and the references awaiting a word. */
interface BatchState {
  readonly problems: string[];
  readonly picks: Map<string, Reaction>;
  pending: string[];
  /** A reference to an unknown number still takes the word after it, so that word is not reported a second time. */
  pendingUnknown: boolean;
}

/**
 * The owner's words as tokens: lowercased, curly apostrophes straightened, split on spaces, commas and semicolons, trailing
 * sentence punctuation dropped.
 *
 * @returns the tokens, in order
 */
function tokensOf({ text }: { text: string }): readonly string[] {
  return text
    .toLowerCase()
    .replaceAll("’", "'")
    .split(/[\s,;]+/)
    .map((token) => token.replace(/[.!?:]+$/, ""))
    .filter((token) => token.length > 0);
}

/**
 * The candidate ids one reference names: a number (`12`, with or without a leading hash), a range (`12-15`), or an id (`c-012`).
 *
 * @returns the ids, or `undefined` when the token is not a reference at all
 */
function refIds({
  token,
  byNumber,
  ids,
}: {
  token: string;
  byNumber: ReadonlyMap<number, string>;
  ids: ReadonlySet<string>;
}): { readonly found: readonly string[]; readonly unknown: readonly string[] } | undefined {
  if (ids.has(token)) {
    return { found: [token], unknown: [] };
  }
  const range = /^#?(\d+)(?:-(\d+))?$/.exec(token);
  if (range === null) {
    return undefined;
  }
  const from = Number(range[1]);
  const to = range[2] === undefined ? from : Number(range[2]);
  const found: string[] = [];
  const unknown: string[] = [];
  for (let n = Math.min(from, to); n <= Math.max(from, to); n += 1) {
    const id = byNumber.get(n);
    if (id === undefined) {
      unknown.push(String(n));
    } else {
      found.push(id);
    }
  }
  return { found, unknown };
}

/**
 * The reaction word starting at `index`, preferring a two-token spelling (`sort of`) over a one-token one.
 *
 * @returns the word it means (`undefined` when it is none), how the owner spelled it, and how many tokens it took
 */
function wordAt({ tokens, index }: { tokens: readonly string[]; index: number }): {
  readonly reaction: Reaction | undefined;
  readonly spelled: string;
  readonly width: number;
} {
  const token = tokens[index]!;
  const next = tokens[index + 1];
  if (next !== undefined) {
    const pair = `${token} ${next}`;
    const twoWord = SPELLINGS[pair];
    if (twoWord !== undefined) {
      return { reaction: twoWord, spelled: pair, width: 2 };
    }
  }
  return { reaction: SPELLINGS[token], spelled: token, width: 1 };
}

/**
 * Give every reference awaiting a word this one, and start a fresh group.
 *
 * @param spelled how the owner wrote the word, for a problem naming a word that answers nothing
 */
function answerPending({ state, reaction, spelled }: { state: BatchState; reaction: Reaction; spelled: string }): void {
  if (state.pending.length === 0 && !state.pendingUnknown) {
    state.problems.push(`"${spelled}" answers no candidate — put the number first`);
  }
  for (const candidate of state.pending) {
    const before = state.picks.get(candidate);
    if (before !== undefined && before !== reaction) {
      state.problems.push(`${candidate} is given both ${before} and ${reaction}`);
    }
    state.picks.set(candidate, reaction);
  }
  state.pending = [];
  state.pendingUnknown = false;
}

/**
 * Parse the owner's one-word reactions against the candidates.
 *
 * References accumulate until a reaction word, which answers all of them, so `"3 4 9 no"` is three noes. The whole
 * batch is refused, naming every problem, on an unknown number or word, a reference left without a word, or one
 * candidate given two different words: a partial write would leave the owner unsure which of their words landed.
 *
 * @param text what the owner said or typed
 * @param candidates the candidate set the numbers index
 * @returns each candidate and its word, in the order the owner gave them, or the refusal
 */
export function parseReactionBatch({
  text,
  candidates,
}: {
  text: string;
  candidates: readonly Candidate[];
}): Result<readonly ReactionPick[], CandidatesError> {
  const byNumber = new Map(candidates.map((one) => [one.n, one.id] as const));
  const ids = new Set(candidates.map((one) => one.id));
  const tokens = tokensOf({ text });
  const state: BatchState = { pending: [], pendingUnknown: false, picks: new Map(), problems: [] };
  let index = 0;
  while (index < tokens.length) {
    const ref = refIds({ byNumber, ids, token: tokens[index]! });
    if (ref !== undefined) {
      ref.unknown.forEach((n) => state.problems.push(`no candidate is numbered ${n}`));
      ref.found.forEach((id) => state.pending.push(id));
      state.pendingUnknown = state.pendingUnknown || ref.unknown.length > 0;
      index += 1;
      continue;
    }
    const word = wordAt({ index, tokens });
    if (word.reaction === undefined) {
      state.problems.push(
        `"${tokens[index]!}" is neither a candidate number nor one of yes, no, sort of, not sure, let's talk, abandoned`,
      );
      index += 1;
      continue;
    }
    answerPending({ reaction: word.reaction, spelled: word.spelled, state });
    index += word.width;
  }
  if (state.pending.length > 0) {
    const one = state.pending.length === 1;
    state.problems.push(`${state.pending.join(", ")} ${one ? "has" : "have"} no word after ${one ? "it" : "them"}`);
  }
  if (state.problems.length > 0) {
    return err(CandidatesErrors.reactionRefused({ problems: state.problems }));
  }
  if (state.picks.size === 0) {
    return err(CandidatesErrors.reactionRefused({ problems: ["no reaction was given"] }));
  }
  return ok([...state.picks].map(([candidate, reaction]) => ({ candidate, reaction })));
}
