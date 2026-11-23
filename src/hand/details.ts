/**
 * The lines a hand step keeps BEHIND its note's disclosure row — what the owner reads only when they choose to.
 *
 * The fleet-health note lists what is failing, when it failed and why, as a drop down with progressive disclosure
 * on the floating note. Rule 7 is the
 * shape: the sentence above the fold stays one line the owner cannot avoid, and everything else is collapsed behind a
 * row they open (`./note/panel.ts`).
 *
 * ## Capped by the SCHEMA, and refused rather than cut
 *
 * Collapsed is not unbounded: opened, the list still has to fit a note, and a list a poster could grow without
 * limit is the wall of text rule 7 forbids, only one click further down. So the register refuses a list past
 * {@link DETAILS_MAX} lines or a line past {@link DETAIL_LINE_CAP}, and a poster composes INSIDE the caps — the
 * fleet-health monitor ends a longer list on a line naming the verb that prints all of it. A cut here would put a
 * list on the owner's screen that reads whole and is not.
 *
 * ## Drawn as entries, not as a monospaced run
 *
 * The opened list needs proper formatting and scrolls. A
 * line stays one string in the register, and {@link detailEntry} reads it into the entry the note draws: its status
 * label, name and age on a first line, its reason as wrapped prose under it. The HEIGHT the list may take is the
 * note's scroll cap (`./note/details.ts`), so neither cap here is what keeps the buttons on the display.
 *
 * Pure: a value in, the lines or a refusal out.
 */
import { err, ok, type Result } from "../lib/result.js";

import { type HandStepError, HandStepErrors } from "./errors.js";

/**
 * The most lines a step's details may carry — a list the owner reads, never a log they scroll through.
 *
 * Height is not what this bounds: the opened region scrolls inside its own cap. It bounds how much a poster may
 * put behind the row before it has to name the verb that prints the rest.
 */
export const DETAILS_MAX = 12;

/**
 * The longest one detail line may be — a row id, an age, a count and a reason of a sentence or two, never a
 * paragraph.
 *
 * Wide enough that a fleet-health reason is carried whole rather than cut mid-sentence, which is what the 160 it
 * replaced did to the note the owner read; a poster that still has to cut marks the cut (`…`).
 */
export const DETAIL_LINE_CAP = 320;

/**
 * The status labels a detail line may open with — exactly the ones the fleet-health lines carry
 * (`../monitor/fleetHealthDelta.ts`). A closed set rather than any capitalised word, so a free-form line opening
 * `API errors …` keeps its first word as its own.
 */
export const DETAIL_STATUSES = ["NEW", "STILL", "FIXED", "PAST", "BACK"] as const;

/**
 * How a reason opens when the row's next step is the owner's: they can act from the list without going to the
 * supervisor to ask, so the note puts a button in front of them. The composer (`../monitor/fleetHealthDelta.ts`)
 * writes it and {@link detailEntry} reads it, so
 * the words and the note's count of rows that need the owner cannot drift apart.
 */
export const NEEDS_YOU = "Needs you";

/** How a reason opens when the fleet is already acting on the row, so nothing on it is the owner's. */
export const NOTHING_FOR_YOU = "Nothing for you";

/**
 * The marker a line ENDS with when its row's step is an open hand card: ` [hand:<step id>]`. The note draws it as a
 * control opening that card on the queue (`./note/details.ts`), never as text. The id is the register's own shape
 * (`./step.ts`), so a bracket that is not one stays part of the reason.
 */
const ACT_MARKER = / \[hand:([a-z0-9]+(?:[-.][a-z0-9]+)*)\]$/u;

/**
 * The marker naming an open hand card, as a line ends with it.
 *
 * @param id the open card's step id
 * @returns ` [hand:<id>]`
 */
export function detailActMarker({ id }: { id: string }): string {
  return ` [hand:${id}]`;
}

/** One detail line as the note draws it; a part the line does not carry is the empty string. */
export interface DetailEntry {
  /** One of {@link DETAIL_STATUSES}, or empty. */
  readonly status: string;
  /** What the line is about — a recipe id, the bot. */
  readonly name: string;
  /** Its age and count, when the line carries them: `45m ago, 3× in 24h`. */
  readonly meta: string;
  /** Why, as prose, with any act marker taken off. */
  readonly reason: string;
  /** `you` when the reason opens {@link NEEDS_YOU}, `fleet` when it opens {@link NOTHING_FOR_YOU}, else empty. */
  readonly owner: "you" | "fleet" | "";
  /** The open hand card the line's act marker names, or empty. */
  readonly act: string;
}

/**
 * Read one detail line into the entry the note draws.
 *
 * The shape is the fleet-health one — `STATUS name — meta: reason [hand:<id>]` — and every part is optional: a tail
 * after ` — ` with no `: ` in it is all reason (`FIXED id — last failed 2h ago, its newest run succeeded`), and a line
 * with no ` — ` at all is all name. The spaces that padded a status to one width in a monospaced run are dropped.
 *
 * @param line one checked detail line
 * @returns its status, name, meta, reason, whose step it is, and the card its marker names
 */
export function detailEntry({ line }: { line: string }): DetailEntry {
  const marker = ACT_MARKER.exec(line);
  const act = marker === null ? "" : marker[1]!;
  const body = marker === null ? line : line.slice(0, marker.index);
  const space = body.indexOf(" ");
  const first = space < 0 ? body : body.slice(0, space);
  const known = DETAIL_STATUSES.find((one) => one === first);
  let statusLabel = "";
  let rest = body;
  if (known !== undefined) {
    statusLabel = known;
    rest = body.slice(first.length).trimStart();
  }
  const dash = rest.indexOf(" — ");
  if (dash < 0) {
    return { act, meta: "", name: rest, owner: "", reason: "", status: statusLabel };
  }
  const name = rest.slice(0, dash);
  const tail = rest.slice(dash + " — ".length);
  const colon = tail.indexOf(": ");
  const meta = colon < 0 ? "" : tail.slice(0, colon);
  const reason = colon < 0 ? tail : tail.slice(colon + ": ".length);
  return { act, meta, name, owner: ownerOf({ reason }), reason, status: statusLabel };
}

/** Whose step a reason says the row's next one is, read off its opening words. */
function ownerOf({ reason }: { reason: string }): DetailEntry["owner"] {
  if (reason.startsWith(NEEDS_YOU)) {
    return "you";
  }
  if (reason.startsWith(NOTHING_FOR_YOU)) {
    return "fleet";
  }
  return "";
}

/**
 * A step's details, checked — or honestly absent.
 *
 * An absent or empty list is dropped rather than written, so a row with no details reads back byte for byte as one
 * written before the field existed.
 *
 * @param value whatever the caller or the register line carried
 * @returns the trimmed lines, `undefined` when there are none, or the refusal naming the cap it broke
 */
export function checkedDetails({ value }: { value: unknown }): Result<readonly string[] | undefined, HandStepError> {
  if (value === undefined) {
    return ok(undefined);
  }
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    return err(HandStepErrors.invalidField({ field: "details", why: "is a list of lines" }));
  }
  const lines = (value as readonly string[]).map((line) => line.trim());
  if (lines.length === 0) {
    return ok(undefined);
  }
  if (lines.some((line) => line.length === 0 || line.includes("\n"))) {
    return err(HandStepErrors.invalidField({ field: "details", why: "carries an empty or multi-line entry" }));
  }
  if (lines.length > DETAILS_MAX) {
    return err(
      HandStepErrors.invalidField({
        field: "details",
        why: `carries ${String(lines.length)} lines and the cap is ${String(DETAILS_MAX)} — end the list on a line naming where the rest is read`,
      }),
    );
  }
  const long = lines.find((line) => line.length > DETAIL_LINE_CAP);
  if (long !== undefined) {
    return err(
      HandStepErrors.invalidField({
        field: "details",
        why: `carries a ${String(long.length)}-character line and the cap is ${String(DETAIL_LINE_CAP)}: "${long.slice(0, 40)}…"`,
      }),
    );
  }
  return ok(lines);
}
