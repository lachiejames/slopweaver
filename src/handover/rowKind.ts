/**
 * The board's ROW vocabulary: what kind of thing a row is, how urgent it is, and — for the one kind that
 * needs it — how it ended.
 *
 * ## Why the board grew kinds at all
 *
 * There is one consolidated board. A Slack tag is a row on it, ranked above
 * ordinary doc work, and a thing the owner ASKED FOR is a row on it too, with a terminal state, in the same
 * register as everything else.
 *
 * The measurement behind that rule is the whole reason this file exists. The owner's structured asks land and
 * their conversational ones drop: a batch of six numbered card-polish items reached the board inside
 * thirteen minutes and four of them shipped, while a stuck-chat ask given mid-paragraph in a voice dump was
 * restated NINE times over thirteen hours before any doc registered it. Nothing was broken. There was simply
 * no register between "the owner says something" and "a run exists" — the board registers WORK, so an ask survived
 * only when a session happened to notice it was a list. {@link BoardRowKind}'s `ask` member is that missing
 * register, and it is a row rather than a file of its own so that one ranking governs everything.
 *
 * ## Three kinds, but only TWO of them are authored
 *
 * `doc` and `ask` are files under the handovers directory, read by the same front-matter reader. `tag` is
 * NOT: a Slack tag already has an exact, append-only register in `../live/ask/lifecycle.ts`, keyed by
 * `(channel, messageTs)`, and writing a markdown file per tag would be a second source of truth over a
 * stream that is already the authority. `../doc.ts`'s own header states that rule for docs — the metadata
 * lives in the doc, never in an index — and this is the same rule pointed the other way: a tag row is
 * PROJECTED from the lifecycle at read time and never written down.
 *
 * Pure: a vocabulary and its parsers. No filesystem, no clock.
 */

/**
 * What kind of thing one board row is.
 *
 * `doc` is the default for every existing doc, which is why an absent `kind:` parses to it — 200-odd live
 * docs must not need a migration to stay on the board they are already on.
 */
export type BoardRowKind = "doc" | "ask" | "tag";

/** Every kind a row may DECLARE. `tag` is absent because a tag row is projected, never authored. */
export const AUTHORED_ROW_KINDS: readonly BoardRowKind[] = ["doc", "ask"];

/**
 * How urgent a row is, smallest first — the dial continuous reprioritisation moves.
 *
 * Four bands rather than a free integer: the owner's standing practice over this board is reprioritising,
 * consolidating and deduping it by hand, and a hand-moved dial with 2^31 positions is one nobody can compare
 * two rows on. Linear's own P0..P3 is the vocabulary the owner already reads.
 */
export type BoardPriority = "p0" | "p1" | "p2" | "p3";

/**
 * Every priority, most urgent first — the array {@link priorityIndex} reads its ordering from, and the list
 * `handover set-priority` names in a refusal and prints its census in. To COMPARE two bands, ask
 * {@link priorityIndex} rather than indexing this.
 */
export const BOARD_PRIORITIES: readonly BoardPriority[] = ["p0", "p1", "p2", "p3"];

/**
 * The priority a row of this kind carries when it declares none.
 *
 * This is where "a tag generally outranks doc work" lives, and it is a DEFAULT rather than a rule so that
 * the word "generally" survives: a tag sits at `p0` and a doc at `p2` unless the row says otherwise, and any
 * row of any kind may declare any band. An unanswered tag is someone waiting on a reply in a thread, which
 * is why it outranks planned work by default; an ask is the owner's own words with nothing built yet, which is why
 * it sits between the two.
 */
export const DEFAULT_PRIORITY: Readonly<Record<BoardRowKind, BoardPriority>> = {
  ask: "p1",
  doc: "p2",
  tag: "p0",
};

/**
 * How an ask ENDED — the terminal states the ruling asked to be settled, and the only three there are.
 *
 * They are exhaustive by construction rather than by taste: an ask the owner made either became work (`filed`), was
 * answered on the spot with no work needed (`answered`), or will not be done (`declined`). Anything else is
 * the ask still being open, which is the state that has no name here because it is the absence of one.
 *
 * Each carries a WITNESS, and which witness is what separates the two an agent may set from the one it may
 * not. `filed` names the doc slug it became and the board checks that doc exists; `answered` names the
 * permalink of the answer. Both are checkable, so a session setting one cannot quietly close an ask that is
 * not closed. `declined` has no checkable witness — it is a judgement that the owner's ask will not be actioned —
 * so it is the owner's alone, and {@link declineNeedsAnchor} is what a verb refuses on.
 */
export type AskSettlement = "filed" | "answered" | "declined";

/**
 * Every settlement an ask row may declare.
 *
 * @internal — the set {@link asAskSettlement} parses against; callers ask that function instead.
 */
export const ASK_SETTLEMENTS: readonly AskSettlement[] = ["filed", "answered", "declined"];

/**
 * Where an ask row CAME FROM, when it did not come from the owner.
 *
 * A fleet finding — two watcher deaths a session observed, say — MAY be registered as an ask ranking with the
 * owner's asks. What goes wrong when nothing on the row says so: a row registered by a supervisor from
 * evidence nobody had asked about becomes a team-facing pull request, and the owner closes it with no memory
 * of asking and no idea where it came from. So a row of this origin carries the
 * observing session and the evidence as PROVENANCE, and the team-facing doors refuse its outward action
 * until a ruling from the owner is recorded on it ({@link ./askRow.ts}'s `findingRulingState`). Absent means the
 * row is the owner's own ask, which is why no existing row needed touching.
 */
export type RowOrigin = "finding";

/**
 * Every origin a row may declare.
 *
 * @internal — the set {@link asRowOrigin} parses against; callers ask that function instead.
 */
export const ROW_ORIGINS: readonly RowOrigin[] = ["finding"];

/**
 * Whether this settlement is one only the OWNER may set.
 *
 * Deliberately a predicate over the settlement rather than a check on who is calling: nothing in this system
 * authenticates a human (`.claude/rules/cross-session-messages.md`), so a gate claiming to verify that the
 * owner declined an ask would be a lie dressed as a control. What CAN be enforced is that a decline is
 * ATTRIBUTABLE — it carries a reason in the owner's words and a pointer to where they said it — and that an unanchored
 * one stays visible on the board rather than closing quietly. That is the honest half, and it is the half
 * that matters, because the failure being prevented is an agent silently dropping the owner's ask.
 *
 * @param settlement the terminal state being set
 * @returns whether it needs the owner's own word plus an anchor
 */
export function declineNeedsAnchor({ settlement }: { settlement: AskSettlement }): boolean {
  return settlement === "declined";
}

/**
 * Read a declared `kind:`, treating anything unrecognised as the default rather than as a defect.
 *
 * A typo becoming `doc` is the safe direction: the row stays on the board and reads as ordinary work. The
 * unsafe direction would be a mistyped `kind:` silently removing a row, which is the class of silent drop
 * this whole feature exists to end.
 *
 * @param value the raw front-matter value, absent when the row declared none
 * @returns the kind, or `doc`
 */
export function asRowKind({ value }: { value: string | undefined }): BoardRowKind {
  const authored = AUTHORED_ROW_KINDS.find((kind) => kind === value);
  if (authored === undefined) {
    return "doc";
  }
  return authored;
}

/**
 * Read a declared `priority:`, or nothing when the row declared none.
 *
 * `undefined` rather than a default, so {@link DEFAULT_PRIORITY} stays the single place a kind's default is
 * stated and a reader can still tell a declared `p2` from an undeclared one.
 *
 * @param value the raw front-matter value
 * @returns the priority, or `undefined` when absent or unrecognised
 */
export function asBoardPriority({ value }: { value: string | undefined }): BoardPriority | undefined {
  return BOARD_PRIORITIES.find((priority) => priority === value);
}

/**
 * Read a declared `settlement:`, or nothing when the ask is still open.
 *
 * @param value the raw front-matter value
 * @returns the settlement, or `undefined` when absent or unrecognised
 */
export function asAskSettlement({ value }: { value: string | undefined }): AskSettlement | undefined {
  return ASK_SETTLEMENTS.find((settlement) => settlement === value);
}

/**
 * Read a declared `origin:`, or nothing when the row is the owner's own ask.
 *
 * @param value the raw front-matter value
 * @returns the origin, or `undefined` when absent or unrecognised
 */
export function asRowOrigin({ value }: { value: string | undefined }): RowOrigin | undefined {
  return ROW_ORIGINS.find((origin) => origin === value);
}

/**
 * Where a priority sits in the ordering, smallest first.
 *
 * @param priority the band to place
 * @returns its 0-based index, `p0` first
 */
export function priorityIndex({ priority }: { priority: BoardPriority }): number {
  return BOARD_PRIORITIES.indexOf(priority);
}

/**
 * The band a row actually ranks in: what it declared, or its kind's default.
 *
 * @param declared the row's own `priority:`, absent when it declared none
 * @param kind what kind of row it is
 * @returns the effective priority
 */
export function effectivePriority({
  declared,
  kind,
}: {
  declared: BoardPriority | undefined;
  kind: BoardRowKind;
}): BoardPriority {
  if (declared !== undefined) {
    return declared;
  }
  return DEFAULT_PRIORITY[kind];
}
