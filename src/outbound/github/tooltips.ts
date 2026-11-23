/**
 * The badge hovers of a C3 description, and the exact inverse of every one that carries a fact no section shows.
 *
 * Three hovers, each one or two plain sentences:
 *
 * - **risk**: `Worst case <worst>. <check>.` from the TOP risk item, or `… Not checked: <why>.` when nobody checked
 *   it — a risk with no check behind it says so rather than reading low.
 * - **problem**: `Seen <day>: <what>. <who ran it>.`, or the one-line reason it was not seen yet.
 * - **proof**: what kind of proof there is and who ran it, built from the two slots, never a grade.
 *
 * Template and inverse sit side by side so they cannot drift apart; `./parse.ts` still re-renders and compares bytes,
 * so an inverse that read something the template never wrote is caught there.
 *
 * ## Why a hover is capped, and where the number comes from
 *
 * A hover is an HTML `title` attribute, and how much of one a reader is shown is the browser's choice, not
 * GitHub's: a description's `title` reaches the page whole. Measured on one of this repository's own pull
 * requests, read back with `slopweaver github read <its url>`: the renderer wrote the problem hover
 * whole, 292 characters, and the owner saw it cut off on hover. So the cut is the browser's tooltip, which nothing
 * here can measure without driving one. {@link HOVER_MAX} is therefore a conservative constant, not a measured
 * boundary: 200 characters, under the length that was seen cut, and a derived hover over it is refused rather than
 * shortened, because a shortened one changes what it says.
 */
import { isoOfLongDay, longDay } from "./days.js";
import type { BodyLayout, ProblemSeen, ProofActor, RiskItem } from "./types.js";

/** The longest hover the door writes; see the module header for what was and was not measured. */
export const HOVER_MAX = 200;

/** The closing words a hover's sentence ends on, added here and never authored. */
function sentence({ text }: { text: string }): string {
  return `${text}.`;
}

/**
 * The risk hover, from the top item.
 *
 * @param top the first-ranked risk item, whose kind sets the level
 * @returns the hover text, unescaped
 */
export function riskHover({ top }: { top: RiskItem }): string {
  const check = top.check.kind === "checked" ? sentence({ text: top.check.check }) : `Not checked: ${top.check.why}.`;
  return `Worst case ${sentence({ text: top.worst })} ${check}`;
}

/** The inverse of {@link riskHover}: the worst case runs to the first `. `, which the schema refuses inside it. */
const RISK_HOVER = /^Worst case (.+?)\. (?:Not checked: (.+)|(.+))\.$/u;

/**
 * Recover the top risk item's worst case and check from its hover.
 *
 * @param text the decoded hover
 * @returns the two fields, or undefined when the text is not the template
 */
export function readRiskHover({ text }: { text: string }): Pick<RiskItem, "worst" | "check"> | undefined {
  const match = RISK_HOVER.exec(text);
  if (match === null) {
    return undefined;
  }
  const worst = match[1]!;
  const why = match[2];
  if (why !== undefined) {
    return { check: { kind: "unchecked", why }, worst };
  }
  return { check: { check: match[3]!, kind: "checked" }, worst };
}

/** The sentence a seen problem's hover ends on, saying who ran it — or that nothing records who did. */
const SEEN_BY: Readonly<Record<ProofActor | "unrecorded", string>> = {
  agent: "An agent ran it.",
  owner: "The owner ran it.",
  unrecorded: "Who ran it isn't recorded.",
};

/**
 * The problem hover: when it was seen, what was seen and who ran it; or why it was not seen yet.
 *
 * @param seen the problem's seen state
 * @returns the hover text, unescaped
 */
export function problemHover({ seen }: { seen: ProblemSeen }): string {
  if (seen.kind === "not-seen") {
    return sentence({ text: seen.why });
  }
  return `Seen ${longDay({ day: seen.on })}: ${sentence({ text: seen.what })} ${SEEN_BY[seen.by]}`;
}

/** The inverse of {@link problemHover}'s seen template. */
const SEEN_HOVER =
  /^Seen (\d{1,2} [A-Z][a-z]{2} \d{4}): (.+)\. (An agent ran it\.|The owner ran it\.|Who ran it isn't recorded\.)$/u;

/**
 * Recover the seen state from a seen problem's hover.
 *
 * @param text the decoded hover
 * @returns the seen state, or undefined when the text is not the template or its day is not real
 */
export function readSeenHover({ text }: { text: string }): ProblemSeen | undefined {
  const match = SEEN_HOVER.exec(text);
  const on = match === null ? undefined : isoOfLongDay({ text: match[1]! });
  if (match === null || on === undefined) {
    return undefined;
  }
  const by = (["agent", "owner", "unrecorded"] as const).find((actor) => SEEN_BY[actor] === match[3]);
  return by === undefined ? undefined : { by, kind: "seen", on, what: match[2]! };
}

/**
 * Recover the reason a problem was not seen from its hover.
 *
 * @param text the decoded hover
 * @returns the not-seen state, or undefined when the text does not end on the full stop the template adds
 */
export function readNotSeenHover({ text }: { text: string }): ProblemSeen | undefined {
  if (!text.endsWith(".") || text.length < 2) {
    return undefined;
  }
  return { kind: "not-seen", why: text.slice(0, -1) };
}

/** How a hover names an actor. */
const ACTOR_WORDS: Readonly<Record<ProofActor, string>> = { agent: "an agent", owner: "the owner" };

/** What the proof hover is built from: who ran each screenshot, and the plain reason for each reason slot. */
export type ProofHoverInput =
  | { readonly kind: "both"; readonly problemBy: ProofActor; readonly solutionBy: ProofActor }
  | { readonly kind: "solution-only"; readonly solutionBy: ProofActor; readonly problemReason: string }
  | { readonly kind: "problem-only"; readonly problemBy: ProofActor; readonly solutionReason: string }
  | { readonly kind: "tests-only"; readonly solutionReason: string }
  | { readonly kind: "not-run"; readonly solutionReason: string };

/** A reason as a hover ends it: its own closing punctuation, or a full stop added. */
function reasonSentence({ text }: { text: string }): string {
  const trimmed = text.trim();
  return /[.!?]$/u.test(trimmed) ? trimmed : `${trimmed}.`;
}

/**
 * The proof hover: what kind of proof there is and who ran it, never a grade.
 *
 * A tests-only hover opens on a fixed clause and then quotes the solution's reason. Layout 1's clause claimed
 * "nothing on screen changes", which contradicted a reason saying something else, so from layout 2 it claims only
 * that there are no screenshots and the reason says why.
 *
 * @param input the slots, reduced to what the hover says
 * @param layout the body layout the hover is rendered for
 * @returns the hover text, unescaped
 */
export function proofHover({ input, layout }: { input: ProofHoverInput; layout: BodyLayout }): string {
  switch (input.kind) {
    case "both":
      if (input.problemBy === input.solutionBy) {
        return (
          "Screenshots of the problem before this change and the solution after it, from real runs by " +
          `${ACTOR_WORDS[input.problemBy]}.`
        );
      }
      return (
        `Screenshots of the problem before this change, run by ${ACTOR_WORDS[input.problemBy]}, and the solution ` +
        `after it, run by ${ACTOR_WORDS[input.solutionBy]}.`
      );
    case "solution-only":
      return (
        `A screenshot of the solution from a real run by ${ACTOR_WORDS[input.solutionBy]}. The problem wasn't ` +
        `captured: ${reasonSentence({ text: input.problemReason })}`
      );
    case "problem-only":
      return (
        `A screenshot of the problem from a real run by ${ACTOR_WORDS[input.problemBy]}. The solution isn't shown ` +
        `yet: ${reasonSentence({ text: input.solutionReason })}`
      );
    case "tests-only":
      if (layout === 1) {
        return `No screenshots, since nothing on screen changes. ${reasonSentence({ text: input.solutionReason })}`;
      }
      return `No screenshots. ${reasonSentence({ text: input.solutionReason })}`;
    case "not-run":
      return `Not run for real yet: ${reasonSentence({ text: input.solutionReason })}`;
  }
}

/** The actor a hover names, read back. */
const ACTOR = "(the owner|an agent)";

/** The inverses of the three proof hovers that name an actor. */
const BOTH_SAME = new RegExp(
  `^Screenshots of the problem before this change and the solution after it, from real runs by ${ACTOR}\\.$`,
  "u",
);
const BOTH_MIXED = new RegExp(
  `^Screenshots of the problem before this change, run by ${ACTOR}, and the solution after it, run by ${ACTOR}\\.$`,
  "u",
);
const SOLUTION_ONLY = new RegExp(`^A screenshot of the solution from a real run by ${ACTOR}\\. `, "u");
const PROBLEM_ONLY = new RegExp(`^A screenshot of the problem from a real run by ${ACTOR}\\. `, "u");

/** An actor's words, read back. */
function actorOf({ words }: { words: string | undefined }): ProofActor | undefined {
  return (["agent", "owner"] as const).find((actor) => ACTOR_WORDS[actor] === words);
}

/**
 * Recover who ran each screenshot from a proof hover. Only the actors are read: the rest is derived from the slots,
 * and the parse's byte comparison checks it.
 *
 * @param text the decoded hover
 * @returns who ran the problem's and the solution's screenshot, each absent when the hover names none for it
 */
export function readProofActors({ text }: { text: string }): {
  problemBy: ProofActor | undefined;
  solutionBy: ProofActor | undefined;
} {
  const same = BOTH_SAME.exec(text);
  if (same !== null) {
    const by = actorOf({ words: same[1] });
    return { problemBy: by, solutionBy: by };
  }
  const mixed = BOTH_MIXED.exec(text);
  if (mixed !== null) {
    return { problemBy: actorOf({ words: mixed[1] }), solutionBy: actorOf({ words: mixed[2] }) };
  }
  const solution = SOLUTION_ONLY.exec(text);
  if (solution !== null) {
    return { problemBy: undefined, solutionBy: actorOf({ words: solution[1] }) };
  }
  const problem = PROBLEM_ONLY.exec(text);
  return { problemBy: actorOf({ words: problem?.[1] }), solutionBy: undefined };
}
