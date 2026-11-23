/**
 * The pure core of `slopweaver handover set-priority` (`./setPriorityRun.ts`): what one row needs for a request,
 * and what the verb's flags ask for. No file is read or written here; the run file is the shell that does both.
 */
import { type HandoverDoc, PRIORITY_FROM_DEFAULT } from "../../../handover/doc.js";
import { asBoardPriority, BOARD_PRIORITIES, type BoardPriority, DEFAULT_PRIORITY } from "../../../handover/rowKind.js";

/** The front-matter change one row needs: the fields to set and the keys to drop. */
interface PriorityEdit {
  readonly set: readonly { readonly key: string; readonly value: string }[];
  readonly remove: readonly string[];
}

/** What one row needs, as judged on the row read NOW. */
export type PriorityPlan =
  | { readonly kind: "edit"; readonly edit: PriorityEdit; readonly priority: BoardPriority }
  | { readonly kind: "unchanged" }
  | { readonly kind: "refused"; readonly problem: string };

/** What a caller asked for one row: a band somebody chose, or the row's own default written down. */
export type PriorityRequest =
  { readonly kind: "set"; readonly priority: BoardPriority; readonly because: string } | { readonly kind: "backfill" };

/**
 * Judge what one row needs for a request. Pure: the row in, the edit out.
 *
 * A chosen band replaces whatever the row states and drops the backfill marker, unless the row already states
 * that band as a choice. A backfill touches only a row that declares nothing, so it can never overwrite a band.
 *
 * @param doc the row, as read now
 * @param request a chosen band, or the backfill
 * @returns the edit, `unchanged`, or the refusal naming why nothing may be written
 */
export function priorityPlan({ doc, request }: { doc: HandoverDoc; request: PriorityRequest }): PriorityPlan {
  if (doc.problems.length > 0) {
    return { kind: "refused", problem: `${doc.slug} does not parse cleanly: ${doc.problems[0]!}` };
  }
  if (request.kind === "backfill") {
    if (doc.priority !== undefined) {
      return { kind: "unchanged" };
    }
    const priority = DEFAULT_PRIORITY[doc.kind];
    return {
      edit: {
        remove: [],
        set: [
          { key: "priority", value: priority },
          { key: "priorityFrom", value: PRIORITY_FROM_DEFAULT },
        ],
      },
      kind: "edit",
      priority,
    };
  }
  if (doc.priority === request.priority && doc.priorityFrom === undefined) {
    return { kind: "unchanged" };
  }
  return {
    edit: {
      remove: ["priorityFrom"],
      set: [
        { key: "priority", value: request.priority },
        { key: "priorityBecause", value: JSON.stringify(request.because) },
      ],
    },
    kind: "edit",
    priority: request.priority,
  };
}

/** What the verb's flags ask for, judged before the board is read. */
export type SetPriorityMode =
  | { readonly kind: "backfill"; readonly apply: boolean }
  | { readonly kind: "set"; readonly slugs: readonly string[]; readonly request: PriorityRequest & { kind: "set" } }
  | { readonly kind: "usage"; readonly problem: string };

/**
 * Judge the flags of a named-row write. Pure.
 *
 * @param positionals the slugs named
 * @param values the parsed flag values
 * @returns the set request, or the usage refusal
 */
function setModeOf({
  positionals,
  values,
}: {
  positionals: readonly string[];
  values: Readonly<Record<string, unknown>>;
}): SetPriorityMode {
  const priorityFlag = values["priority"];
  const requested = asBoardPriority({ value: typeof priorityFlag === "string" ? priorityFlag : undefined });
  const becauseFlag = values["because"];
  const because = typeof becauseFlag === "string" ? becauseFlag.trim() : "";
  if (values["apply"] === true) {
    return { kind: "usage", problem: "--apply belongs to --backfill; a named row is written directly" };
  }
  if (positionals.length === 0) {
    return { kind: "usage", problem: "which row? Pass at least one slug, or --backfill" };
  }
  if (requested === undefined) {
    return { kind: "usage", problem: `--priority must be one of ${BOARD_PRIORITIES.join("|")}` };
  }
  if (because.length === 0) {
    return { kind: "usage", problem: "--because is required: the row carries why it sits in this band" };
  }
  return { kind: "set", request: { because, kind: "set", priority: requested }, slugs: positionals };
}

/**
 * Judge what the verb's flags ask for. Pure.
 *
 * @param positionals the slugs named
 * @param values the parsed flag values
 * @returns the backfill, the set request, or the usage refusal
 */
export function setPriorityModeOf({
  positionals,
  values,
}: {
  positionals: readonly string[];
  values: Readonly<Record<string, unknown>>;
}): SetPriorityMode {
  if (values["backfill"] !== true) {
    return setModeOf({ positionals, values });
  }
  const namesARowOrBand = positionals.length > 0 || values["priority"] !== undefined || values["because"] !== undefined;
  if (namesARowOrBand) {
    return { kind: "usage", problem: "--backfill names no row and no band: it writes each row's own default" };
  }
  return { apply: values["apply"] === true, kind: "backfill" };
}
