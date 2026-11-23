/**
 * Whether one call file holds `card-reading-hold`'s witness: the named card read or opened, the owner's final words
 * ending on "let me just keep reading", and then a whole observation window in which nothing moved the owner — no
 * `resume`, no resume's, triage card's or next-card ask's own `owed-start`, no `open_card` of another card and no
 * `triage_next`. Pure; the read off disk is `src/cli/commands/desktop/e2eCallEvidenceRead.ts`, the drive
 * `src/cli/commands/desktop/e2eCallCardReadingHoldScenario.ts`.
 *
 * The requirement: an owner who says they are still reading a card is never sent to a different one. Measured on a
 * call that broke it: the owner ended on "let me just keep reading", the page resumed about 3 s before the console
 * started its own turn, and that turn re-pitched the card the owner had open. Repro: the `resume` and `owed-start`
 * tool lines in `$SLOPWEAVER_HOME/talk/calls/<call-id>.jsonl`.
 *
 * Structure only, never prose: a voice answer is allowed and is not judged, because an answer to the owner's request
 * is not a move. What moved the owner is a line only a move writes. The residue is the other side of that choice: a
 * different card named only in what the voice says or is handed to say, with no move line behind it, is not caught
 * here — the call's transcript is where that shows.
 */
import type { CallEntry } from "../talk/callRecord.js";
import { isCardReadWitness } from "./e2eCallCardRead.js";

/**
 * The `who` a call file's segment line carries for the owner's own words: the stored spelling, named once so a reader
 * of it never spells it again.
 */
export const OWNER_SPEAKER = "owner" satisfies Extract<CallEntry, { kind: "segment" }>["who"];

/** The words the test microphone ends on, the owner's own phrase from a call that was resumed after it. */
export const READING_HOLD_PHRASE = "let me just keep reading";

/**
 * The owner's line ENDS on the phrase, only marks after it: "let me just keep reading, then send it" hands the floor
 * back, so it is no hold to witness (`site/lib/waitAsk.ts`).
 */
const ENDS_ON_READING_HOLD = new RegExp(String.raw`${READING_HOLD_PHRASE}[^\p{L}\p{M}\p{N}_]*$`, "u");

/**
 * How long nothing may move the owner once the card is up and they have said they are reading: the page's 5s resume
 * quiet (`RESUME_MS`, `site/lib/voiceActivityState.ts`), the owed start's 2.5s window
 * (`PLAN_CALL_LIMITS.owedTurnStartMs`) and a thinking-model turn to write and open a card, with room. A judgement
 * value: in the measured call the resume fired 5s into the owner's silence and the re-pitch was written 10s after it.
 */
export const READING_HOLD_WINDOW_MS = 45_000;

/** Where one call stands against the witness. */
export type CardReadingHold =
  | { readonly kind: "waiting"; readonly reason: string }
  | { readonly kind: "held" }
  | { readonly kind: "moved"; readonly reason: string };

/**
 * The endings of the `owed-start` lines a console that decided the owner was done writes, as `owedStartLine`
 * (`site/components/voice/planWiringLines.ts`) words them: the resume's, the triage card's and the owner's next-card ask's.
 */
const OWED_STARTS_THAT_MOVE: readonly string[] = [
  "the resume made the answer the thinking model's",
  "the triage card's two minutes were up, and the suggestion is the thinking model's",
  "they asked for the next card and no turn started during the owner's words",
];

/** A tool line of a call file. */
type ToolEntry = Extract<CallEntry, { kind: "tool" }>;

/**
 * Whether a line is a tool line that ran. Positional because a type predicate cannot name a destructured binding.
 *
 * @returns whether it is
 */
function isRanTool(entry: CallEntry): entry is ToolEntry {
  return entry.kind === "tool" && !entry.refused;
}

/**
 * Why a line moved the owner off the named card, or `undefined` when it did not: a resume, the console's own turn,
 * another card opened, or a triage step.
 *
 * @param cardKey the card the owner was reading
 * @returns the reason, quoting the line
 */
function moveOf({ entry, cardKey }: { entry: CallEntry; cardKey: string }): string | undefined {
  if (!isRanTool(entry)) {
    return undefined;
  }
  const said = `${entry.name} at ${entry.atIso}: ${entry.detail}`;
  if (entry.name === "resume" || entry.name === "triage_next") {
    return said;
  }
  // A nudge's or a promise press's own start answers something already in flight, and any card it moves the owner to
  // is the `open_card` below; a resume's or a triage card's start is the console deciding the owner is done.
  const unasked = OWED_STARTS_THAT_MOVE.some((why) => entry.detail.endsWith(why));
  if (entry.name === "owed-start" && unasked) {
    return said;
  }
  if (entry.name === "open_card" && !entry.detail.startsWith(`${cardKey}, `)) {
    return said;
  }
  return undefined;
}

/**
 * Judge one call's lines against the witness at an instant.
 *
 * @param entries the call's lines, in file order
 * @param cardKey the Queue card key `--call-card` named
 * @param nowMs the instant judged at, which the window must have passed for a hold to count
 * @returns waiting while the card or the owner's words have not landed or the window is still open, moved on the first move
 *   after both, else held
 */
export function cardReadingHold({
  entries,
  cardKey,
  nowMs,
}: {
  entries: readonly CallEntry[];
  cardKey: string;
  nowMs: number;
}): CardReadingHold {
  // Instants give the order things happened in; a late batch can land ahead in the file (`./e2eCallCardRead.ts`).
  const ordered = entries.toSorted((a, b) => Date.parse(a.atIso) - Date.parse(b.atIso));
  // Positions, never an object looked up again: one object listed twice resolves `indexOf` to its FIRST place, which
  // would scan moves that came before the owner's last line.
  const witnessIndexes = ordered.flatMap((entry, index) => (isCardReadWitness({ cardKey, entry }) ? [index] : []));
  // The owner's LAST final line, whatever it says: a later "actually, send it" releases the hold, so an earlier line
  // ending on the phrase never stands in for it. Waiting, never held, is the safe side.
  const lastIndex = ordered.findLastIndex(
    (entry) => entry.kind === "segment" && entry.who === OWNER_SPEAKER && entry.final,
  );
  const last = ordered[lastIndex];
  const said = last?.kind === "segment" && ENDS_ON_READING_HOLD.test(last.text.toLowerCase()) ? last : undefined;
  if (witnessIndexes.length === 0) {
    return { kind: "waiting", reason: `${cardKey} has not been read or opened` };
  }
  if (said === undefined) {
    return { kind: "waiting", reason: `the owner's last final line does not end on "${READING_HOLD_PHRASE}"` };
  }
  // EVERY witness of the card opens a window of its own: a second read of it later in the call is the card up again,
  // so a move inside that window counts even past the first one's.
  const windows = witnessIndexes.map((witnessIndex) => windowOf({ lastIndex, ordered, witnessIndex }));
  const moved = windows.map((window) => moveIn({ cardKey, ordered, window })).find((reason) => reason !== undefined);
  if (moved !== undefined) {
    return { kind: "moved", reason: moved };
  }
  if (windows.some((window) => nowMs < window.untilMs)) {
    return { kind: "waiting", reason: "the observation window is still open" };
  }
  return { kind: "held" };
}

/**
 * One witness's window: from the later of the card witness and the owner's line, by instant and then by sorted
 * position.
 *
 * @param witnessIndex the card witness's position in `ordered`
 * @param lastIndex the owner's last final line's position in `ordered`
 * @returns the position after which a move counts, and the instant before which it must land
 */
function windowOf({
  lastIndex,
  ordered,
  witnessIndex,
}: {
  lastIndex: number;
  ordered: readonly CallEntry[];
  witnessIndex: number;
}): { fromIndex: number; untilMs: number } {
  const fromMs = Math.max(Date.parse(ordered[witnessIndex]!.atIso), Date.parse(ordered[lastIndex]!.atIso));
  // The sort is stable, so a move sharing the owner's line's instant but written after it in the file still
  // counts; a move after a whole clean window is a later turn's.
  return { fromIndex: Math.max(witnessIndex, lastIndex), untilMs: fromMs + READING_HOLD_WINDOW_MS };
}

/**
 * The first move inside one window.
 *
 * @returns why the voice moved the owner, or undefined when nothing did inside the window
 */
function moveIn({
  cardKey,
  ordered,
  window,
}: {
  cardKey: string;
  ordered: readonly CallEntry[];
  window: { fromIndex: number; untilMs: number };
}): string | undefined {
  return ordered
    .slice(window.fromIndex + 1)
    .filter((entry) => Date.parse(entry.atIso) < window.untilMs)
    .map((entry) => moveOf({ cardKey, entry }))
    .find((reason) => reason !== undefined);
}
