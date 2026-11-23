/**
 * The three narrative sections `--ticks` projects, and the quoted-lane refusal that guards them without it.
 *
 * Split out of `./renderCore.ts` on size, along the one seam in it that is a single concept: `recent`,
 * `earlierToday` and `history` go in together or not at all, and the refusal of a composed quoted lane reads
 * the same three fields. Nothing here reads the filesystem or the clock; the sections arrive already
 * projected, from `../../../briefing/narrative.ts`.
 */
import { isRecord } from "#lib/parsers.js";
import { ok, type Result } from "#lib/result.js";
import type { BriefingNote, BriefingSection } from "../../../outbound/briefing/types.js";
import type { BriefingCommandError } from "./errors.js";
import { refuseComposedProjection } from "./injectSections.js";

/**
 * Splice in the three PROJECTED narrative sections, refusing a form that wrote any of them itself.
 *
 * ATOMIC, which is the one property this differs from every other injection in: `recent`, `earlierToday` and
 * `history` are one account of the same recorded passes, so a page carrying a projected `recent` beside an
 * authored `history` would be two different answers to "what happened" stacked on one page, with nothing
 * saying which is which. So the run either writes all three or writes none, and a form supplying ANY of them
 * is refused with every conflicting field named in one line rather than one per render.
 *
 * Without `--ticks` this does nothing at all and the authored path is byte-for-byte what it always was. That
 * is the opt-in half — see `./core.ts`'s `ticksSource`.
 *
 * @param json the parsed form, before validation
 * @param narrative the projected sections, absent when the run was given no `--ticks`
 * @returns the form with all three sections attached, or the refusal
 */
export function injectNarrative({
  json,
  narrative,
}: {
  json: unknown;
  narrative: BriefingNarrativeSections | undefined;
}): Result<unknown, BriefingCommandError> {
  if (narrative === undefined) {
    return composedQuotedLane({ json });
  }
  const authored = NARRATIVE_FIELDS.filter((field) => isRecord(json) && json[field] !== undefined);
  if (authored.length > 0) {
    return refuseComposedProjection({
      field: authored.join("`, `"),
      why:
        "With `--ticks` all three of `recent`, `earlierToday` and `history` are projected from the " +
        "supervisor tick ledger, never composed — and they go in TOGETHER, because they are one account of " +
        "the same recorded passes and a page carrying a projected half beside an authored half would be two " +
        "answers to the same question with nothing saying which is which. Drop them from the form, or drop " +
        "`--ticks` and keep writing all three.",
    });
  }
  if (!isRecord(json)) {
    return ok(json);
  }
  return ok({
    ...json,
    earlierToday: narrative.earlierToday,
    history: narrative.history,
    recent: narrative.recent,
  });
}

/** The three fields `--ticks` owns, named once so the refusal and the splice cannot disagree. */
const NARRATIVE_FIELDS: readonly string[] = ["recent", "earlierToday", "history"];

/**
 * Refuse a COMPOSED form that marked one of its own notes `lane: "quoted"`.
 *
 * The quoted lane lifts four rules at once — the bare-key-link rule, the packed-enumeration and
 * truncated-ellipsis refusals, and the plain-wording gate — on the single ground that nobody here wrote the
 * words. That ground holds for a projection and for nothing else, so without `--ticks` there is no way for
 * the lane to be true, and a form carrying it would be a session lifting its own prose out of four gates by
 * typing one field.
 *
 * Found by review, which is the point: the schema cannot tell a projected note from a typed
 * one, because by the time it parses they are the same document. The RUN can, and this is where it knows.
 *
 * @param json the parsed form, before validation
 * @returns the form unchanged, or the refusal
 */
function composedQuotedLane({ json }: { json: unknown }): Result<unknown, BriefingCommandError> {
  const marked = NARRATIVE_FIELDS.filter((field) => isRecord(json) && quotedNoteIn({ value: json[field] }));
  if (marked.length === 0) {
    return ok(json);
  }
  return refuseComposedProjection({
    field: marked.join("`, `"),
    why:
      'One of its notes is marked `lane: "quoted"` and this run projected nothing. That lane lifts the ' +
      "bare-key-link, packed-enumeration, truncated-ellipsis and plain-wording rules on the one ground that " +
      "nobody here composed the words, which is true of a projection and of nothing a form can write. Drop " +
      "the lane, or pass `--ticks <path|->` and let the ledger fill the section.",
  });
}

/**
 * Whether any note anywhere under one form field carries the quoted lane.
 *
 * A walk rather than a field read, because `history` is an array of sections and `earlierToday` is one —
 * a check shaped to either would miss the other.
 *
 * @param value the field's raw value, in whatever shape the form wrote it
 * @returns true when a quoted note is somewhere inside it
 */
function quotedNoteIn({ value }: { value: unknown }): boolean {
  if (Array.isArray(value)) {
    return value.some((entry) => quotedNoteIn({ value: entry }));
  }
  if (!isRecord(value)) {
    return false;
  }
  if (value["lane"] === "quoted") {
    return true;
  }
  return Object.values(value).some((entry) => quotedNoteIn({ value: entry }));
}

/**
 * The three narrative sections as the projection produced them.
 *
 * @internal — the slice of `../../../briefing/narrative.ts`'s projection this file splices in.
 */
export interface BriefingNarrativeSections {
  readonly recent: readonly BriefingNote[];
  readonly earlierToday: BriefingSection;
  readonly history: readonly BriefingSection[];
}
