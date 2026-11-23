/**
 * The voice detectors, and the line this file draws between what the PUBLIC repo may own and what only the
 * operator's private configuration may.
 *
 * ## The split, stated once
 *
 * **Vocabulary is private.** The operator's actual banned characters, words and phrases live in
 * `profile.json` and are matched by `../../voice/exactRules.ts`, which this module folds in rather than
 * duplicating. That includes the em dash, which is a `literal` rule there — so there is deliberately no
 * public em-dash constant here, even though it is the rule most often quoted. Copying the operator's list into public
 * source would ship the very content the partition keeps out, and would then rot against the real one.
 *
 * **Pattern is public.** A performative opener, a "not X, it's Y" construction, an exclamation mark in a
 * broadcast, a projection asserted as a measurement: these are shapes rather than words. They are the same
 * class of thing as the golden section order, and this repository owns shape.
 *
 * A useful test for anything added later: could it be written down without naming a word the operator
 * personally dislikes? If yes it belongs here. If no it belongs in `profile.json`.
 *
 * Pure: prose in, findings out.
 */
import {
  authoredProseOf,
  type ExactVoiceRule,
  exactVoiceRuleFindings,
  voiceRuleLabel,
} from "../../voice/exactRules.js";
import { stripCode } from "./evidence.js";
import type { ProposalFinding } from "./findings.js";

/** The AI scaffold shapes, each with the name a reviewer would use for it. */
const SCAFFOLD_TELLS: readonly (readonly [RegExp, string])[] = [
  [/\b(?:not|isn't|it's not) [^.,;\n]{1,40}, (?:it's|that's) /i, 'negative parallelism ("not X, it\'s Y")'],
  [/^(?:great question|good (?:question|thread|point))\b/im, "performative opener"],
  [/^(?:the play|idea|plan|approach|the move|the point|tl;dr):/im, "two-word-label-colon opener"],
  [/\b(?:angle|vector|axis|lever)s?\b/i, "bucket abstraction"],
  [/\bit'?s worth noting\b|\bit is worth noting\b/i, "throat-clearing hedge"],
];

/**
 * WARN: the AI scaffold shapes.
 *
 * @param markdown the document body
 * @returns one finding per distinct tell
 */
export function scaffoldTells({ markdown }: { markdown: string }): readonly ProposalFinding[] {
  const prose = stripCode({ markdown });
  return SCAFFOLD_TELLS.flatMap(([matcher, label]) => {
    const match = matcher.exec(prose);
    return match === null
      ? []
      : [
          {
            message: `${label}: ${JSON.stringify(match[0].trim().slice(0, 48))}`,
            rule: "ai-scaffold-tell",
            severity: "warning" as const,
          },
        ];
  });
}

/**
 * WARN: an exclamation mark in a document a whole team reads. Full stops only.
 *
 * @param markdown the document body
 * @returns the finding, or nothing
 */
export function noExclamation({ markdown }: { markdown: string }): ProposalFinding | undefined {
  // `![` is a markdown image, not punctuation.
  return /!(?!\[)/.test(stripCode({ markdown }))
    ? {
        message: "exclamation mark in a broadcast document. Full stops only.",
        rule: "exclamation-in-broadcast",
        severity: "warning",
      }
    : undefined;
}

/** Framings that read as replacing people rather than helping the people already here. */
const HEADCOUNT: readonly RegExp[] = [
  /\b10x\b/i,
  /reduce\s+headcount/i,
  /replace\s+[^.\n]{0,20}(?:people|team|headcount|reps)/i,
  /do the work of \d+/i,
];

/**
 * WARN: a headcount or 10x framing. Reframe as assist-not-replace.
 *
 * @param markdown the document body
 * @returns the finding, or nothing
 */
export function headcountFraming({ markdown }: { markdown: string }): ProposalFinding | undefined {
  const prose = stripCode({ markdown });
  for (const matcher of HEADCOUNT) {
    const match = matcher.exec(prose);
    if (match !== null) {
      return {
        message: `headcount/10x framing ${JSON.stringify(match[0])}. Reframe it as doing more with the people already here.`,
        rule: "headcount-framing",
        severity: "warning",
      };
    }
  }
  return undefined;
}

/** A word that marks a figure as an estimate rather than a measurement. */
const HEDGE = /\b(?:most|roughly|about|around|a good chunk|probably|likely|looks|seems|i think|i reckon|should)\b/i;

/** A construction that describes something that has not happened. */
const COUNTERFACTUAL = /\b(?:would have|would've|would|will|could have|could've)\b/i;

/**
 * WARN: a projected figure asserted as if it had been measured.
 *
 * @param markdown the document body
 * @returns the finding, or nothing
 */
export function hedgeProjections({ markdown }: { markdown: string }): ProposalFinding | undefined {
  for (const sentence of stripCode({ markdown }).split(/(?<=[.?\n])\s+/)) {
    const hasFigure = /\b\d+(?:[.,]\d+)?\s*%|\b\d+\s+of\s+\d+\b/.test(sentence);
    if (hasFigure && COUNTERFACTUAL.test(sentence) && !HEDGE.test(sentence)) {
      return {
        message:
          "a projected figure is stated as measured. Soften it, or say plainly that it is an estimate; a " +
          "projection asserted as a measurement is the claim a reviewer will pull the whole document apart over.",
        rule: "unhedged-projection",
        severity: "warning",
      };
    }
  }
  return undefined;
}

/**
 * The operator's own exact rules, matched over authored prose only.
 *
 * A BLOCKER rather than a warning, matching the Slack as-me lane's posture: these are the operator's own
 * literals, and text the operator would not type is a voice violation rather than a style preference. With no rules
 * configured this returns nothing, so an install that has not set any is simply not gated on vocabulary.
 *
 * @param markdown the document body
 * @param rules the operator's private exact-rule list, from `profile.json`
 * @returns one finding per matching rule and prose region
 */
export function exactVoiceFindings({
  markdown,
  rules,
}: {
  markdown: string;
  rules: readonly ExactVoiceRule[];
}): readonly ProposalFinding[] {
  if (rules.length === 0) {
    return [];
  }
  return exactVoiceRuleFindings({ prose: authoredProseOf({ path: "body", text: markdown }), rules }).map((finding) => ({
    message:
      `${finding.path} ${voiceRuleLabel({ rule: finding.rule })}. ` +
      "Rewrite the prose; the rule list is yours, in profile.json.",
    rule: "voice-rule",
    severity: "blocker" as const,
  }));
}
