/**
 * The answer form's EVIDENCE half — what an answer read, what it consulted and came back empty from, what
 * premises it checked, what stood in for a real artifact, what it could not see, and how it was produced.
 *
 * Split out of `./answerForm.ts` along the seam that file's own header already draws: `answerForm.ts`
 * declares the answer and what it may hold, and every one of the three live grounding kinds
 * (`conversation`, `verb`, `unreachable`) carries the SAME evidence and provenance shape declared here. A
 * reader asking "what may an answer claim to have looked at" has one file to open, and `answerForm.ts`
 * keeps the answer's own fields readable.
 *
 * Nothing here reads a clock. Every instant on these schemas — a premise check's `checkedAtIso` — is
 * session-authored, for the reason `../../live/turn/answer.ts`'s header gives: these modules stay
 * deterministic so a form is a function of what the session says, never of when it said it.
 */
import { z } from "zod";

import { cappedList } from "../cappedList.js";
import { strictForm } from "../strictForm.js";
import {
  BULLETS_MAX_ITEMS,
  EVIDENCE_LABEL_VISIBLE_MAX,
  EXECUTION_LIST_MAX,
  PARAGRAPH_VISIBLE_MAX,
} from "./contentLimits.js";

/**
 * One evidence line: a short label, and an OPTIONAL url.
 *
 * Shared by `verb`/`unreachable` grounding's `read` and `consultedEmpty` — the corpus/no-corpus asymmetry
 * that used to split these into two shapes no longer applies once a live route owns both: a live
 * investigation's "read" can be a linkable dashboard or an unaddressable whole surface, exactly like its
 * "consulted, found nothing" can. Forcing a url on either would mean minting one for a place that has none.
 */
const evidenceLineSchema = strictForm({
  label: z.string().min(1).max(EVIDENCE_LABEL_VISIBLE_MAX),
  url: z.url().optional(),
});

/**
 * The non-empty half of `couldNotSee`: real blind spots, named. No `reason` field exists on this branch —
 * a populated list is its own justification.
 */
const couldNotSeeWithItemsSchema = strictForm({
  blindSpots: cappedList({
    list: z.array(z.string().min(1).max(PARAGRAPH_VISIBLE_MAX)).min(1),
    max: BULLETS_MAX_ITEMS,
    message: `\`couldNotSee\` names at most ${String(BULLETS_MAX_ITEMS)} blind spots; keep the ones that change the answer.`,
  }),
});

/**
 * The empty half of `couldNotSee`: nothing was out of reach, but that claim needs a reason or it reads as
 * "nobody checked". `blindSpots` must be the empty array on this branch — a non-empty list belongs to
 * {@link couldNotSeeWithItemsSchema} instead, and `reason` does not exist there.
 */
const couldNotSeeWithReasonSchema = strictForm({
  blindSpots: z.array(z.string().min(1)).length(0),
  reason: z.string().min(1).max(PARAGRAPH_VISIBLE_MAX),
});

/**
 * What a live-grounded answer could not see — a STRUCTURAL union, not an optional field with a runtime
 * check.
 *
 * The owner's ruling: an empty `couldNotSee` must be justified rather than omitted. Expressing that as
 * `{ blindSpots: string[]; reason?: string }` plus a `superRefine` would still let a schema COMPILE with the
 * reason silently absent; the two-branch union instead makes "empty list, no reason" a shape that cannot be
 * constructed at all; the type checker enforces it, not a reviewer.
 */
export const couldNotSeeSchema = z.union([couldNotSeeWithItemsSchema, couldNotSeeWithReasonSchema]);

/**
 * One PRESENT-STATE CHECK of a premise the ask assumes — what was looked for, what was found, and when.
 *
 * Separate from `read` rather than folded into it, because a premise check is not the same kind of thing as
 * a source consulted. It carries a VERDICT (`finding`) and an INSTANT (`checkedAtIso`), and both matter:
 * "the repo does not exist as of <instant>" is a claim a reader can date and re-run, while a `read`
 * line naming the same command says only that something was looked at. The rejected answer had
 * plenty of `read` lines; what it had none of was this.
 *
 * `checkedAtIso` is session-authored like the rest of the form — nothing here reads a clock (see
 * `../../live/turn/answer.ts`'s header on why these modules stay deterministic). `inconclusive` is a real
 * third finding rather than a hedge: a check that could not settle it is worth stating, and stating it is
 * what stops the premise being assumed by default.
 */
const premiseCheckSchema = strictForm({
  checkedAtIso: z.iso.datetime(),
  finding: z.enum(["exists", "absent", "inconclusive"]),
  /** How it was checked — the verb or surface, short enough to render as one bullet. */
  how: z.string().min(1).max(EVIDENCE_LABEL_VISIBLE_MAX),
  /** What was looked for, named the way the ask names it. */
  subject: z.string().min(1).max(EVIDENCE_LABEL_VISIBLE_MAX),
  url: z.url().optional(),
});

/**
 * One REAL artifact this turn could not produce, and why it could not — the say-why half of
 * `../../admit/realArtifact.ts`'s real-evidence-or-say-why rule.
 *
 * A THIRD field is deliberately absent. What was handed over instead is already in the answer's own
 * `images` and `body`; naming it again would be a caption a composer writes to satisfy a schema. What is not
 * anywhere else, and is the entire owner complaint, is the REASON — of an answer
 * that said the monitors were never deployed and stopped there, without saying why not. Both fields carry a `min(1)`, so an entry cannot exist without one.
 */
const substitutedForRealSchema = strictForm({
  /** The real artifact that would have proved the claim — a deployed thing's own panel, its live link. */
  real: z.string().min(1).max(EVIDENCE_LABEL_VISIBLE_MAX),
  /** One line: why THIS turn could not produce it. Not that it is absent — why it is absent. */
  why: z.string().min(1).max(PARAGRAPH_VISIBLE_MAX),
});

/**
 * What a `verb`/`unreachable`-grounded answer session-authors: the premises it checked, what it read, what
 * it consulted and came back empty, and what it could not see. There is no corpus counterpart — a `corpus`
 * answer's evidence is derived from the real `CoverageManifest`, never accepted as input. See this file's
 * header.
 *
 * `premiseChecks` defaults to empty, so no existing answer shape changes; a PROPOSAL-shaped ask is where it
 * stops being optional, and that is enforced by `../../live/turn/briefAnswerable.ts`'s `validateAnswerForDispatch`
 * rather than here — the schema cannot see the question the answer replies to. `substitutedForReal` defaults
 * to empty for the same reason and stops being optional in the same place: only the question says whether a
 * real artifact was available to substitute FOR, so `../../admit/realArtifactGate.ts` decides that at the
 * door.
 */
export const evidenceSchema = strictForm({
  consultedEmpty: z.array(evidenceLineSchema).max(BULLETS_MAX_ITEMS).default([]),
  couldNotSee: couldNotSeeSchema,
  premiseChecks: z.array(premiseCheckSchema).max(BULLETS_MAX_ITEMS).default([]),
  read: z.array(evidenceLineSchema).max(BULLETS_MAX_ITEMS).default([]),
  substitutedForReal: z.array(substitutedForRealSchema).max(BULLETS_MAX_ITEMS).default([]),
});

/**
 * How ANY live-grounded answer was produced — `conversation`, `verb` and `unreachable` all share this: none
 * of the three has an independent oracle to derive provenance from, so all three are session-authored alike.
 */
export const executionProvenanceSchema = strictForm({
  model: z.string().min(1).max(EVIDENCE_LABEL_VISIBLE_MAX),
  skillsLoaded: z.array(z.string().min(1).max(EVIDENCE_LABEL_VISIBLE_MAX)).max(EXECUTION_LIST_MAX),
  verbsLoaded: z.array(z.string().min(1).max(EVIDENCE_LABEL_VISIBLE_MAX)).max(EXECUTION_LIST_MAX),
});
