/**
 * The rules a C3 body is held to beyond its shape — shared by the write schema and the CI gate.
 *
 * One list, read by both, so a form the door accepts renders a body CI accepts. Each issue carries a typed code and
 * the form path a caller goes and fixes. Word caps are counted by `src/prformat`'s own `countWords` against the
 * RENDERED cell. Where proof is hosted is a rule here too, kept in `./formHosting.ts`. A badge the form cannot derive
 * — unranked risk, a hover longer than a reader is shown — is refused here, before anything renders.
 */
import { splitSentences } from "../../briefing/sentences.js";
import { countWords } from "../../prformat/checkCore.js";
import { utcMidnightOf } from "./days.js";
import { plainTextOf, problemBadgeOf, proofBadgeOf, riskBadgeOf } from "./derive.js";
import { descriptionWordIssues, withholdingCredentialMessages } from "./descriptionWords.js";
import { hostingIssues } from "./formHosting.js";
import { renderContent } from "./render.js";
import type { BodyLayout, Content, IsoDay, PrBody } from "./types.js";

/** Which rule a body breaks. */
export type FormRuleCode =
  | "RISK_UNRANKED"
  | "BADGE"
  | "SEEN_DAY"
  | "WORD_CAP"
  | "VISUAL_PROOF"
  | "UNCHECKED_SPLIT"
  | "PROOF_REASON_SENTENCES"
  | "IMAGE_NOT_USER_ATTACHMENT"
  | "EVIDENCE_RELEASE_DOWNLOAD"
  | "EVIDENCE_COMMENT_LINK"
  | "EVIDENCE_COMMITTED_MEDIA"
  | "PROOF_IS_TEST_SENTENCE"
  | "REASON_REPEATED"
  | "TEAMMATE_WORDS"
  | "CI_WORK"
  | "CODE_UNFORMATTED"
  | "BOLD_NOT_A_FIGURE"
  | "COMMIT_UNLINKED"
  | "AUDIENCE_UNNAMED";

/** One rule a body breaks, and where in the form it breaks it. */
export interface FormRuleIssue {
  readonly code: FormRuleCode;
  readonly path: readonly (string | number)[];
  readonly message: string;
}

/**
 * The word caps, by field. The explainer's 70 is the owner's ruling (what broke, for whom, and what this changes);
 * the rest keep each line one line on a reader's screen.
 */
export const WORD_CAPS = {
  check: 25,
  checkGroupLabel: 6,
  explainer: 70,
  hover: 25,
  proves: 25,
  rerunNote: 50,
  uncheckedCheck: 15,
  uncheckedWhy: 30,
  worst: 20,
} as const;

/** A cap issue when the text runs over, else nothing. */
function capIssue({
  text,
  max,
  path,
  what,
}: {
  text: string;
  max: number;
  path: readonly (string | number)[];
  what: string;
}): readonly FormRuleIssue[] {
  const words = countWords({ cell: text });
  if (words <= max) {
    return [];
  }
  return [{ code: "WORD_CAP", message: `${what} is ${String(words)} words (max ${String(max)}). Trim it.`, path }];
}

/** A cap on one content cell, counted over its rendered HTML. */
function contentCap({
  content,
  ...rest
}: {
  content: Content;
  max: number;
  path: readonly (string | number)[];
  what: string;
}): readonly FormRuleIssue[] {
  return capIssue({ ...rest, text: renderContent({ content }) });
}

/** Every word cap on the fields only a hover carries. */
function hoverCapIssues({ body }: { body: PrBody }): readonly FormRuleIssue[] {
  const seen = body.problemSeen;
  const seenText = seen.kind === "seen" ? seen.what : seen.why;
  return [
    ...capIssue({ max: WORD_CAPS.hover, path: ["problemSeen"], text: seenText, what: "The problem's seen line" }),
    ...body.risk.items.flatMap((item, index) => [
      ...capIssue({
        max: WORD_CAPS.worst,
        path: ["risk", "items", index, "worst"],
        text: item.worst,
        what: `Risk item ${String(index + 1)}'s worst case`,
      }),
      ...capIssue({
        max: WORD_CAPS.hover,
        path: ["risk", "items", index, "check"],
        text: item.check.kind === "checked" ? item.check.check : item.check.why,
        what: `Risk item ${String(index + 1)}'s check`,
      }),
    ]),
  ];
}

/** Every word cap on the labelled check groups: a short label, and each check one sentence. */
function groupCapIssues({ body }: { body: PrBody }): readonly FormRuleIssue[] {
  if (body.checkGroups === undefined) {
    return [];
  }
  return body.checkGroups.flatMap((group, groupIndex) => [
    ...contentCap({
      content: group.label,
      max: WORD_CAPS.checkGroupLabel,
      path: ["checkGroups", groupIndex, "label"],
      what: "A check group's label",
    }),
    ...group.items.flatMap((content, index) =>
      contentCap({
        content,
        max: WORD_CAPS.check,
        path: ["checkGroups", groupIndex, "items", index],
        what: "A check",
      }),
    ),
  ]);
}

/** Every word cap on the visible sections. */
function bodyCapIssues({ body }: { body: PrBody }): readonly FormRuleIssue[] {
  const slots = (["problemProof", "solutionProof"] as const).flatMap((field) => {
    const slot = body[field];
    return slot.kind === "screenshot"
      ? contentCap({ content: slot.proves, max: WORD_CAPS.proves, path: [field, "proves"], what: "A proof line" })
      : contentCap({ content: slot.reason, max: WORD_CAPS.proves, path: [field, "reason"], what: "A proof reason" });
  });
  return [
    ...contentCap({ content: body.explainer, max: WORD_CAPS.explainer, path: ["explainer"], what: "The explainer" }),
    ...slots,
    ...body.checks.flatMap((content, index) =>
      contentCap({ content, max: WORD_CAPS.check, path: ["checks", index], what: "A check" }),
    ),
    ...groupCapIssues({ body }),
    ...body.notChecked.flatMap((item, index) => [
      ...contentCap({
        content: item.check,
        max: WORD_CAPS.uncheckedCheck,
        path: ["notChecked", index, "check"],
        what: "What was not checked",
      }),
      ...contentCap({
        content: item.why,
        max: WORD_CAPS.uncheckedWhy,
        path: ["notChecked", index, "why"],
        what: "Why it was not checked",
      }),
    ]),
    ...body.rerun.flatMap((item, index) =>
      item.kind === "note"
        ? contentCap({ content: item.content, max: WORD_CAPS.rerunNote, path: ["rerun", index], what: "A re-run note" })
        : [],
    ),
  ];
}

/** `nothing-on-screen` beside a screenshot contradicts itself. */
function visualProofIssues({ body }: { body: PrBody }): readonly FormRuleIssue[] {
  const anyScreenshot = body.problemProof.kind === "screenshot" || body.solutionProof.kind === "screenshot";
  if (body.visualProof !== "nothing-on-screen" || !anyScreenshot) {
    return [];
  }
  return [
    {
      code: "VISUAL_PROOF",
      message:
        'visualProof is "nothing-on-screen", but a proof slot carries a screenshot, which is something on screen. ' +
        'Set visualProof to "screen-change"',
      path: ["visualProof"],
    },
  ];
}

/** A "Not checked" item is split at its first `. `, so the check may carry none and may not end on one. */
function uncheckedSplitIssues({ body }: { body: PrBody }): readonly FormRuleIssue[] {
  return body.notChecked.flatMap((item, index): FormRuleIssue[] => {
    const check = plainTextOf({ content: item.check });
    if (!check.includes(". ") && !check.endsWith(".")) {
      return [];
    }
    return [
      {
        code: "UNCHECKED_SPLIT",
        message:
          `what was not checked ("${check}") is one short phrase with no full stop: the item renders as ` +
          '"<check>. <why>" and reads back by splitting at the first ". ". Move the rest into why',
        path: ["notChecked", index, "check"],
      },
    ];
  });
}

/** The most sentences a proof reason carries: why there is no screenshot, then where the proof is instead. */
const PROOF_REASON_SENTENCES_MAX = 2;

/**
 * The cap in words, printed by the refusal and carried verbatim by `skills/github/reference/composing-a-body.md`,
 * which the description review reads: the reviewer and the schema state one cap in one sentence.
 *
 * @internal exported so a unit test can hold the rule file to the same words
 */
export const PROOF_REASON_CAP =
  "a proof slot's reason is at most two sentences: why there is no screenshot, then where the proof is instead";

/** An abbreviation whose own full stop is not a sentence's end ("e.g. only internals" is one sentence). */
const ABBREVIATION = /\b(?:e\.g|i\.e|etc|vs|cf)\./giu;

/** A sentence's terminator followed by closing quotes or brackets, which hide the end from the splitter. */
const CLOSED_TERMINATOR = /([.!?]+)["'”’)\]]+/gu;

/**
 * A reason's prose as the sentence count reads it: a code or link run is one placeholder word, so an identifier's
 * full stop or a linked title's own punctuation never ends the author's sentence, and an abbreviation's stop is
 * dropped for the same reason. A stop inside a closing quote (`"Tests pass." Done.`) still ends its sentence.
 */
function reasonProseOf({ content }: { content: Content }): string {
  const prose = content.map((run) => (run.kind === "code" || run.kind === "link" ? "x" : run.text)).join("");
  return prose.replace(ABBREVIATION, "x").replace(CLOSED_TERMINATOR, "$1");
}

/**
 * A proof reason past {@link PROOF_REASON_SENTENCES_MAX} sentences. Its first sentence says why there is no
 * screenshot and its second, when there is one, where the proof is instead (the checks or a linked record, never a
 * test, whose common shapes `./descriptionWords.ts` refuses); a result belongs in `checks` and an unrun check in
 * `notChecked`. Refused here so a description review never has to choose between "one sentence" and "one fact per
 * sentence".
 */
function proofReasonSentenceIssues({ body }: { body: PrBody }): readonly FormRuleIssue[] {
  return (["problemProof", "solutionProof"] as const).flatMap((field): FormRuleIssue[] => {
    const slot = body[field];
    if (slot.kind !== "reason") {
      return [];
    }
    const sentences = splitSentences({ text: reasonProseOf({ content: slot.reason }) }).length;
    if (sentences <= PROOF_REASON_SENTENCES_MAX) {
      return [];
    }
    return [
      {
        code: "PROOF_REASON_SENTENCES",
        message:
          `${field}.reason is ${String(sentences)} sentences, and ${PROOF_REASON_CAP}. Move a result into checks and ` +
          "an unrun check into notChecked",
        path: [field, "reason"],
      },
    ];
  });
}

/** Every badge the form cannot derive: unranked risk, a malformed day, a hover longer than a reader is shown. */
function badgeIssues({ body, layout }: { body: PrBody; layout: BodyLayout }): readonly FormRuleIssue[] {
  const issues: FormRuleIssue[] = [];
  const risk = riskBadgeOf({ items: body.risk.items });
  if (risk.isErr()) {
    const code = risk.error.code === "RISK_UNRANKED" ? "RISK_UNRANKED" : "BADGE";
    issues.push({ code, message: risk.error.message, path: ["risk", "items"] });
  }
  const problem = problemBadgeOf({ seen: body.problemSeen });
  if (problem.isErr()) {
    issues.push({ code: "BADGE", message: problem.error.message, path: ["problemSeen"] });
  }
  const proof = proofBadgeOf({ body, layout });
  if (proof.isErr()) {
    issues.push({ code: "BADGE", message: proof.error.message, path: [proofHoverSourceOf({ body })] });
  }
  return issues;
}

/**
 * The slot whose reason the proof hover quotes, so an over-long hover names the field to shorten: the problem's reason
 * when only the solution is a screenshot, else the solution's.
 */
function proofHoverSourceOf({ body }: { body: PrBody }): "problemProof" | "solutionProof" {
  const problemQuoted = body.problemProof.kind === "reason" && body.solutionProof.kind === "screenshot";
  return problemQuoted ? "problemProof" : "solutionProof";
}

/** A problem seen after the day of the write. */
function seenDayIssues({ body, today }: { body: PrBody; today: IsoDay | undefined }): readonly FormRuleIssue[] {
  const seen = body.problemSeen;
  if (today === undefined || seen.kind !== "seen") {
    return [];
  }
  const on = utcMidnightOf({ day: seen.on });
  const now = utcMidnightOf({ day: today });
  if (on === undefined || now === undefined || on <= now) {
    return [];
  }
  return [
    {
      code: "SEEN_DAY",
      message: `the problem is marked seen on ${seen.on}, after today (${today}). Set problemSeen.on to the day it was seen`,
      path: ["problemSeen", "on"],
    },
  ];
}

/**
 * Every rule a C3 body breaks, beyond its shape. Empty means it conforms.
 *
 * A body is judged by the rules of the layout it is in: a layout-1 body, published before the content rules, is held
 * to the rules of its own time, and every write is layout 2 and meets them all (`./descriptionWords.ts`).
 *
 * @param today the day of the write when there is one; a problem seen after it is refused. Undefined where no clock
 *   is read (the CI gate judges a body already written)
 * @param layout the layout the body is in, or is about to be rendered in
 * @param title the pull request's title when the caller has it, which the title's word rules read
 * @returns one issue per broken rule, each with its code and the form path to fix; a message that would print a
 *   credential shape prints the withheld line instead
 */
export function c3FormErrors({
  body,
  today,
  layout,
  title,
}: {
  body: PrBody;
  today: IsoDay | undefined;
  layout: BodyLayout;
  title: string | undefined;
}): readonly FormRuleIssue[] {
  const words = layout === 2 ? descriptionWordIssues({ body, title }) : [];
  return withholdingCredentialMessages({
    issues: [
      ...words,
      ...badgeIssues({ body, layout }),
      ...seenDayIssues({ body, today }),
      ...hoverCapIssues({ body }),
      ...bodyCapIssues({ body }),
      ...visualProofIssues({ body }),
      ...uncheckedSplitIssues({ body }),
      ...proofReasonSentenceIssues({ body }),
      ...hostingIssues({ body }),
    ],
  });
}
