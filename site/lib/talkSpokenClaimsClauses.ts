/**
 * The clause readers that decide whether an act's past form is said as done, by whom, and whether it is recounted,
 * and the done and PR-number claims they yield. Split out of `./talkSpokenClaims.ts`.
 */

import { isNumberWord, spokenNumberOf } from "./spokenNumbers";
import { ARTIFACT_ACTS, ARTIFACT_NOUNS, type OutcomeAct, type SpokenClaim } from "./talkSpokenClaimsTypes";
import {
  actFormAt,
  BETWEEN_SUBJECT,
  HISTORY,
  isDeterminer,
  isOtherSubject,
  itemAt,
  NOT_DONE_BEFORE,
  OWNER_SUBJECTS,
  REPORTING,
  sentencesOf,
  TO_REACH,
  type Token,
} from "./talkSpokenClaimsWords";

/**
 * Whether an {@link ARTIFACT_ACTS} form at `at` is about a thing the console does: its clause names one of
 * {@link ARTIFACT_NOUNS}, and a "landed" is not "landed on", which picks an option.
 *
 * @param tokens the sentence's tokens
 * @param at the form's index among them
 * @param form the form as matched, so "landed on" is read past its own words
 * @returns true when the clause names an artifact
 */
function aboutAnArtifact({ tokens, at, form }: { tokens: readonly Token[]; at: number; form: string }): boolean {
  const after = itemAt({ at: at + form.split(" ").length, items: tokens });
  if (after?.lower === "on") {
    return false;
  }
  return tokens.slice(clauseStart({ at, tokens })).some((token) => ARTIFACT_NOUNS.has(token.lower));
}

/** Words that, after a comma, can join a clause of its own: "I can check the thread, and the draft was sent." */
const CLAUSE_AFTER_COMMA = new Set(["and", "so"]);

/** Words that open a clause's subject, so a joining word before one starts a new clause rather than a verb list. */
const SUBJECT_OPENERS = new Set([
  "i",
  "i've",
  "you",
  "you've",
  "she",
  "she's",
  "it",
  "it's",
  "we",
  "we've",
  "they",
  "they've",
  "there",
  "that",
  "that's",
  "this",
  "everything",
  "both",
  "all",
]);

/**
 * The masculine subject pronoun and its contraction, openers exactly as "she" and "she's" are. Kept as a pattern rather
 * than in {@link SUBJECT_OPENERS}: the owner-pronoun gate (`src/devLint/ownerPronouns.ts`) reads a regular-expression
 * literal as a recogniser of speech, never as prose about the owner.
 */
const PERSON_OPENER = /^he(?:'s)?$/u;

/**
 * Whether a word opens a clause's subject: a determiner, or one of {@link SUBJECT_OPENERS} or {@link PERSON_OPENER}.
 *
 * @param word one lowercase token
 * @returns true when a joining word before it starts a new clause
 */
function isSubjectOpener({ word }: { word: string }): boolean {
  return SUBJECT_OPENERS.has(word) || PERSON_OPENER.test(word) || isDeterminer({ word });
}

/**
 * Where the clause holding the token at `at` starts: after the last "but", or comma then "and" or "so", that a subject
 * follows. Without one the words share their modal: "will check sends, and remove messages sent" is a verb list, and
 * so is a bare "will be checked and sent".
 *
 * @param tokens the sentence's tokens
 * @param at the token's index among them
 * @returns the index of the clause's first token
 */
function clauseStart({ tokens, at }: { tokens: readonly Token[]; at: number }): number {
  for (let back = at - 1; back >= 0; back -= 1) {
    const join = tokens[back];
    const afterComma = itemAt({ at: back + 1, items: tokens });
    let subjectAt = -1;
    if (join.lower === "but") {
      subjectAt = back + 1;
    } else if (join.kind === "stop" && afterComma !== undefined && CLAUSE_AFTER_COMMA.has(afterComma.lower)) {
      subjectAt = back + 2;
    }
    const subject = itemAt({ at: subjectAt, items: tokens });
    if (subjectAt >= 0 && subjectAt < at && subject !== undefined && isSubjectOpener({ word: subject.lower })) {
      return subjectAt;
    }
  }
  return 0;
}

/**
 * Where the clause holding the token at `at` ends: just before the next token {@link clauseStart} places in a later
 * clause, else the sentence's end.
 *
 * @param tokens the sentence's tokens
 * @param at the token's index among them
 * @returns the index one past the clause's last token
 */
function clauseEnd({ tokens, at }: { tokens: readonly Token[]; at: number }): number {
  const start = clauseStart({ at, tokens });
  for (let next = at + 1; next < tokens.length; next += 1) {
    if (clauseStart({ at: next, tokens }) > start) {
      return clauseStart({ at: next, tokens });
    }
  }
  return tokens.length;
}

/**
 * Whether a past form at `at` is said as a thing that happened.
 *
 * @param tokens the sentence's tokens
 * @param at the past form's index among them
 * @returns false when anything before it in its clause makes it a proposal, a wait, a negation or an adjective
 */
function saidAsDone({ tokens, at }: { tokens: readonly Token[]; at: number }): boolean {
  const before = tokens.slice(clauseStart({ at, tokens }), at);
  if (before.some((token) => NOT_DONE_BEFORE.has(token.lower) || /n't$|'ll$/u.test(token.lower))) {
    return false;
  }
  if (before.slice(-TO_REACH).some((token) => token.lower === "to")) {
    return false;
  }
  const last = before.at(-1);
  return last === undefined || !isDeterminer({ word: last.lower });
}

/**
 * Whether the act at `at` is the owner's: its subject, reached back across "have" or "just", is "you".
 *
 * @param tokens the sentence's tokens
 * @param at the act's index among them
 * @returns true for "you sent", "you've already posted"
 */
function ownerAct({ tokens, at }: { tokens: readonly Token[]; at: number }): boolean {
  let back = at - 1;
  // Any "-ly" adverb sits there too: "you've definitely sent it". So does a wish of the owner's recapped, never a
  // proposal: "You wanted to post the ISO reply… Both messages are sent."
  const between = (word: string): boolean =>
    BETWEEN_SUBJECT.has(word) || word === "wanted" || word === "to" || (word.length > 4 && word.endsWith("ly"));
  while (back >= 0 && between(tokens[back].lower)) {
    back -= 1;
  }
  return back >= 0 && OWNER_SUBJECTS.has(tokens[back].lower);
}

/**
 * Whether a past form at `at` recounts something rather than claiming the console just did it: read off a record,
 * placed in history, or somebody else's act. MEASURED, replaying every call carrying a completed message
 * (the module header): these shapes were 5 of 13 done claims owed, each restating a true thing
 * ("GitHub just now says Theo's fix merged yesterday", "the card says Ada approved them last year"), and none of
 * the inventions — which matters once a claim owed is corrected aloud. Read in the act's own clause only:
 * "Yesterday it was still pending, but the message was sent just now" claims a send now. A bare "and" a subject
 * follows bounds it too: "The card says the queue is empty and the message was sent" claims the send.
 *
 * @param tokens the sentence's tokens
 * @param at the past form's index among them
 * @returns true when the act's clause recounts it
 */
function recountedAt({ tokens, at }: { tokens: readonly Token[]; at: number }): boolean {
  // A bound here needs no subject word after a comma's joining word ("…is empty, and draft two was sent"),
  // since the clause it cuts off only ever widens what is owed.
  const opensSubject = (index: number): boolean => {
    const next = itemAt({ at: index + 1, items: tokens });
    const before = itemAt({ at: index - 1, items: tokens });
    const afterComma = before?.kind === "stop" && CLAUSE_AFTER_COMMA.has(tokens[index].lower);
    const bareAnd = tokens[index].lower === "and" && next !== undefined && isSubjectOpener({ word: next.lower });
    return afterComma || bareAnd;
  };
  let start = clauseStart({ at, tokens });
  for (let index = at - 2; index >= start; index -= 1) {
    if (opensSubject(index)) {
      start = index + 1;
      break;
    }
  }
  let end = clauseEnd({ at, tokens });
  for (let index = at + 1; index < end; index += 1) {
    if (opensSubject(index)) {
      end = index;
      break;
    }
  }
  let back = at - 1;
  while (back >= start && BETWEEN_SUBJECT.has(tokens[back].lower)) {
    back -= 1;
  }
  return (
    tokens.slice(start, at).some((token) => REPORTING.has(token.lower)) ||
    tokens.slice(start, end).some((token) => HISTORY.has(token.lower)) ||
    (back >= start && isOtherSubject({ word: tokens[back].lower }))
  );
}

/**
 * Whether the act at `at` is a card sent back to the Queue, "send it back" or "sent back", which no send is.
 *
 * @param tokens the sentence's tokens
 * @param at the form's index among them
 * @param form the form as matched, so the words after it are read past its own
 * @returns true when "back" follows the form, directly or after one word
 */
function sentBack({ tokens, at, form }: { tokens: readonly Token[]; at: number; form: string }): boolean {
  const past = at + form.split(" ").length;
  return [past, past + 1].some((each) => itemAt({ at: each, items: tokens })?.lower === "back");
}

/** One act a sentence names, as done or as still to happen, and the sentence it stood in. */
interface ActMention {
  readonly act: OutcomeAct;
  readonly done: boolean;
  /** Said as done, but recounting it ({@link recountedAt}): never a claim of the voice's own. */
  readonly recounted: boolean;
  readonly start: number;
  readonly words: string;
}

/**
 * Every act a text names outside quotation marks, other than the owner's own and other than after a determiner ("your sent
 * folder", "the post"). A past form said as done is `done`. One still to happen is a past form that is not, or another
 * form in a question, opening a sentence ("Send it?", "Sending now."), as an attempt ("it's sending") or after a
 * negation, a modal or a "to" ("I'll send it"); a bare "checking merges" is a noun and no mention at all. A "landed" or
 * "went up" is a mention only about a thing the console does ({@link aboutAnArtifact}).
 *
 * @param byOwner the text is the owner's own words, where "you sent it" names the console's act, so no subject is left out
 * @returns the mentions, in order
 */
export function actMentionsOf({ text, byOwner }: { text: string; byOwner: boolean }): readonly ActMention[] {
  const mentions: ActMention[] = [];
  for (const { tokens, question, words } of sentencesOf({ text })) {
    tokens.forEach((token, at) => {
      const found = actFormAt({ at, tokens });
      const previous = itemAt({ at: at - 1, items: tokens });
      const modifier = previous !== undefined && isDeterminer({ word: previous.lower });
      if (found === undefined || modifier || (!byOwner && ownerAct({ at, tokens }))) {
        return;
      }
      const { act, form } = found;
      if ((ARTIFACT_ACTS.has(act) && !aboutAnArtifact({ at, form, tokens })) || sentBack({ at, form, tokens })) {
        return;
      }
      const asDone = !question && saidAsDone({ at, tokens });
      const done = form === act && asDone;
      const mentioned = form === act || question || at === 0 || token.lower.endsWith("ing") || !asDone;
      if (mentioned) {
        mentions.push({ act, done, recounted: done && recountedAt({ at, tokens }), start: token.start, words });
      }
    });
  }
  return mentions;
}

/**
 * The PR number said right after a PR marker at `at`, if one is.
 *
 * @param tokens the sentence's tokens
 * @param at the index of the first token after the marker
 * @returns the number, or `undefined`
 */
function prNumberAt({ tokens, at }: { tokens: readonly Token[]; at: number }): number | undefined {
  let from = at;
  if (tokens[from]?.lower === "number") {
    from += 1;
  }
  const first = itemAt({ at: from, items: tokens });
  if (first === undefined) {
    return undefined;
  }
  if (first.kind === "digits") {
    const value = Number(first.lower.replaceAll(/[#,]/gu, ""));
    return Number.isSafeInteger(value) && value > 0 ? value : undefined;
  }
  const words: string[] = [];
  for (const token of tokens.slice(from)) {
    if (token.kind !== "word" || !isNumberWord({ word: token.lower })) {
      break;
    }
    words.push(token.lower);
  }
  // "Eighteen thousand, four hundred and seventeen" goes on past its comma: half a number is no number.
  const after = tokens.slice(from + words.length, from + words.length + 2);
  const goesOn = after[0]?.kind === "stop" && after[1]?.kind === "word" && isNumberWord({ word: after[1].lower });
  if (words.length > 0 && goesOn) {
    return undefined;
  }
  while (words.at(-1) === "and") {
    words.pop();
  }
  const value = spokenNumberOf({ words });
  // A lone small number after "PR" is as likely the pronoun ("the PR one of them opened") as a number.
  return value !== undefined && value >= 10 && Number.isSafeInteger(value) ? value : undefined;
}

/**
 * Every PR number a text says after "PR", "PR number" or "pull request", outside quotation marks.
 *
 * @returns the claims, in order
 */
export function prNumberClaimsOf({ text }: { text: string }): readonly Extract<SpokenClaim, { kind: "pr-number" }>[] {
  const claims: Extract<SpokenClaim, { kind: "pr-number" }>[] = [];
  for (const { tokens, words } of sentencesOf({ text })) {
    tokens.forEach((token, at) => {
      const pullRequest = token.lower === "pull" && tokens[at + 1]?.lower === "request";
      if (token.lower !== "pr" && !pullRequest) {
        return;
      }
      const claimed = prNumberAt({ at: at + (pullRequest ? 2 : 1), tokens });
      if (claimed !== undefined) {
        claims.push({ claimed, kind: "pr-number", start: token.start, words });
      }
    });
  }
  return claims;
}

/**
 * Every done claim of the console's in one of the voice's sentences, outside quotation marks, never one it recounts.
 *
 * @returns the claims, in order
 */
export function outcomeClaimsOf({ text }: { text: string }): readonly Extract<SpokenClaim, { kind: "outcome" }>[] {
  return actMentionsOf({ byOwner: false, text })
    .filter((mention) => mention.done && !mention.recounted)
    .map(({ act, start, words }) => ({ act, kind: "outcome", start, words }));
}
