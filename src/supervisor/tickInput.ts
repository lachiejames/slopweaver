/**
 * The file a chair authors for `slopweaver supervisor tick close` — everything a sweep decides that no verb
 * can derive, and nothing else — and the one parser it passes through.
 *
 * ## Why a file, and why strict
 *
 * The chair's pass used to be one long line of shell per sweep: `briefing archive`, then `briefing
 * sweep-block` with every fold as a quoted flag, then a hand-built `actions.json` and `judgements.json`, then
 * `tick-draft`, `tick-record` and a publish tail. MEASURED over twenty of the chair's passes: the headline cap refused five of them after the fact, an
 * action with an outcome the ledger does not know was only refused at `tick-record`, AFTER the page had
 * already published. Here every field is refused at parse time, each naming its path, and nothing has been
 * written when it is.
 *
 * `recordedIso` is not authored: the close stamps one instant on every action and judgement, so a pass cannot
 * carry an instant copied from the last one. It is refused as an unknown key rather than silently replaced.
 *
 * The action and judgement shapes are the LEDGER's own (`./tickSchema.ts`), less that one field — one list of
 * kinds, outcomes and subjects, read by both doors, so the file cannot accept what the ledger would refuse.
 *
 * Pure: a parsed JSON value and an instant in, a typed input or every issue out.
 */
import { z } from "zod";

import { err, ok, type Result } from "#lib/result.js";

import { headlineSentenceIssues } from "../briefing/headlineSentences.js";
import { FOLD_SUMMARY_MAX, foldSummary } from "../outbound/briefing/vocabulary.js";
import { type AuthoredJudgement, authoredJudgementSchema } from "./tickAuthoredJudgement.js";
import { actionSchema } from "./tickSchema.js";
import { type TickWorkflowError, TickWorkflowErrors } from "./tickWorkflowErrors.js";

/** The one input schema version this build reads. */
const TICK_INPUT_SCHEMA_VERSION = 1;

/**
 * One action as a sweep AUTHORS it: the ledger's own shape less `recordedIso`, which the close stamps.
 *
 * Derived from the ledger's schema rather than restated, so a tick file can never carry a kind, an outcome or
 * a subject the ledger would refuse — one list, read by both doors.
 */
export const authoredActionSchema = actionSchema.omit({ recordedIso: true }).strict();

/** One authored action — what `tick open` pre-fills and the chair adds to. */
export type AuthoredAction = z.output<typeof authoredActionSchema>;

/** A non-empty string after trimming — an empty fold or sentence is a hole, never a choice. */
const text = z.string().trim().min(1);

/** The authored file, strict at every level. */
const tickInputSchema = z
  .object({
    actions: z.array(authoredActionSchema),
    alignmentDetails: z.array(text).optional(),
    alignmentSummary: text.optional(),
    dropCards: z.array(text).optional(),
    earlierSummary: text.optional(),
    foldSummary: text,
    folds: z.array(text).min(1),
    headline: z.object({ sentences: z.array(z.string()) }).strict(),
    judgements: z.array(authoredJudgementSchema),
    lede: text.optional(),
    openPagesReviewed: z.boolean(),
    schemaVersion: z.literal(TICK_INPUT_SCHEMA_VERSION),
    shift: z.string().nullable(),
    sleeping: z.boolean(),
  })
  .strict();

/** One authored action, stamped with the close's instant. */
type StampedAction = z.output<typeof authoredActionSchema> & { readonly recordedIso: string };

/** One authored judgement, stamped with the close's instant. */
type StampedJudgement = AuthoredJudgement & { readonly recordedIso: string };

/** A validated tick file, every optional list made explicit and every row stamped. */
export interface TickInput {
  readonly sleeping: boolean;
  readonly lede: string | undefined;
  readonly headline: readonly string[];
  readonly folds: readonly string[];
  readonly foldSummary: string;
  readonly dropCards: readonly string[];
  readonly alignmentDetails: readonly string[];
  readonly alignmentSummary: string | undefined;
  readonly earlierSummary: string | undefined;
  /**
   * The chair re-read every open page this pass. `briefing render` refuses an `open-pages.json` older than
   * ninety minutes, and the file is only ever rewritten by a sweep that looked at it — so this is that look,
   * said out loud, and `false` leaves the file for the render's own age gate to judge.
   */
  readonly openPagesReviewed: boolean;
  readonly actions: readonly StampedAction[];
  readonly judgements: readonly StampedJudgement[];
  /** The next sweep's shift state; `null` is the quiet line, never an empty string typed by hand. */
  readonly shift: string | null;
}

/**
 * A list the file may omit, as the empty list — spelled as a destructured default, never a coalesce.
 *
 * @param list the parsed optional list
 * @returns the list, or an empty one when the file carried none
 */
function listOf<T>({ list = [] }: { list: readonly T[] | undefined }): readonly T[] {
  return list;
}

/**
 * One Zod issue as `path: message`, naming the path the chair has to fix.
 *
 * @param issue the issue
 * @returns the display line
 */
function issueLine({ issue }: { issue: z.core.$ZodIssue }): string {
  const path = issue.path.map(String).join(".");
  if (path.length === 0) {
    return `(the file): ${issue.message}`;
  }
  return `${path}: ${issue.message}`;
}

/** Just the headline, read loosely, so its sentences are judged even when a sibling field is malformed. */
const headlineOnlySchema = z.object({ headline: z.object({ sentences: z.array(z.string()) }) });

/**
 * The headline's sentence issues, whenever the headline itself is a list of strings.
 *
 * @param value the file as parsed JSON, valid or not
 * @returns every count and wording defect, or none when the headline is absent or not a string list
 */
function headlineIssues({ value }: { value: unknown }): readonly string[] {
  const parsed = headlineOnlySchema.safeParse(value);
  if (!parsed.success) {
    return [];
  }
  return headlineSentenceIssues({ field: "headline.sentences", sentences: parsed.data.headline.sentences });
}

/** Just the fold summary, trimmed as {@link text} trims it, so it is judged beside a malformed sibling. */
const foldSummaryOnlySchema = z.object({ foldSummary: z.string().trim().min(1) });

/**
 * The fold summary's issues against the page's own `foldSummary` schema, at READ rather than at render.
 *
 * The summary becomes the briefing's `recent` fold summary, and the render refuses an over-cap one as
 * `recent.0.detail.summary` — a path the chair never typed. MEASURED on one chair's tick 989: a 127-character
 * summary was refused that way through fifteen-plus closes, and trimming only it closed the pass end to end.
 * Judging it here names the field the chair authored and its length against the cap.
 *
 * @param value the file as parsed JSON, valid or not
 * @returns the cap and ellipsis defects, or none when the summary is absent, empty or not a string
 */
function foldSummaryIssues({ value }: { value: unknown }): readonly string[] {
  const loose = foldSummaryOnlySchema.safeParse(value);
  if (!loose.success) {
    return [];
  }
  const summary = loose.data.foldSummary;
  const judged = foldSummary.safeParse(summary);
  if (judged.success) {
    return [];
  }
  return judged.error.issues.map((issue) => {
    if (issue.code === "too_big") {
      return `foldSummary: ${String(summary.length)} chars, cap ${String(FOLD_SUMMARY_MAX)}`;
    }
    return `foldSummary: ${issue.message}`;
  });
}

/**
 * Parse and stamp one authored tick file.
 *
 * Every issue is collected: a schema refusal names each field, and the headline is judged against
 * `../briefing/headlineSentences.ts` — the same rule `briefing sweep-block` applies — whether or not a sibling field
 * was malformed, so one refusal carries every defect.
 *
 * @param value the file as parsed JSON
 * @param recordedIso the close's one instant, stamped on every action and judgement
 * @returns the validated input, or every issue naming its path
 */
export function parseTickInput({
  value,
  recordedIso,
}: {
  value: unknown;
  recordedIso: string;
}): Result<TickInput, TickWorkflowError> {
  const parsed = tickInputSchema.safeParse(value);
  const judged = [...foldSummaryIssues({ value }), ...headlineIssues({ value })];
  if (!parsed.success) {
    const schema = parsed.error.issues.map((issue) => issueLine({ issue }));
    return err(TickWorkflowErrors.inputInvalid({ issues: [...schema, ...judged] }));
  }
  if (judged.length > 0) {
    return err(TickWorkflowErrors.inputInvalid({ issues: judged }));
  }
  const raw = parsed.data;
  return ok({
    actions: raw.actions.map((action) => ({ ...action, recordedIso })),
    alignmentDetails: listOf({ list: raw.alignmentDetails }),
    alignmentSummary: raw.alignmentSummary,
    dropCards: listOf({ list: raw.dropCards }),
    earlierSummary: raw.earlierSummary,
    foldSummary: raw.foldSummary,
    folds: raw.folds,
    headline: raw.headline.sentences,
    judgements: raw.judgements.map((judgement) => ({ ...judgement, recordedIso })),
    lede: raw.lede,
    openPagesReviewed: raw.openPagesReviewed,
    shift: raw.shift,
    sleeping: raw.sleeping,
  });
}

/**
 * The template `tick open` writes: every field present, every authored one empty, so the chair fills a
 * shape rather than remembering one. It does NOT pass {@link parseTickInput} as written — an empty headline
 * and no folds are refused — which is the point: a template closed unedited is refused, not published.
 *
 * @param derivedActions actions the capture already witnesses, carried so the chair does not retype them
 * @returns the template document
 */
export function tickInputTemplate({
  derivedActions,
}: {
  derivedActions: readonly AuthoredAction[];
}): Readonly<Record<string, unknown>> {
  return {
    schemaVersion: TICK_INPUT_SCHEMA_VERSION,
    sleeping: false,
    headline: { sentences: [] },
    folds: [],
    foldSummary: "",
    dropCards: [],
    alignmentDetails: [],
    openPagesReviewed: false,
    actions: derivedActions,
    judgements: [],
    shift: null,
  };
}
