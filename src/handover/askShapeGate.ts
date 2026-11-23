/**
 * The gate `handover ask` and `handover register` put in front of an unshaped ask — the rule that a recorded ask the
 * owner has to parse is a defect.
 *
 * ## Three verdicts, and the one that is not a refusal
 *
 * `./askShape.ts` computes whether a shape is `none`, `partial` or `whole`. This module turns that into what
 * a verb does:
 *
 * - **`whole`, within its caps** → nothing. The ask is recordable.
 * - **`whole`, over a cap** or **`partial`** → a refusal of FACT: the caller typed something and it does not
 *   read. There is no hatch for it, and none is wanted — the fix is to type it correctly, which costs one
 *   re-run and no judgement. `.claude/rules/error-handling.md` § "A POLICY refusal is not a domain error"
 *   is the distinction being drawn.
 * - **`none`** → a refusal of POLICY, with the `unshaped-ask` hatch, because it is the standing rule saying
 *   no to something that would otherwise have worked.
 * - **`whole`, naming a picture file as text** → a refusal of POLICY on the `unaligned-card` hatch
 *   (`./cardAlignment.ts`'s `cardProseVerdict`): the picture is attached with `handover shot`, never named.
 *
 * ## Why the policy half needs a hatch at all
 *
 * Rule 6 says an agent blocked on the owner must surface that. Rule 7 now says an ask must be shaped. A
 * session mid-incident that genuinely cannot yet state two options would, with no hatch, be unable to record
 * its question at all — which is rule 6's silent stall manufactured by rule 7's enforcement. The hatch is
 * what keeps the two rules from cancelling each other, and it is the shape
 * `.claude/rules/error-handling.md` requires of every policy refusal.
 *
 * The caller checks this BEFORE anything reaches a journal. `runHandoverAsk`'s own JSDoc carries the
 * measurement behind that ordering: a refusal issued after the run is recorded `waiting-on-owner` cannot be
 * acted on, because `handover ask` refuses to run twice on a waiting run.
 */

import { MAX_OPTIONS } from "../briefing/caps.js";
import { hatchFor } from "../hatch/lookup.js";
import { hatchRefusal } from "../hatch/render.js";

import {
  type AskOption,
  type AskStakes,
  askShapeProblems,
  MIN_OPTIONS,
  missingShapeFields,
  shapeCompleteness,
  stakesFrom,
  TRADEOFF_SEPARATOR,
} from "./askShape.js";
import { cardProseVerdict } from "./cardAlignment.js";

/**
 * The environment variable that lets a verb record an ask with no shape at all.
 *
 * Spelled as a LITERAL rather than built from `hatchEnvVar({ suffix })`, and that is the gate's requirement
 * rather than a style choice: `escape-hatch` in `yarn lint` checks that a row's named reader really mentions
 * its own key, and a name assembled at runtime is one no static scan can see.
 */
export const UNSHAPED_ASK_HATCH = "SLOPWEAVER_ALLOW_UNSHAPED_ASK";

/** A shape as a verb records it: every field present, the stakes included. */
export interface RecordableShape {
  readonly problem: string;
  readonly options: readonly AskOption[];
  readonly lean: string;
  readonly stakes: AskStakes;
}

/** What a verb should do with the shape it was handed. */
export type AskShapeVerdict =
  /** Recordable. `shape` is present only when the caller supplied a whole one. */
  | {
      readonly kind: "ok";
      readonly shape: RecordableShape | undefined;
    }
  /** Not recordable. `lines` is what to print, already whole — the caller adds nothing to it. */
  | { readonly kind: "refused"; readonly lines: readonly string[] };

/**
 * Whether this process may record an ask with no shape.
 *
 * Read into a local and OR-ed with the caller's own reason rather than written as a parameter default:
 * `hatch-release` refuses the default spelling anywhere in the tree, because a caller that always passes an
 * argument skips the initialiser and closes a hatch the operator had just opened.
 *
 * @param env the process environment
 * @param already whether the caller has its own reason to allow this
 * @returns true when an unshaped ask may be recorded
 */
export function unshapedAskAllowed({
  env,
  already,
}: {
  env: Readonly<Record<string, string | undefined>>;
  already: boolean;
}): boolean {
  const open = env[UNSHAPED_ASK_HATCH] === "1";
  return already || open;
}

/**
 * The verdict on one ask's shape.
 *
 * @param problem the `--problem` value, absent when the flag was not passed
 * @param options the parsed `--options`, empty when the flag was not passed
 * @param lean the `--lean` value, absent when the flag was not passed
 * @param risk the `--risk` value, absent when the flag was not passed
 * @param blastRadius the `--blast-radius` value, absent when the flag was not passed
 * @param stillReal the `--still-real` value, absent when the flag was not passed
 * @param parseProblems what the option parser itself rejected, which is reported ahead of any cap
 * @param command the door being refused, as the owner would type it
 * @param env the process environment, for the hatch
 * @param required false for a row where the owner has nothing to pick — a `--finding` row is a session's own
 *   observation, and demanding a lean on one would have the register carry a recommendation about a decision
 *   that was never the owner's to take. A PARTIAL or over-cap shape is still refused: the flags were used wrongly.
 * @returns the verdict, carrying either the shape to record or the lines to print
 */
export function askShapeVerdict({
  problem,
  options,
  lean,
  risk,
  blastRadius,
  stillReal,
  parseProblems,
  command,
  env,
  required,
}: {
  problem: string | undefined;
  options: readonly AskOption[];
  lean: string | undefined;
  risk: string | undefined;
  blastRadius: string | undefined;
  stillReal: string | undefined;
  parseProblems: readonly string[];
  command: string;
  env: Readonly<Record<string, string | undefined>>;
  required: boolean;
}): AskShapeVerdict {
  if (parseProblems.length > 0) {
    return { kind: "refused", lines: [...parseProblems, NOTHING_RECORDED, optionsHowTo({ command })] };
  }
  const completeness = shapeCompleteness({ lean, options, problem });
  const stakes = stakesFrom({ blastRadius, risk, stillReal });
  const noStakes = stakes.missing.length === STAKES_FLAG_COUNT;
  if (completeness === "none" && noStakes) {
    if (!required || unshapedAskAllowed({ already: false, env })) {
      return { kind: "ok", shape: undefined };
    }
    const hatch = { ...hatchFor({ id: "unshaped-ask" }), command };
    return { kind: "refused", lines: [hatchRefusal({ hatch }), NOTHING_RECORDED, optionsHowTo({ command })] };
  }
  if (completeness !== "whole" || stakes.stakes === undefined || problem === undefined || lean === undefined) {
    const missing = [...missingShapeFields({ lean, options, problem }), ...stakes.missing];
    return { kind: "refused", lines: partialRefusal({ command, missing }) };
  }
  const shape: RecordableShape = { lean, options, problem, stakes: stakes.stakes };
  const capped = askShapeProblems({ shape });
  if (capped.length > 0) {
    return {
      kind: "refused",
      lines: [
        `${command} blocked because the shape it was given does not read:`,
        ...capped.map(bulleted),
        NOTHING_RECORDED,
      ],
    };
  }
  const pictured = cardProseVerdict({ command, env, fields: shapeProseFields({ shape }) });
  if (pictured.kind === "refused") {
    return pictured;
  }
  return { kind: "ok", shape };
}

/**
 * Every field of a shape the card draws as prose, labelled as a refusal names it.
 *
 * @param shape the shape a verb is about to record
 * @returns the labelled fields, in the order the card draws them
 */
function shapeProseFields({
  shape,
}: {
  shape: RecordableShape;
}): readonly { readonly label: string; readonly text: string }[] {
  return [
    { label: "the problem", text: shape.problem },
    ...shape.options.flatMap((option) => [
      { label: `option ${option.letter}`, text: option.option },
      { label: `option ${option.letter}'s trade-off`, text: option.tradeoff },
    ]),
    { label: "the lean", text: shape.lean },
    { label: "the risk", text: shape.stakes.risk },
    { label: "the blast radius", text: shape.stakes.blastRadius },
    { label: "the still-real check", text: shape.stakes.stillReal },
  ];
}

/** How many stakes flags there are — all of them missing is the one arm that is not a partial shape. */
const STAKES_FLAG_COUNT = 3;

/** A partial shape's refusal, naming every flag it lacks. */
function partialRefusal({ command, missing }: { command: string; missing: readonly string[] }): readonly string[] {
  return [
    `${command} blocked because it was given a shape without ${missing.join(", ")} — an ask carries ` +
      "all six fields or none of them, because half a card is not a decision the owner can take.",
    NOTHING_RECORDED,
    optionsHowTo({ command }),
  ];
}

/** The one sentence every refusal here ends on, because it is what makes the advice followable. */
const NOTHING_RECORDED =
  "NOTHING was recorded and the run is not paused, so fix the shape and run the same command again.";

/** One problem as a printed line. */
function bulleted(problem: string): string {
  return `  - ${problem}`;
}

/** How to spell the three flags, printed with every refusal rather than left to the usage block. */
function optionsHowTo({ command }: { command: string }): string {
  return [
    `${command} wants, in the owner's voice and concise:`,
    "  --problem  one line: what is actually wrong or undecided",
    `  --options  ${String(MIN_OPTIONS)} to ${String(MAX_OPTIONS)} lines, each ` +
      `\`<what the owner could do> ${TRADEOFF_SEPARATOR} <what that costs>\``,
    "  --lean     one line: what the owner would most likely pick with infinite time and attention",
    "  --risk          one line: what goes wrong if the owner picks badly, or says nothing",
    "  --blast-radius  one line: who and what the decision reaches",
    "  --still-real    one line: how the problem was confirmed to still stand — the check a reader can re-run",
  ].join("\n");
}
