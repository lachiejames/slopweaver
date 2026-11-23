/**
 * The CONCRETE EXAMPLES an ask carries — one to three second-person scenes the owner can picture, each ending in the
 * question the card is really asking — or the one line saying why its row cannot support a truthful one.
 *
 * ## Why this exists
 *
 * A concrete example is effective because the owner can picture it happening: imagine you are at the computer,
 * busy, and a notification pops up saying this; would you have wanted that to happen? An option list such as "A,
 * this was the right call, B, this was not" leaves the owner reconstructing what the problem was, why it was one,
 * why it was solved, how, and whether that is aligned with them, so a card opened is all questions and no
 * answers. So every open ask carries the scene, and the five answers ride in it rather than being left for the
 * owner to rebuild.
 *
 * Related asks fold onto ONE card as numbered examples, each given a reaction, so the owner is never presented
 * with multiple choice. Hence up to {@link MAX_ASK_EXAMPLES}.
 *
 * ## Enforced by the SCHEMA (`AGENTS.md` rule 7)
 *
 * {@link askExampleProblems} is what every verb that records an ask calls, and a violation is REFUSED rather than
 * trimmed. What it checks is the shape a scene has to have to be one, and nothing about its content: a word
 * addressed to the owner, a scene of at least {@link SCENE_MIN_WORDS} words, the question at its end, and the length cap
 * `../briefing/caps.ts` derives. A GAP is the honest
 * alternative for a row whose own record cannot support a truthful scene — never an invented one.
 *
 * Pure: no filesystem, no clock.
 */

import { ASK_EXAMPLE_MAX_WORDS, MAX_ASK_EXAMPLES, SHORT_FIELD_MAX_WORDS } from "../briefing/caps.js";
import { splitSentences, wordCount } from "../briefing/text.js";

/** What an ask carries in place of a bare question: its scenes, or why it has none. */
export type AskExampleSet =
  | {
      readonly kind: "examples";
      /** One to three scenes, in the order the card numbers them. */
      readonly examples: readonly string[];
    }
  | {
      readonly kind: "gap";
      /** One sentence saying why the row's own record cannot support a truthful scene. */
      readonly gap: string;
    };

/**
 * The fewest words a scene ahead of its question may run: who, the act, and what the owner sees — "You open the PR and see
 * it" is six. A FLOOR on shape, not a judge of content: a scene of any length can still be abstract, and that half is
 * the author's.
 */
const SCENE_MIN_WORDS = 6;

/**
 * Every Unicode line terminator, not only CR and LF — a gap broken by a line or paragraph separator is still two
 * lines on the card. Spelled by property class so the source carries no raw separator.
 */
const LINE_BREAK = /[\n\v\f\r\x85\p{Zl}\p{Zp}]/u;

/** A word addressed to the owner — what makes a scene one they are placed in rather than one they are told about. */
const SECOND_PERSON = /\b(?:you|your|yours|yourself)\b/iu;

/**
 * Every way one scene breaks the shape, empty when it is one.
 *
 * @param label how a refusal names it — `example 2`
 * @param text the scene as typed
 * @returns one sentence per rule broken
 */
function exampleProblems({ label, text }: { label: string; text: string }): readonly string[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return [`${label} is empty`];
  }
  const problems: string[] = [];
  if (!SECOND_PERSON.test(trimmed)) {
    problems.push(
      `${label} never addresses the owner — a concrete example puts the owner in the scene ("you're busy doing this, and a ` +
        'notification pops up saying this…"), it does not describe one from outside',
    );
  }
  if (!trimmed.endsWith("?")) {
    problems.push(`${label} does not end on the question the card is really asking — close the scene with it`);
  }
  // The SCENE is everything ahead of the closing question. A bare question ("You?") is shaped like an example and
  // pictures nothing, so the scene has to be there and has to say something.
  const sentences = splitSentences({ text: trimmed });
  const sceneWords = wordCount({ text: sentences.slice(0, -1).join(" ") });
  // `wordCount` counts a lone "?" as a word, so the closing question is judged by whether it carries a letter.
  const questionAsks = /\p{L}/u.test(sentences.at(-1)!);
  if (sentences.length < 2) {
    problems.push(`${label} is only a question — open it with the scene the owner is placed in, then ask`);
  } else if (!questionAsks) {
    problems.push(`${label} closes on a bare "?" — the question at its end has to ask something`);
  } else if (sceneWords < SCENE_MIN_WORDS) {
    problems.push(
      `${label} sets its scene in ${String(sceneWords)} words, under ${String(SCENE_MIN_WORDS)} — say where the owner is, ` +
        "what they see and what happened",
    );
  }
  const words = wordCount({ text: trimmed });
  if (words > ASK_EXAMPLE_MAX_WORDS) {
    problems.push(
      `${label} runs ${String(words)} words against a cap of ${String(ASK_EXAMPLE_MAX_WORDS)} — one scene and ` +
        "its question, not the whole investigation",
    );
  }
  return problems;
}

/**
 * Every way a gap line breaks its cap — one sentence, read in place of a scene.
 *
 * @param gap the line as typed
 * @returns one sentence per rule broken
 */
function gapProblems({ gap }: { gap: string }): readonly string[] {
  const trimmed = gap.trim();
  if (trimmed.length === 0) {
    return ["--example-gap is empty"];
  }
  const problems: string[] = [];
  // A line break is checked on its own: a gap with no sentence-ending punctuation reads as ONE sentence to
  // `splitSentences` however many lines it runs.
  if (LINE_BREAK.test(trimmed)) {
    problems.push("--example-gap runs over more than one line — it is one line");
  }
  const words = wordCount({ text: trimmed });
  if (words > SHORT_FIELD_MAX_WORDS) {
    problems.push(
      `--example-gap runs ${String(words)} words against a cap of ${String(SHORT_FIELD_MAX_WORDS)} — say why in one line`,
    );
  }
  const sentences = splitSentences({ text: trimmed }).length;
  if (sentences > 1) {
    problems.push(`--example-gap runs ${String(sentences)} sentences — it is one line`);
  }
  return problems;
}

/**
 * Every way a recorded set of examples breaks the shape, in the order a refusal prints them.
 *
 * A plain list rather than a typed union: the pass's behaviour IS the multiplicity of what is wrong
 * (`.claude/rules/error-handling.md` § "When NOT to introduce a union").
 *
 * @param examples the `--example` values, in order — empty when none were passed
 * @param gap the `--example-gap` value, absent when none was passed
 * @returns one sentence per rule broken, empty when the set is well-formed
 */
export function askExampleProblems({
  examples,
  gap,
}: {
  examples: readonly string[];
  gap: string | undefined;
}): readonly string[] {
  if (examples.length > 0 && gap !== undefined) {
    return [
      "--example and --example-gap were both passed — a card carries its scenes, or says why it has none, never both",
    ];
  }
  if (gap !== undefined) {
    return gapProblems({ gap });
  }
  if (examples.length === 0) {
    return [
      "no concrete example — pass --example with a second-person scene the owner can picture, ending on the question " +
        "(up to three for related asks), or --example-gap with one line saying why the row cannot support a truthful one",
    ];
  }
  const problems: string[] = [];
  if (examples.length > MAX_ASK_EXAMPLES) {
    problems.push(
      `${String(examples.length)} examples — a card carries at most ${String(MAX_ASK_EXAMPLES)}; split an unrelated ` +
        "one onto its own card",
    );
  }
  examples.forEach((text, index) => {
    problems.push(...exampleProblems({ label: `example ${String(index + 1)}`, text }));
  });
  return problems;
}

/**
 * The front-matter edit that records a set on a registered ask row: the one key it writes, and the other one it
 * removes, so a row that swaps a gap for scenes never carries both.
 *
 * Every scene is a JSON string, which is a YAML double-quoted scalar, so a colon or a `#` in it cannot break the
 * block `./docNested.ts` parses; the gap is the same quoting the flat reader already takes.
 *
 * @param set the scenes, or the gap
 * @returns the keys to set and the keys to remove, in `editFrontMatterFields`'s shape
 */
export function askExampleFrontMatter({ set }: { set: AskExampleSet }): {
  readonly set: readonly { readonly key: string; readonly value: string }[];
  readonly remove: readonly string[];
} {
  if (set.kind === "gap") {
    return { remove: ["examples"], set: [{ key: "exampleGap", value: JSON.stringify(set.gap) }] };
  }
  const rows = set.examples.map((text) => `  - ${JSON.stringify(text)}`);
  return { remove: ["exampleGap"], set: [{ key: "examples", value: `\n${rows.join("\n")}` }] };
}

/**
 * Whether two sets say the same thing — what a writer reads back against before it trusts an edit.
 *
 * @param left one set, or none
 * @param right the other, or none
 * @returns true when both carry the same scenes in the same order, the same gap, or neither
 */
export function sameAskExampleSet({
  left,
  right,
}: {
  left: AskExampleSet | undefined;
  right: AskExampleSet | undefined;
}): boolean {
  if (left === undefined || right === undefined) {
    return left === right;
  }
  if (left.kind === "gap" || right.kind === "gap") {
    return left.kind === "gap" && right.kind === "gap" && left.gap === right.gap;
  }
  return (
    left.examples.length === right.examples.length &&
    left.examples.every((text, index) => text === right.examples[index])
  );
}

/**
 * The set two read fields describe — the scenes when there are any, else the gap, else nothing.
 *
 * A READ, not a validation: a journal line or front matter that carries both is a hand-edit no verb could write,
 * and the scenes win because they are the stronger statement. A caller that must refuse calls
 * {@link askExampleProblems} first.
 *
 * @param examples the scenes the record carries, empty when it carries none
 * @param gap the gap line the record carries, absent when it carries none
 * @returns the set, or `undefined` on a record carrying neither
 */
export function askExampleSetOf({
  examples,
  gap,
}: {
  examples: readonly string[];
  gap: string | undefined;
}): AskExampleSet | undefined {
  if (examples.length > 0) {
    return { examples: examples.map((text) => text.trim()), kind: "examples" };
  }
  if (gap !== undefined) {
    return { gap: gap.trim(), kind: "gap" };
  }
  return undefined;
}

/**
 * The open question's CONCRETE EXAMPLES as a journal line — `handover example`: the one to three second-person scenes
 * the card leads with, or the one line saying why the row cannot support a truthful one. Not a re-ask: the text and
 * the asked instant stay where they were. Bound to the question it names, as a reconfirm is, and a later one
 * replaces an earlier one whole. One arm of `./ledger.ts`'s `RunEvent`, declared here beside the rules it obeys.
 */
export interface QuestionExamplesEvent {
  readonly kind: "question-examples";
  readonly atIso: string;
  readonly question: string;
  /** The scenes, in the order the card numbers them — empty exactly when {@link exampleGap} is present. */
  readonly examples: readonly string[];
  readonly exampleGap?: string;
}

/** The two fields a board row publishes for its card's example slot — always both, so a reader never guesses. */
export interface PublishedExamples {
  /** The one to three scenes the card leads with — empty when none was written. */
  readonly examples: readonly string[];
  /** Why the row's own record cannot support a truthful scene, in place of {@link examples}. */
  readonly exampleGap: string | undefined;
}

/**
 * A set as the board row publishes it: the scenes with no gap, the gap with no scenes, or neither.
 *
 * @param set the scenes, the gap, or nothing recorded
 * @returns both fields, the absent one empty
 */
export function publishedExamples({ set }: { set: AskExampleSet | undefined }): PublishedExamples {
  if (set === undefined) {
    return { exampleGap: undefined, examples: [] };
  }
  if (set.kind === "gap") {
    return { exampleGap: set.gap, examples: [] };
  }
  return { exampleGap: undefined, examples: set.examples };
}
