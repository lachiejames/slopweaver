/**
 * The PROJECTED sections a composer may not author, and the one refusal all of them share.
 *
 * Split out of `./renderCore.ts` on size, along the seam that was already there: every function here does
 * exactly one thing — refuse a form that wrote the field itself, then attach what the verb projected — and
 * none of them knows anything about rendering, checking or the page. Nothing in this file reads the
 * filesystem or the clock; the sections arrive already projected, from `./briefingRenderSections.ts` and
 * `../../../briefing/*`.
 *
 * `injectNarrative` and `injectStamps` are not here, which is deliberate rather than an oversight: each is
 * about the page's own frame — three narrative sections at once, the eyebrow's two instants — rather than one
 * projected section. `injectNarrative` lives in `./injectNarrative.ts` beside the `NARRATIVE_FIELDS` it reads,
 * and `injectStamps` in `./renderCore.ts` beside `BriefingStamps`, with the shell.
 */
import { isRecord } from "../../../lib/parsers.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type {
  BriefingAutonomy,
  BriefingHandSteps,
  BriefingOpenArtifact,
  BriefingOwnerBeliefs,
  BriefingQuiz,
  BriefingSection,
  BriefingYourList,
} from "../../../outbound/briefing/types.js";
import { type BriefingCommandError, BriefingCommandErrors } from "./errors.js";

/**
 * The ONE refusal every projected section shares: the form composed a section the verb projects.
 *
 * Seven sections raise it — `reactNow.openArtifacts`, `autonomy`, `handSteps`, `ownerBeliefs`, `yourList`,
 * `freshness` and `nothingStale` — and each used to author its own refusal with the same opening clause. It is one
 * `COMPOSED_PROJECTION_REFUSED` (`./errors.ts`) carrying the field and the reason, leaving every section's
 * own prose byte-identical to what it printed before: the reason a section cannot be composed is genuinely
 * per-section, and it is data here rather than a sixth copy of the sentence.
 *
 * @param field the form field that was composed, as a reader sees it in the document
 * @param why what this section is projected FROM, and which flag supplies it instead
 * @returns the refusal, always — callers return it directly
 */
export function refuseComposedProjection({
  field,
  why,
}: {
  field: string;
  why: string;
}): Result<unknown, BriefingCommandError> {
  return err(BriefingCommandErrors.composedProjection({ field, why }));
}

/**
 * Put the derived open-artifact index into the form, refusing a form that wrote one itself.
 *
 * The refusal is the mechanism, exactly as it is for {@link injectYourList} and for the eyebrow's two
 * instants. A validity mark a composer can type is one that can read `valid` on a page the owner's own steer already
 * settled — which is a failure that happened, not a hypothetical — so there is exactly one way
 * to fill this section and it is `--open-artifacts` against the lock-in ledger.
 *
 * @param json the parsed form, before validation
 * @param openArtifacts the derived index, absent when the run named no document
 * @returns the form with the index attached, or the refusal
 */
export function injectOpenArtifacts({
  json,
  openArtifacts,
}: {
  json: unknown;
  openArtifacts: readonly BriefingOpenArtifact[] | undefined;
}): Result<unknown, BriefingCommandError> {
  const composed = isRecord(json) ? json["reactNow"] : undefined;
  if (isRecord(composed) && composed["openArtifacts"] !== undefined) {
    return refuseComposedProjection({
      field: "reactNow.openArtifacts",
      why:
        "Each entry's validity mark is DERIVED from the lock-in ledger, never composed — a mark a form can " +
        "type is one that can read `valid` on a page a later steer already settled. Drop it, and pass " +
        "`--open-artifacts <path|->` instead.",
    });
  }
  if (openArtifacts === undefined || !isRecord(json)) {
    return ok(json);
  }
  const rest = isRecord(composed) ? composed : {};
  return ok({ ...json, reactNow: { ...rest, openArtifacts } });
}

/**
 * Put the projected autonomy ledger into the form, refusing a form that wrote the section itself.
 *
 * The refusal is the mechanism, exactly as it is for {@link injectYourList} and the open-artifact index. This
 * section exists so the owner can steer the fleet retroactively about what it actually did; a composer free to
 * retype a row could disagree with the acting session's own record, and what the owner would then be judging is an
 * account of the act rather than the act. There is exactly one way to fill it, and it is `--autonomy-ledger`
 * against the register every acting session writes to.
 *
 * @param json the parsed form, before validation
 * @param autonomy the projected section, absent when the run asked for no register
 * @returns the form with the section attached, or the refusal
 */
export function injectAutonomy({
  json,
  autonomy,
}: {
  json: unknown;
  autonomy: BriefingAutonomy | undefined;
}): Result<unknown, BriefingCommandError> {
  if (isRecord(json) && json["autonomy"] !== undefined) {
    return refuseComposedProjection({
      field: "autonomy",
      why:
        "That section is a projection of the autonomy register every session acting under graduated " +
        "autonomy appends to, never composed — a row a form can type is a row the owner could steer about an act " +
        "that was never recorded. Drop it, and pass `--autonomy-ledger`.",
    });
  }
  if (autonomy === undefined || !isRecord(json)) {
    return ok(json);
  }
  return ok({ ...json, autonomy });
}

/**
 * Put the projected question into the form, refusing a form that wrote one itself.
 *
 * The refusal is the mechanism, exactly as it is for {@link injectOwnerBeliefs}. A composer free to retype
 * the claim could put a question in front of the owner the fleet never learned, or show them a verdict the
 * register does not hold, and then collect the owner's answer against it — and the id on the page is what that
 * answer names.
 *
 * @param json the parsed form, before validation
 * @param quiz the projected question, absent when the run was given no `--knowledge-quiz`
 * @returns the form with the question attached, or the refusal
 */
export function injectQuiz({
  json,
  quiz,
}: {
  json: unknown;
  quiz: BriefingQuiz | undefined;
}): Result<unknown, BriefingCommandError> {
  if (isRecord(json) && json["quiz"] !== undefined) {
    return refuseComposedProjection({
      field: "quiz",
      why:
        "That block is a projection of the quiz ledger, never composed — a claim a form can retype is one " +
        "the owner could be asked to judge that the fleet never learned. Drop it from the form and pass " +
        "`--knowledge-quiz --sweep <tick-id>` instead.",
    });
  }
  if (quiz === undefined || !isRecord(json)) {
    return ok(json);
  }
  return ok({ ...json, quiz });
}

/**
 * Put the projected correction block into the form, refusing a form that wrote one itself.
 *
 * The refusal is the mechanism, exactly as it is for {@link injectYourList}. This block asks the owner to judge
 * whether the fleet read the owner's own knowledge correctly, so what the owner is shown has to BE what the reviewing
 * session recorded — a supervisor free to retype a claim would be free to put words in the fleet's mouth
 * and then collect the owner's mark on them, which makes the answer worthless as a record of anything.
 *
 * @param json the parsed form, before validation
 * @param ownerBeliefs the projected block, absent when the run was given no `--owner-beliefs`
 * @returns the form with the block attached, or the refusal
 */
export function injectOwnerBeliefs({
  json,
  ownerBeliefs,
}: {
  json: unknown;
  ownerBeliefs: BriefingOwnerBeliefs | undefined;
}): Result<unknown, BriefingCommandError> {
  if (isRecord(json) && json["ownerBeliefs"] !== undefined) {
    return refuseComposedProjection({
      field: "ownerBeliefs",
      why:
        "That block is a projection of the proposal queue, never composed — a claim a form can retype is " +
        "one the owner could be asked to mark without the fleet ever having proposed it. Drop it from the form " +
        "and pass `--owner-beliefs` instead.",
    });
  }
  if (ownerBeliefs === undefined || !isRecord(json)) {
    return ok(json);
  }
  return ok({ ...json, ownerBeliefs });
}

/**
 * Put the projected hand steps into the form, refusing a form that wrote the section itself.
 *
 * The refusal is the mechanism, exactly as it is for {@link injectAutonomy}. Every row here carries a
 * command the owner is being asked to PASTE INTO A SHELL, so a composer free to retype one is a composer who can
 * get a flag wrong on a line nobody will read carefully — the whole value of the section is that its bytes
 * are the register's bytes. There is one way to fill it and it is `--hand-steps`.
 *
 * @param json the parsed form, before validation
 * @param handSteps the projected section, absent when the run asked for none
 * @returns the form with the section attached, or the refusal
 */
export function injectHandSteps({
  json,
  handSteps,
}: {
  json: unknown;
  handSteps: BriefingHandSteps | undefined;
}): Result<unknown, BriefingCommandError> {
  if (isRecord(json) && json["handSteps"] !== undefined) {
    return refuseComposedProjection({
      field: "handSteps",
      why:
        "That section is a projection of the hand register, never composed — every row carries a command " +
        "the owner pastes into a shell, and one a form can retype is one that can differ from what the register " +
        "holds. Drop it, and pass `--hand-steps`.",
    });
  }
  if (handSteps === undefined || !isRecord(json)) {
    return ok(json);
  }
  return ok({ ...json, handSteps });
}

/**
 * Put the projected list into the form, refusing a form that already carries one.
 *
 * The refusal is the point. THE OWNER'S list is a projection of `slopweaver session-start`, so a form that spelled
 * one out by hand would be a second, editable copy of a register the ruling says must not be merged — and a
 * composer free to disagree with the verb is the drift surface the whole one-index design removes. There is
 * exactly one way to fill this section, and it is `--your-list`.
 *
 * @param json the parsed form, before validation
 * @param yourList the projected section, absent when the run was given no `--your-list`
 * @returns the form with the section attached, or the refusal
 */
export function injectYourList({
  json,
  yourList,
}: {
  json: unknown;
  yourList: BriefingYourList | undefined;
}): Result<unknown, BriefingCommandError> {
  const authored = isRecord(json) && json["yourList"] !== undefined;
  if (authored) {
    return refuseComposedProjection({
      field: "yourList",
      why:
        "That section is a projection of `slopweaver session-start`, never composed — drop it from the " +
        "form and pass `--your-list <path|->` instead.",
    });
  }
  if (yourList === undefined || !isRecord(json)) {
    return ok(json);
  }
  return ok({ ...json, yourList });
}

/**
 * Splice in the freshness section, refusing a form that wrote one itself.
 *
 * Refused for the same reason `yourList` is: every count in this section's summary is derived from the
 * roster and the recorded outcomes, and a composer free to type one would be free to disagree with the
 * schedule the section describes. This section exists because a number nobody was checking went wrong —
 * making it authorable would rebuild the hole it fills.
 *
 * @param json the parsed form, before validation
 * @param freshness the projected section, absent when the run asked for none
 * @returns the form with the section spliced in, or the refusal
 */
export function injectFreshness({
  json,
  freshness,
}: {
  json: unknown;
  freshness: BriefingSection | undefined;
}): Result<unknown, BriefingCommandError> {
  if (isRecord(json) && json["freshness"] !== undefined) {
    return refuseComposedProjection({
      field: "freshness",
      why:
        "That section is projected from this machine's own resync roster and outcomes, never composed — " +
        "drop it from the form and pass `--freshness` instead.",
    });
  }
  if (freshness === undefined || !isRecord(json)) {
    return ok(json);
  }
  return ok({ ...json, freshness });
}

/**
 * Splice in the "Nothing stale" section, refusing a form that wrote one itself.
 *
 * Refused for the reason {@link injectFreshness} is: its leading count is derived from local documents the
 * standing rows wrote (`../../../briefing/nothingStale.ts`), and a composer free to type one would be free to
 * report an all-clear the documents do not support.
 *
 * @param json the parsed form, before validation
 * @param nothingStale the projected section, absent when the run asked for none
 * @returns the form with the section spliced in, or the refusal
 */
export function injectNothingStale({
  json,
  nothingStale,
}: {
  json: unknown;
  nothingStale: BriefingSection | undefined;
}): Result<unknown, BriefingCommandError> {
  if (isRecord(json) && json["nothingStale"] !== undefined) {
    return refuseComposedProjection({
      field: "nothingStale",
      why:
        "That section is projected from the documents this machine's standing rows wrote, never composed — " +
        "drop it from the form and pass `--nothing-stale` instead.",
    });
  }
  if (nothingStale === undefined || !isRecord(json)) {
    return ok(json);
  }
  return ok({ ...json, nothingStale });
}
