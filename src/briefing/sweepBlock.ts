/**
 * The pure core of `slopweaver briefing sweep-block`: one supervisor sweep's edit to the fleet-briefing form
 * — the header taken over, the cards a ruling closed dropped, the alignment line set, and one recent block
 * added with the oldest rolled into `earlierToday`.
 *
 * It replaces the supervisor chair's `tick<handoff>-<n>.py`: anything done
 * with Python is done in TypeScript inside Slopweaver and exposed through the CLI. MEASURED: 266 of the 822
 * scripts in `~/.slopweaver/supervisor-scratch/handoff-<n>/` are that one script, copied forward seat to seat
 * with its identity constants retyped (`ls ~/.slopweaver/supervisor-scratch/handoff-<n>/tick*.py | wc -l`).
 *
 * ## Four things the script did that this does not
 *
 * - **It deleted notes.** Past thirty it popped the oldest `earlierToday` note and wrote nothing down. The
 *   schema's own remedy is `briefing archive`, which keeps every note, so an overflow here is REFUSED with
 *   that exact command rather than trimmed.
 * - **It hard-coded prose and identity.** The workspace, handoff and model, the alignment detail's second
 *   sentence and the recent fold's summary were constants in each seat's copy. Each is a flag now, and the
 *   identity fields are required, so no seat can inherit a predecessor's name by copying a file.
 * - **It could be run twice.** A second run inserted a second copy of the block. A block whose headline is
 *   already the newest one is refused.
 * - **It asserted its own caps.** One sentence here, three there, thirty words a sentence. The caps are the
 *   schema's, and the verb validates the whole proposed form against `briefingFormSchema` before it writes.
 *
 * ## The headline is a sentence LIST, refused before it is composed
 *
 * `recent.sentences` is one element per sentence, the first bold. Its cap and wording rules are
 * `./headlineSentences.ts`, applied by every caller at PARSE time — `briefing sweep-block` on its
 * `--headline-sentence` flags, `supervisor tick close` on its input file — so no composed form ever carries an
 * over-cap headline to be discovered by the whole-form schema afterwards. The schema still runs.
 *
 * ## Order: the chair's form is NEWEST-FIRST
 *
 * The block goes to the front of `recent`, and what leaves `recent` goes to the front of `earlierToday`, so
 * the renderer — which emits notes in form order — shows the newest first. `./archive.ts` documents the
 * measurement and trims this order by default, cutting the oldest notes off the end.
 *
 * Pure: raw JSON and flags in, raw JSON or every refusal out.
 */
import { isRecord } from "#lib/parsers.js";
import { err, ok, type Result } from "#lib/result.js";

import type { BriefingNote } from "../outbound/briefing/types.js";
import { SECTION_MAX_NOTES } from "./caps.js";
import { type BriefingError, BriefingErrors, briefingErrorLines } from "./errors.js";
import { headlineSentenceIssues } from "./headlineSentences.js";
import { splitSentences } from "./text.js";

/** The header keys a form may carry. Anything else is refused rather than carried over unexamined. */
const HEADER_KEYS: ReadonlySet<string> = new Set(["handoff", "lede", "model", "pinnedAt", "sleeping", "workspace"]);

/** One sweep's edit, already parsed off the command line. */
export interface SweepBlockInput {
  readonly header: {
    readonly workspace: string;
    readonly handoff: string;
    readonly model: string;
    readonly pinnedAt: string;
    readonly sleeping: boolean;
    /** The new lede, or `undefined` to keep the form's. */
    readonly lede: string | undefined;
  };
  readonly alignment: {
    /** `handover reconcile --json`'s headline, verbatim. */
    readonly headline: string;
    /** Further one-sentence items for the alignment fold, after the headline. */
    readonly details: readonly string[];
    /** The alignment fold's summary, or `undefined` to keep the form's. */
    readonly summary: string | undefined;
    /** `handover reconcile --json`'s `intakeClause`, or `undefined` to keep the form's. */
    readonly intake: string | undefined;
  };
  readonly recent: {
    /** The headline, one sentence per element, the first rendered bold — see `./headlineSentences.ts`. */
    readonly sentences: readonly string[];
    /** Each becomes one list of its own sentences inside the block's fold. */
    readonly folds: readonly string[];
    readonly foldSummary: string;
  };
  /** Each names exactly one me-facing card to drop, by the start of its question. */
  readonly dropCardPrefixes: readonly string[];
  /** How many recent blocks stay open; the rest roll into `earlierToday`. */
  readonly keepRecent: number;
  /** A summary for `earlierToday` when the form carries none and a block has to roll into it. */
  readonly earlierSummary: string | undefined;
}

/** What one sweep-block edit produced. */
export interface SweepBlockOutcome {
  readonly form: Readonly<Record<string, unknown>>;
  /** The questions of the cards dropped, in the order their prefixes were given. */
  readonly droppedQuestions: readonly string[];
  /** How many recent blocks rolled into `earlierToday`. */
  readonly rolled: number;
  readonly recentCount: number;
  readonly earlierCount: number;
}

/**
 * One plain text run.
 *
 * @param text the run's words
 * @returns the run, in the form's own vocabulary
 */
function textRun({ text }: { text: string }): Readonly<Record<string, unknown>> {
  return { kind: "text", text };
}

/**
 * Whether two parsed-JSON values are the same, compared structurally.
 *
 * A serialise-and-compare would be shorter and can THROW — `JSON.stringify` refuses a structure it cannot
 * represent, and this runs on a form a caller supplied. This walk cannot: it only
 * reads, and anything it does not recognise compares unequal rather than failing.
 *
 * @param left one value
 * @param right the other
 * @returns true when the two hold the same data
 */
function sameJson({ left, right }: { left: unknown; right: unknown }): boolean {
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item: unknown, index) => sameJson({ left: item, right: right[index] }))
    );
  }
  if (isRecord(left) || isRecord(right)) {
    if (!isRecord(left) || !isRecord(right)) {
      return false;
    }
    const keys = Object.keys(left);
    return (
      keys.length === Object.keys(right).length &&
      keys.every((key) => Object.hasOwn(right, key) && sameJson({ left: left[key], right: right[key] }))
    );
  }
  return left === right;
}

/**
 * The header with this seat's identity set whole.
 *
 * @param header the form's header as raw JSON
 * @param input this sweep's identity flags
 * @returns the new header, or the refusal
 */
function takeOverHeader({
  header,
  input,
}: {
  header: unknown;
  input: SweepBlockInput["header"];
}): Result<unknown, BriefingError> {
  if (!isRecord(header)) {
    return err(BriefingErrors.formHeaderMissing());
  }
  const unknownKeys = Object.keys(header).filter((key) => !HEADER_KEYS.has(key));
  if (unknownKeys.length > 0) {
    return err(BriefingErrors.formHeaderFieldsRefused({ fields: unknownKeys }));
  }
  const lede = input.lede === undefined ? {} : { lede: [textRun({ text: input.lede })] };
  return ok({
    ...header,
    handoff: input.handoff,
    ...lede,
    model: input.model,
    pinnedAt: input.pinnedAt,
    sleeping: input.sleeping,
    workspace: input.workspace,
  });
}

/**
 * The react-now block with each named card dropped, each prefix matching exactly one card.
 *
 * @param reactNow the form's react-now block as raw JSON
 * @param prefixes the question prefixes to drop
 * @returns the new block and the dropped questions, or every refusal
 */
function dropCards({
  reactNow,
  prefixes,
}: {
  reactNow: unknown;
  prefixes: readonly string[];
}): Result<{ reactNow: unknown; dropped: readonly string[] }, BriefingError> {
  if (prefixes.length === 0) {
    return ok({ dropped: [], reactNow });
  }
  const cards = isRecord(reactNow) ? reactNow["meFacing"] : undefined;
  if (!isRecord(reactNow) || !Array.isArray(cards)) {
    return err(BriefingErrors.cardsMissing());
  }
  const questions = cards.map((card: unknown) =>
    isRecord(card) && typeof card["question"] === "string" ? card["question"] : "",
  );
  const errors: string[] = [];
  const claimed = new Map<number, string>();
  for (const [index, prefix] of prefixes.entries()) {
    if (prefixes.indexOf(prefix) !== index) {
      errors.push(`--drop-card-prefix "${prefix}" is given twice`);
      continue;
    }
    const matches = questions.flatMap((question, at) => (question.startsWith(prefix) ? [at] : []));
    if (matches.length !== 1) {
      errors.push(
        `--drop-card-prefix "${prefix}" matches ${String(matches.length)} me-facing cards; it must match exactly one`,
      );
      continue;
    }
    const at = matches[0]!;
    const other = claimed.get(at);
    if (other !== undefined) {
      errors.push(`--drop-card-prefix "${prefix}" and "${other}" both match the same card`);
      continue;
    }
    claimed.set(at, prefix);
  }
  if (errors.length > 0) {
    return err(BriefingErrors.cardDropRefused({ reasons: errors }));
  }
  // The loop above returned a refusal unless every prefix matched exactly one question, so each finds one.
  const dropped = prefixes.map((prefix) => questions.find((question) => question.startsWith(prefix))!);
  return ok({ dropped, reactNow: { ...reactNow, meFacing: cards.filter((_card: unknown, at) => !claimed.has(at)) } });
}

/** The alignment fold's summary: the one this sweep names, else the one the form's fold already carries. */
function alignmentSummary({ detail, named }: { detail: unknown; named: string | undefined }): string | undefined {
  if (named !== undefined) {
    return named;
  }
  if (isRecord(detail) && typeof detail["summary"] === "string") {
    return detail["summary"];
  }
  return undefined;
}

/**
 * The alignment block with this sweep's headline, detail fold and, when given, intake.
 *
 * @param alignment the form's alignment block as raw JSON
 * @param input this sweep's alignment flags
 * @returns the new block, or the refusal
 */
function setAlignment({
  alignment,
  input,
}: {
  alignment: unknown;
  input: SweepBlockInput["alignment"];
}): Result<unknown, BriefingError> {
  const current = isRecord(alignment) ? alignment : {};
  const summary = alignmentSummary({ detail: current["detail"], named: input.summary });
  if (summary === undefined) {
    return err(BriefingErrors.alignmentDetailMissing());
  }
  const items = [input.headline, ...input.details].map((text) => [textRun({ text })]);
  const intake = input.intake === undefined ? {} : { intake: [textRun({ text: input.intake })] };
  return ok({
    ...current,
    detail: { blocks: [{ items, kind: "list", ordered: false }], summary },
    headline: [textRun({ text: input.headline })],
    ...intake,
  });
}

/**
 * The recent note one sweep adds, typed as the form's own note — the one builder `tick close` composes from and
 * `tick fill` judges, so the note fill checks is byte for byte the note close will render.
 *
 * @param input this sweep's headline sentences, folds and fold summary
 * @returns the note: the headline with its first sentence bold, and one unordered list per fold
 */
export function recentBlock({ input }: { input: SweepBlockInput["recent"] }): BriefingNote {
  return {
    detail: {
      blocks: input.folds.map((fold) => ({
        items: splitSentences({ text: fold }).map((sentence) => [{ kind: "text", text: sentence }]),
        kind: "list",
        ordered: false,
      })),
      summary: input.foldSummary,
    },
    headline: input.sentences.map((sentence, index) =>
      index === 0 ? { kind: "strong", text: sentence } : { kind: "text", text: ` ${sentence}` },
    ),
  };
}

/**
 * `recent` with the new block at the front, and `earlierToday` with whatever left the window at ITS front.
 *
 * @param form the form as raw JSON
 * @param input the whole sweep edit
 * @returns the two sections and how many blocks rolled, or the refusal
 */
function rollRecent({
  form,
  input,
}: {
  form: Readonly<Record<string, unknown>>;
  input: SweepBlockInput;
}): Result<{ recent: readonly unknown[]; earlierToday: unknown; rolled: number; earlierCount: number }, BriefingError> {
  const recent = form["recent"];
  if (!Array.isArray(recent)) {
    return err(BriefingErrors.recentSectionMissing());
  }
  const block = recentBlock({ input: input.recent });
  const newest: unknown = recent[0];
  if (isRecord(newest) && sameJson({ left: newest["headline"], right: block.headline })) {
    return err(BriefingErrors.recentBlockDuplicate());
  }
  const window = [block, ...recent];
  const overflow = window.slice(input.keepRecent);
  const earlier = form["earlierToday"];
  if (overflow.length === 0) {
    const earlierCount = isRecord(earlier) && Array.isArray(earlier["notes"]) ? earlier["notes"].length : 0;
    return ok({ earlierCount, earlierToday: earlier, recent: window, rolled: 0 });
  }
  const section = sectionToRollInto({ earlier, earlierSummary: input.earlierSummary });
  if (section.isErr()) {
    return err(section.error);
  }
  const notes = [...overflow, ...section.value.notes];
  if (notes.length > SECTION_MAX_NOTES) {
    return err(
      BriefingErrors.recentRollOverCap({ cap: SECTION_MAX_NOTES, notes: notes.length, rolling: overflow.length }),
    );
  }
  return ok({
    earlierCount: notes.length,
    earlierToday: { ...section.value.section, notes },
    recent: window.slice(0, input.keepRecent),
    rolled: overflow.length,
  });
}

/**
 * The `earlierToday` section a rolled block goes into, created only when a summary was given for it.
 *
 * @param earlier the form's `earlierToday` as raw JSON
 * @param earlierSummary the summary to create the section with, when the form has none
 * @returns the section and its current notes, or the refusal
 */
function sectionToRollInto({
  earlier,
  earlierSummary,
}: {
  earlier: unknown;
  earlierSummary: string | undefined;
}): Result<{ section: Readonly<Record<string, unknown>>; notes: readonly unknown[] }, BriefingError> {
  if (earlier === undefined) {
    if (earlierSummary === undefined) {
      return err(BriefingErrors.earlierSummaryMissing());
    }
    return ok({ notes: [], section: { summary: earlierSummary } });
  }
  if (!isRecord(earlier) || !Array.isArray(earlier["notes"])) {
    return err(BriefingErrors.earlierSectionInvalid());
  }
  return ok({ notes: earlier["notes"], section: earlier });
}

/**
 * Apply one sweep's edit to a form.
 *
 * Every refusal is collected rather than stopping at the first, so one run names everything wrong with the
 * invocation. Nothing here writes: a refusal leaves the form exactly as the caller read it.
 *
 * @param form the form as parsed JSON
 * @param input the sweep's edit, parsed off the command line
 * @returns the edited form and what changed, or every refusal
 */
export function applySweepBlock({
  form,
  input,
}: {
  form: unknown;
  input: SweepBlockInput;
}): Result<SweepBlockOutcome, BriefingError> {
  if (!isRecord(form)) {
    return err(BriefingErrors.formNotObject());
  }
  const header = takeOverHeader({ header: form["header"], input: input.header });
  const cards = dropCards({ prefixes: input.dropCardPrefixes, reactNow: form["reactNow"] });
  const alignment = setAlignment({ alignment: form["alignment"], input: input.alignment });
  const rolled = rollRecent({ form, input });
  // Every caller already refused these at parse time; asking again here is what keeps a new caller from
  // composing an over-cap headline by skipping that step.
  const headline = headlineSentenceIssues({ field: "recent.sentences", sentences: input.recent.sentences });
  const errors = [
    ...headline,
    ...[header, cards, alignment, rolled].flatMap((part) =>
      part.isErr() ? briefingErrorLines({ error: part.error }) : [],
    ),
  ];
  if (headline.length > 0 || header.isErr() || cards.isErr() || alignment.isErr() || rolled.isErr()) {
    return err(BriefingErrors.sweepRefused({ reasons: errors }));
  }
  const earlier = rolled.value.earlierToday === undefined ? {} : { earlierToday: rolled.value.earlierToday };
  return ok({
    droppedQuestions: cards.value.dropped,
    earlierCount: rolled.value.earlierCount,
    form: {
      ...form,
      alignment: alignment.value,
      ...earlier,
      header: header.value,
      reactNow: cards.value.reactNow,
      recent: rolled.value.recent,
    },
    recentCount: rolled.value.recent.length,
    rolled: rolled.value.rolled,
  });
}
