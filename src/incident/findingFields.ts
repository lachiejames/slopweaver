/**
 * The incident form's FINDING fields — what the owner's rulings make a note carry before it may
 * reach them: what the fleet adds, the impact in people that opens the card, the impact or the question past an access
 * wall, a lean that never leads with a pull request, and the screenshot proving it. Split from `./form.ts`, which
 * checks the write-up's shape, because each of these is a ruling and reads as one. Pure.
 */
import { pullRequestLead, pullRequestLeadReason } from "../briefing/pullRequestLead.js";
import { SECOND_SENTENCE } from "../hand/step.js";
import { isRecord } from "../lib/parsers.js";
import { err, ok, type Result } from "../lib/result.js";

import { type IncidentFormInvalidError, IncidentNoteErrors } from "./errors.js";
import { FINDING_LINE_CAP, line } from "./formLine.js";

/** The longest `adds` line — the one contribution, said in a sentence. */
const ADDS_CAP = 200;

/**
 * The longest `meaning` — it opens the 120-character headline (`../hand/step.ts`'s `WHAT_CAP`) ahead of the
 * share question `./note.ts` appends, ": should we share it with the team (<reference>)?" — 58 characters at the
 * longest reference (`./form.ts`'s `REFERENCE_CAP`), so the two at their caps make exactly 120. The "should we" stays:
 * it is what makes the line ask a choice the card's decision can sit under (`../hand/decision.ts`'s `goAheadPhrase`).
 */
export const MEANING_CAP = 62;

/** An impact the fleet could not measure for want of access: the question someone who has it could answer. */
export interface IncidentImpactQuestion {
  /** The question, as it would be put to them. */
  readonly question: string;
  /** Who holds the access that answers it — the stakeholder the question loops in. */
  readonly askWho: string;
  /** The access the fleet tried and how it was refused, so the card shows the wall rather than asserting one. */
  readonly wall: string;
}

/** The longest `wall`: one clause naming the source tried and its refusal ("Hex returned 403 on the bookings view"). */
const WALL_CAP = 120;

/** The Datadog screenshot that proves a finding and its boxes, as `hand post --shot`/`--box` take them. */
export interface IncidentShot {
  readonly path: string;
  readonly boxes: readonly string[];
}

/**
 * The form's `impact`: one line, or — where measuring it needs access the fleet lacks — the question someone with that
 * access could answer, who that is, and the wall itself. An access wall is not a stop: bring the owner the
 * question, which loops in the right stakeholders. Whether a wall stood is the
 * composer's claim, as every authored field is; `wall` makes it a stated one the owner can check on the card, never an
 * unexplained "we lack access".
 *
 * @param value whatever the form carried
 * @returns the impact, or the refusal naming its field
 */
export function checkedImpact({
  value,
}: {
  value: unknown;
}): Result<string | IncidentImpactQuestion, IncidentFormInvalidError> {
  if (!isRecord(value)) {
    return line({ cap: FINDING_LINE_CAP, field: "impact", value });
  }
  if (Object.keys(value).length !== 3 || !("question" in value) || !("askWho" in value) || !("wall" in value)) {
    return err(
      IncidentNoteErrors.formInvalid({
        field: "impact",
        why: "is one line, or { question, askWho, wall } when measuring it needs access the fleet tried and was refused",
      }),
    );
  }
  return line({ cap: FINDING_LINE_CAP, field: "impact.question", value: value["question"] }).andThen((question) =>
    line({ cap: 60, field: "impact.askWho", value: value["askWho"] }).andThen((askWho) =>
      line({ cap: WALL_CAP, field: "impact.wall", value: value["wall"] }).map((wall) => ({ askWho, question, wall })),
    ),
  );
}

/**
 * The form's `adds`: what the fleet brings that the channel does not already have. Organisation
 * intelligence is for a big problem no one is talking about, and one already being
 * discussed — an incident channel always is — is dropped unless the fleet has a contribution that is not already there,
 * hard evidence such as the events actually dropped. Naming it is how the seat proves the note earns its place.
 *
 * @param value whatever the form carried
 * @returns the line, or the refusal naming its field
 */
export function checkedAdds({ value }: { value: unknown }): Result<string, IncidentFormInvalidError> {
  if (value === undefined) {
    return err(
      IncidentNoteErrors.formInvalid({
        field: "adds",
        why:
          "is required: the one thing the fleet found that the channel does not already have (hard evidence, such as " +
          "the events actually dropped) — with nothing to add, the incident is already being discussed and gets no note",
      }),
    );
  }
  return line({ cap: ADDS_CAP, field: "adds", value });
}

/**
 * The form's `meaning`: the impact in people, which opens the card. Leading with the mechanism
 * makes the reader translate it into people, so meaning leads.
 *
 * @param value whatever the form carried
 * @returns the line, or the refusal naming its field
 */
export function checkedMeaning({ value }: { value: unknown }): Result<string, IncidentFormInvalidError> {
  if (value === undefined) {
    return err(
      IncidentNoteErrors.formInvalid({
        field: "meaning",
        why:
          "is required: the impact in people, the card's first words, never the mechanism, which sits below as " +
          "rootCause",
      }),
    );
  }
  return line({ cap: MEANING_CAP, field: "meaning", value }).andThen((meaning) => {
    // It opens the card's one-sentence headline, so a second sentence here is one `buildHandStep` would refuse there.
    if (SECOND_SENTENCE.test(meaning)) {
      return err(
        IncidentNoteErrors.formInvalid({
          field: "meaning",
          why: "is one sentence — it opens the card's headline, which `hand post` refuses at a second",
        }),
      );
    }
    return ok(meaning);
  });
}

/**
 * The form's `lean`: a recommendation on the share that leads with the discussion, never a pull request.
 *
 * @param value whatever the form carried
 * @returns the line, or the refusal naming its field
 */
export function checkedLean({ value }: { value: unknown }): Result<string, IncidentFormInvalidError> {
  return line({ cap: 200, field: "lean", value }).andThen((lean) => {
    const phrase = pullRequestLead({ text: lean });
    return phrase === undefined
      ? ok(lean)
      : err(IncidentNoteErrors.formInvalid({ field: "lean", why: pullRequestLeadReason({ phrase }) }));
  });
}

/**
 * The form's `shot`, as `hand post` takes one — REQUIRED, because a finding reaches the owner only when a screenshot proves
 * it is real.
 *
 * @param value whatever the form carried
 * @returns the shot, or the refusal naming its field
 */
export function checkedShot({ value }: { value: unknown }): Result<IncidentShot, IncidentFormInvalidError> {
  if (value === undefined) {
    return err(
      IncidentNoteErrors.formInvalid({
        field: "shot",
        why:
          "is missing: a finding reaches the owner only with a screenshot proving it is real — take one with " +
          "`datadog shot`",
      }),
    );
  }
  const boxes = isRecord(value) ? value["boxes"] : undefined;
  const path = isRecord(value) ? value["path"] : undefined;
  const boxesAreText = Array.isArray(boxes) && boxes.every((box) => typeof box === "string");
  if (typeof path !== "string" || path.length === 0 || !boxesAreText || boxes.length === 0) {
    return err(
      IncidentNoteErrors.formInvalid({
        field: "shot",
        why: 'is { path, boxes: ["x,y,width,height=label", …] }',
      }),
    );
  }
  return ok({ boxes, path });
}
