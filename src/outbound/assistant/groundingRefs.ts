/**
 * The AUTHORED PROSE inside an answer's grounding — every string a reader actually sees in the Details
 * fold — enumerated so the bare-reference pass can reach it.
 *
 * ## The hole this closes, and why it was invisible
 *
 * `parseAnswerArm` scanned `lead`, `body` and `index`, which is everything ABOVE the fold and nothing
 * below it. MEASURED on a real bot answer: ONE bare reference in the
 * visible body and TEN more in the fold — two `blindSpots` entries, a premise check's `subject` and `how`,
 * a `substitutedForReal.real`, the capability's `what` and one of its `command` words, and `result` twice.
 * The gate passed that answer. Grounding prose is authored rendered text — `./evidence.ts` turns every one
 * of these into visible `rich_text` — and the voice rules already treat it that way, so the bare-reference
 * rule was the outlier, not this file.
 *
 * ## Only the UNLINKED lines are residue, and that is the whole subtlety
 *
 * An evidence or premise line may carry its own `url`, and `./evidence.ts` then renders its LABEL as the
 * link text. A reference in such a label is already a hyperlink over its own text, which is exactly what the
 * owner asked for, so scanning it would refuse a correctly-formed line. {@link groundingProse} therefore
 * skips a line that carries a url and reports the rest.
 *
 * A line whose url points at a DIFFERENT object than its label names is a separate and worse failure — a
 * link whose text and href disagree misleads harder than plain text does. It is deliberately not checked
 * here: both measured instances (`"monitors 600103, 600104 and 600101 definitions"` → one monitor;
 * `"acme-admin#1 and its revert acme-admin#2"` → the wrong pull request) are spellings
 * `../linkify/bareRefs.ts` cannot resolve at all — a bare digit outside a merged/open/closed list, and a
 * `repo#n` with no owner — so a check built on this resolver would fire on neither and report clean. It is
 * on the board as its own row instead.
 *
 * ## What is left out, and why each one
 *
 * `capability.command` is a literal invocation, so a bare `#` number in it is an ARGUMENT rather than a citation and
 * rewriting or refusing it would change what the command says. `capability.id`, `surface.id`,
 * `provenance.model`, `skillsLoaded` and `verbsLoaded` are identifiers, not prose. `checkedAtIso`, `finding`
 * and every url are machine values. Everything else a reader reads is here.
 */
import type { AnswerFormAnswer } from "./answerForm.js";

/** One authored string in the grounding, with the JSON path a refusal points at and what its author can do. */
interface GroundingProse {
  readonly text: string;
  readonly path: readonly (string | number)[];
  /** What THIS field's author can actually do about a reference in it — the two remedies below. */
  readonly remedy: string;
  /**
   * Whether this string renders as a LINK's text rather than as plain text.
   *
   * It exists because the two rules reading this enumeration disagree about exactly one case, and only about
   * that one. A bare reference inside a link label is already the hyperlink the owner asked for, so
   * {@link groundingProse} drops it; an em-dash inside a link label is still an em-dash a reader sees, so
   * {@link groundingAuthoredProse} keeps it. One walk with a flag rather than two walks, because a region a
   * second walker forgets is a region its rule silently stops reading — this file's header is a record of
   * that exact failure.
   */
  readonly linked: boolean;
}

/** A line that HAS a url slot and simply did not fill it. */
const GIVE_IT_A_URL =
  "This line carries its own `url` field and left it empty, so its label rendered as plain text — fill it in " +
  "and the label becomes the link.";

/** A field with no url slot and no run vocabulary, where the reference itself has to move. */
const MOVE_THE_REFERENCE =
  "This field is plain text with nowhere to put a link, so name the object in `body` or `index` where a " +
  "`link` run can carry it, and refer to it here without repeating the raw id.";

/** The premise checks — two authored strings each, both LINKED when the check carried its own url. */
function premiseProse({
  checks,
}: {
  checks: AnswerFormAnswer["grounding"]["evidence"]["premiseChecks"];
}): GroundingProse[] {
  return checks.flatMap((check, index) => {
    const linked = check.url !== undefined;
    return [
      {
        linked,
        path: ["grounding", "evidence", "premiseChecks", index, "subject"],
        remedy: GIVE_IT_A_URL,
        text: check.subject,
      },
      {
        linked,
        path: ["grounding", "evidence", "premiseChecks", index, "how"],
        remedy: GIVE_IT_A_URL,
        text: check.how,
      },
    ];
  });
}

/** What was stood in for, and what could not be seen — plain text throughout, with nowhere to put a link. */
function unreachedProse({ evidence }: { evidence: AnswerFormAnswer["grounding"]["evidence"] }): GroundingProse[] {
  const substituted = evidence.substitutedForReal.flatMap((item, index): GroundingProse[] => [
    {
      linked: false,
      path: ["grounding", "evidence", "substitutedForReal", index, "real"],
      remedy: MOVE_THE_REFERENCE,
      text: item.real,
    },
    {
      linked: false,
      path: ["grounding", "evidence", "substitutedForReal", index, "why"],
      remedy: MOVE_THE_REFERENCE,
      text: item.why,
    },
  ]);
  const blindSpots = evidence.couldNotSee.blindSpots.map((spot, index): GroundingProse => ({
    linked: false,
    path: ["grounding", "evidence", "couldNotSee", "blindSpots", index],
    remedy: MOVE_THE_REFERENCE,
    text: spot,
  }));
  if (!("reason" in evidence.couldNotSee)) {
    return [...substituted, ...blindSpots];
  }
  return [
    ...substituted,
    ...blindSpots,
    {
      linked: false,
      path: ["grounding", "evidence", "couldNotSee", "reason"],
      remedy: MOVE_THE_REFERENCE,
      text: evidence.couldNotSee.reason,
    },
  ];
}

/**
 * The evidence trail's own prose — the half every grounding kind shares, in `./evidence.ts`'s own render
 * order (premises, read, consulted-empty, stood-in-for, could-not-see) so a refusal's paths land in the
 * order the reader meets them rather than the order this file happens to walk the object.
 */
function evidenceProse({ evidence }: { evidence: AnswerFormAnswer["grounding"]["evidence"] }): GroundingProse[] {
  const labelled = (
    [
      ["read", evidence.read],
      ["consultedEmpty", evidence.consultedEmpty],
    ] as const
  ).flatMap(([field, lines]) =>
    lines.map((line, index): GroundingProse => ({
      linked: line.url !== undefined,
      path: ["grounding", "evidence", field, index, "label"],
      remedy: GIVE_IT_A_URL,
      text: line.label,
    })),
  );
  return [...premiseProse({ checks: evidence.premiseChecks }), ...labelled, ...unreachedProse({ evidence })];
}

/**
 * Every authored string in an answer's grounding that a reader sees as PLAIN text, with its JSON path.
 *
 * A line already carrying its own url is omitted — its label renders as that link's text, so a reference in
 * it is already a hyperlink. See this file's header for what else is deliberately not here.
 *
 * @param grounding the validated grounding, whichever of the three kinds it is
 * @returns one entry per authored string, in the order a reader meets them
 */
export function groundingProse({ grounding }: { grounding: AnswerFormAnswer["grounding"] }): readonly GroundingProse[] {
  return groundingAuthoredProse({ grounding }).filter((prose) => !prose.linked);
}

/**
 * EVERY authored string in an answer's grounding, linked labels included — what the voice rules read.
 *
 * The one case it differs from {@link groundingProse} on is a line carrying its own url. That line's label
 * is the link's visible text, so it is authored voice exactly as a paragraph is — the same reason
 * `../voice/artifactProse.ts` walks a `link` run's `label` and not its href. Measured: five of
 * eight voice violations in one posted answer were in this evidence trail and none was in the lead.
 *
 * @param grounding the validated grounding, whichever of the three kinds it is
 * @returns one entry per authored string, in the order a reader meets them
 */
export function groundingAuthoredProse({
  grounding,
}: {
  grounding: AnswerFormAnswer["grounding"];
}): readonly GroundingProse[] {
  const found = evidenceProse({ evidence: grounding.evidence });
  if (grounding.kind === "conversation") {
    found.push({ linked: false, path: ["grounding", "reason"], remedy: MOVE_THE_REFERENCE, text: grounding.reason });
  }
  if (grounding.kind === "verb") {
    found.push({
      linked: false,
      path: ["grounding", "capability", "what"],
      remedy: MOVE_THE_REFERENCE,
      text: grounding.capability.what,
    });
    found.push({ linked: false, path: ["grounding", "result"], remedy: MOVE_THE_REFERENCE, text: grounding.result });
  }
  if (grounding.kind === "unreachable") {
    found.push({
      linked: false,
      path: ["grounding", "surface", "what"],
      remedy: MOVE_THE_REFERENCE,
      text: grounding.surface.what,
    });
    found.push({ linked: false, path: ["grounding", "why"], remedy: MOVE_THE_REFERENCE, text: grounding.why });
  }
  return found;
}
