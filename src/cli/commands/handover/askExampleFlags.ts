/**
 * The `--example` / `--example-gap` pair every verb that records a NEW ask reads — and refuses without
 * (`../../../handover/askExamples.ts`).
 *
 * One reader so `handover ask` and `handover register --ask` cannot disagree about what a scene is: the shape is
 * the SCHEMA's (`AGENTS.md` rule 7), refused before anything is written rather than trimmed after.
 */
import { type AskExampleSet, askExampleProblems, askExampleSetOf } from "../../../handover/askExamples.js";
import { cardProseVerdict } from "../../../handover/cardAlignment.js";
import { exampleProseFields } from "../../../handover/cardImage.js";
import { repeatedFlagValues } from "../../parseFlags.js";

/** What the pair admitted: the set to record, or the refusal lines to print. */
export type AdmittedExamples =
  | { readonly kind: "admitted"; readonly set: AskExampleSet }
  | { readonly kind: "refused"; readonly lines: readonly string[] };

/**
 * Read and judge the pair off a verb's own argv tail.
 *
 * @param rest the verb's argv after its name — where every repeated `--example` is read, in order
 * @param gap the parsed `--example-gap`, absent when it was not passed
 * @param command the verb as a refusal names it — `handover ask`
 * @param env the process environment, for the unaligned-card hatch a picture named in a scene is refused on
 * @returns the set, or every reason it was refused, each naming the verb
 */
export function admittedExamples({
  rest,
  gap,
  command,
  env,
}: {
  rest: readonly string[];
  gap: string | undefined;
  command: string;
  env: Readonly<Record<string, string | undefined>>;
}): AdmittedExamples {
  const examples = repeatedFlagValues({ name: "example", rest });
  const problems = askExampleProblems({ examples, gap });
  const set = askExampleSetOf({ examples, gap });
  if (problems.length > 0 || set === undefined) {
    return {
      kind: "refused",
      lines: [
        ...problems.map((problem) => `${command}: ${problem}`),
        `${command}: nothing was recorded — every open Queue card leads with a concrete example`,
      ],
    };
  }
  // The card draws a scene as prose, so a picture named in one is the path the owner cannot see.
  const pictured = cardProseVerdict({
    command: `slopweaver ${command}`,
    env,
    fields: exampleProseFields({ examples, gap }),
  });
  if (pictured.kind === "refused") {
    return { kind: "refused", lines: pictured.lines };
  }
  return { kind: "admitted", set };
}

/**
 * The admitted examples as the fields an asking line carries — the scenes, or the gap — written on the same line
 * as the question, never a second append that could fail after the question landed.
 *
 * @param set the admitted scenes, or the gap
 * @returns the fields to spread onto the `question` or `question-shaped` event
 */
export function exampleFields({ set }: { set: AskExampleSet }): {
  readonly examples?: readonly string[];
  readonly exampleGap?: string;
} {
  return set.kind === "gap" ? { exampleGap: set.gap } : { examples: set.examples };
}
