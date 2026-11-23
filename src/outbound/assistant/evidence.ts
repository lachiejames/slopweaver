/**
 * The EVIDENCE TRAIL — what an answer read, what it consulted and found nothing in, and what it could
 * not see at all. Pure, deterministic, and rendered straight off the answer form: no live route a turn can
 * take ever touches the corpus, so `conversation`, `verb` and `unreachable` all carry their own
 * session-authored trail directly (`answerGroundingSchema`'s `evidence` field), and this module reads it
 * back rather than deriving one from anything else.
 *
 * ## Why `read`/`consultedEmpty` items carry an OPTIONAL `url`
 *
 * A live investigation often reads a whole surface — "the working checkout", `git log` — with no single
 * address. Inventing one (a fake `slopweaver://` scheme, a link to nothing) would be a "plausible-looking
 * default" this module refuses to emit. So {@link EvidenceLine} carries an OPTIONAL `url`:
 * {@link renderEvidenceTrail} links a line when one is supplied and renders plain text when it is not,
 * rather than fabricating a target.
 *
 * ## Rendering
 *
 * {@link renderEvidenceTrail} emits top-level blocks only — the same doctrine `../slack/render.ts` holds
 * to. There is no `attachments` wrapper anywhere in this file and there must never be
 * one. The order is the owner's approved order from the live renders: what it read, then what it consulted
 * and found nothing in, then what stood in for a real artifact, then what it could not see, then the
 * provenance line. The measurement list sits with the premise checks at the TOP of the fold, because both
 * answer the same reader question — where did that come from, and when — and a figure's repro is worth
 * nothing to a reader who has to scroll past the whole trail to find it. Sections with nothing to say
 * are OMITTED rather than rendered empty — `couldNotSee` is the one exception, because the owner's ruling on
 * {@link "./answerEvidence.js".couldNotSeeSchema} is that an empty blind-spot list still has to justify itself,
 * never simply vanish.
 *
 * Provenance renders the model, and the loaded verbs and skills. There is no session link: the provenance
 * shape carries no `sessionUrl` field by owner decision (it points at a local terminal session nobody else
 * can open), so there is nothing here to render even by accident.
 */
import type { KnownBlock, RichTextBlock, RichTextElement, RichTextList, RichTextSection } from "@slack/types";
import type { z } from "zod";

import { escapeMrkdwn } from "../slack/render.js";
import type { couldNotSeeSchema, executionProvenanceSchema } from "./answerEvidence.js";
import type { AnswerFormAnswer } from "./answerForm.js";
import type { FigureMeasurement } from "./measuredFigures.js";

/** What grounds any live-routed answer's provenance line — every grounding kind shares this shape now. */
export type Provenance = z.infer<typeof executionProvenanceSchema>;

/**
 * What the trail could not see: real blind spots, OR an explicit reason there are none. The SAME structural
 * union `./answerEvidence.ts` enforces — reused rather than re-declared, so the two can never drift apart.
 */
type CouldNotSee = z.infer<typeof couldNotSeeSchema>;

/**
 * One line of what was read, or consulted and found empty. `url` is optional: a per-record citation has
 * one, a coverage LEG does not, and a line with none renders as plain text rather than a fabricated link.
 */
interface EvidenceLine {
  readonly label: string;
  readonly url?: string | undefined;
}

/**
 * One present-state check of a premise the ask assumed — the shape `./answerEvidence.ts`'s `premiseCheckSchema`
 * parses, reused here rather than re-declared so the two cannot drift.
 */
interface PremiseCheck {
  readonly subject: string;
  readonly finding: "exists" | "absent" | "inconclusive";
  readonly how: string;
  readonly checkedAtIso: string;
  readonly url?: string | undefined;
}

/**
 * One real artifact the turn could not produce, and why — the shape `./answerEvidence.ts`'s
 * `substitutedForRealSchema` parses, reused here rather than re-declared so the two cannot drift.
 */
interface SubstitutedForReal {
  readonly real: string;
  readonly why: string;
}

/** The buckets an answer's evidence sorts into, regardless of which route produced them. */
export interface EvidenceTrail {
  readonly premiseChecks: readonly PremiseCheck[];
  readonly read: readonly EvidenceLine[];
  readonly consultedEmpty: readonly EvidenceLine[];
  readonly couldNotSee: CouldNotSee;
  readonly substitutedForReal: readonly SubstitutedForReal[];
}

/**
 * The evidence trail for a PARSED `answer` form, regardless of which way it is grounded.
 *
 * Every grounding kind — `conversation`, `verb`, `unreachable` — IS its own trail:
 * `answerGroundingSchema`'s `evidence` field is exactly the shape this module renders, so it is returned
 * unchanged rather than derived from anything else.
 *
 * @param answer the parsed answer form
 * @returns the trail to render
 */
export function evidenceTrailFor({ answer }: { answer: AnswerFormAnswer }): EvidenceTrail {
  return answer.grounding.evidence;
}

/** One `rich_text_section` wrapping a fixed run of elements. */
function section({ elements }: { elements: readonly RichTextElement[] }): RichTextSection {
  return { elements: [...elements], type: "rich_text_section" };
}

/** One `rich_text_list` (bulleted) wrapping a section per item. */
function bulletList({ items }: { items: readonly (readonly RichTextElement[])[] }): RichTextList {
  return { elements: items.map((elements) => section({ elements })), style: "bullet", type: "rich_text_list" };
}

/** One evidence line as its rich_text elements: a link when it has a `url`, plain text otherwise. */
function evidenceLineElements({ line }: { line: EvidenceLine }): readonly RichTextElement[] {
  return line.url === undefined
    ? [{ text: line.label, type: "text" }]
    : [{ text: line.label, type: "link", url: line.url }];
}

/**
 * One premise check as its rich_text elements: the subject, its verdict, how it was checked and when.
 *
 * The instant is part of the rendered line rather than a footnote, because that is the whole claim — "the
 * repo does not exist" is worthless undated, and "as of <instant>" is what a reader re-runs.
 */
function premiseCheckElements({ check }: { check: PremiseCheck }): readonly RichTextElement[] {
  const head: RichTextElement =
    check.url === undefined
      ? { text: check.subject, type: "text" }
      : { text: check.subject, type: "link", url: check.url };
  return [head, { text: ` — ${check.finding} — ${check.how}, as of ${check.checkedAtIso}`, type: "text" }];
}

/**
 * One substitution as its rich_text elements: the real artifact, then the reason it is absent.
 *
 * The reason is rendered in the SAME line rather than as a nested note, because a reader who sees only the
 * first half has the exact message the owner rejected — the fact of the gap without its cause.
 */
function substitutedForRealElements({ entry }: { entry: SubstitutedForReal }): readonly RichTextElement[] {
  return [
    { style: { bold: true }, text: entry.real, type: "text" },
    { text: ` — not produced this turn: ${entry.why}`, type: "text" },
  ];
}

/**
 * One measurement as its rich_text elements: the figures it settles, the command, and when that command ran.
 *
 * The figures lead and are bold, because a reader scanning for one number has to find its row without
 * reading every repro. The instant is in the same line for the reason {@link premiseCheckElements} states
 * about its own — a number without one is worthless, and the class this rule closes
 * (`./measuredFigures.ts`) is precisely a count asserted with no instant behind it.
 */
function measurementElements({ measurement }: { measurement: FigureMeasurement }): readonly RichTextElement[] {
  return [
    { style: { bold: true }, text: measurement.figures.join(", "), type: "text" },
    { text: ` — ${measurement.repro}, as of ${measurement.takenAtIso}`, type: "text" },
  ];
}

/** A bold heading followed by a bullet list, or nothing at all when there is nothing to list. */
function headedList({
  heading,
  items,
}: {
  heading: string;
  items: readonly (readonly RichTextElement[])[];
}): RichTextBlock | undefined {
  if (items.length === 0) {
    return undefined;
  }
  return {
    elements: [section({ elements: [{ style: { bold: true }, text: heading, type: "text" }] }), bulletList({ items })],
    type: "rich_text",
  };
}

/**
 * The "what I could not see" block — the one section that is NEVER omitted. A non-empty `blindSpots` list
 * renders as its own headed bullet list; the reason branch renders as one line naming why there is nothing
 * to list, because an empty section here would read as "nobody checked" rather than "nothing was missed".
 */
function couldNotSeeBlock({ couldNotSee }: { couldNotSee: CouldNotSee }): RichTextBlock {
  const heading: RichTextElement = { style: { bold: true }, text: "What I could not see", type: "text" };
  if ("reason" in couldNotSee) {
    return {
      elements: [section({ elements: [heading, { text: ` — nothing: ${couldNotSee.reason}`, type: "text" }] })],
      type: "rich_text",
    };
  }
  return {
    elements: [
      section({ elements: [heading] }),
      bulletList({ items: couldNotSee.blindSpots.map((spot) => [{ text: spot, type: "text" }]) }),
    ],
    type: "rich_text",
  };
}

/**
 * The provenance line: the model, and the loaded verbs and skills. `·`-separated, the same separator
 * `./footer.ts` uses for the same reason. No session link: the provenance shape carries no `sessionUrl`
 * field, so there is nothing here that could render one even by accident.
 *
 * @param provenance how the answer was produced
 * @returns the mrkdwn line
 */
function provenanceLine({ provenance }: { provenance: Provenance }): string {
  const verbs = provenance.verbsLoaded.length === 0 ? "no verbs loaded" : `verbs: ${provenance.verbsLoaded.join(", ")}`;
  const skills =
    provenance.skillsLoaded.length === 0 ? "no skills loaded" : `skills: ${provenance.skillsLoaded.join(", ")}`;
  const parts = [
    escapeMrkdwn({ text: provenance.model }),
    escapeMrkdwn({ text: verbs }),
    escapeMrkdwn({ text: skills }),
  ];
  return parts.join(" · ");
}

/**
 * Render the evidence trail as top-level Slack blocks: the premises checked, how each figure was measured,
 * then what was read, what was consulted and found empty, what stood in for a real artifact, what could not
 * be seen, then the provenance line. No wrapper, no
 * `attachments` key — see this file's header for why that is non-negotiable. Deterministic: no clock, no
 * filesystem, no environment, so the same trail and provenance render the same bytes forever.
 *
 * `measurements` is a separate parameter rather than a field of {@link EvidenceTrail}, because that type is
 * exactly `grounding.evidence` and nothing else — a test asserts the identity — while a measurement is a
 * field of the answer ARM. It carries no default: an answer that measured nothing passes the empty array and
 * says so, for the same reason `../../admit/reviewVerdict.ts`'s `voice` field makes a reviewer state that it
 * checked nothing instead of leaving silence and looking identical to one that did.
 *
 * @param trail the evidence trail, from {@link evidenceTrailFor}
 * @param measurements the answer arm's own `measurements`, rendered in the order it declares them
 * @param provenance how the answer was produced
 * @returns the blocks to append to the answer, top-level and never wrapped
 */
export function renderEvidenceTrail({
  trail,
  measurements,
  provenance,
}: {
  trail: EvidenceTrail;
  measurements: readonly FigureMeasurement[];
  provenance: Provenance;
}): readonly KnownBlock[] {
  const blocks: KnownBlock[] = [];
  const premise = headedList({
    heading: "What I checked before answering",
    items: trail.premiseChecks.map((check) => premiseCheckElements({ check })),
  });
  if (premise !== undefined) {
    blocks.push(premise);
  }
  const measured = headedList({
    heading: "How each figure was measured",
    items: measurements.map((measurement) => measurementElements({ measurement })),
  });
  if (measured !== undefined) {
    blocks.push(measured);
  }
  const read = headedList({ heading: "What I read", items: trail.read.map((line) => evidenceLineElements({ line })) });
  if (read !== undefined) {
    blocks.push(read);
  }
  const consultedEmpty = headedList({
    heading: "Consulted, found nothing",
    items: trail.consultedEmpty.map((line) => evidenceLineElements({ line })),
  });
  if (consultedEmpty !== undefined) {
    blocks.push(consultedEmpty);
  }
  const substituted = headedList({
    heading: "Stood in for the real thing",
    items: trail.substitutedForReal.map((entry) => substitutedForRealElements({ entry })),
  });
  if (substituted !== undefined) {
    blocks.push(substituted);
  }
  blocks.push(couldNotSeeBlock({ couldNotSee: trail.couldNotSee }));
  blocks.push({ elements: [{ text: provenanceLine({ provenance }), type: "mrkdwn" }], type: "context" });
  return blocks;
}
