/**
 * What one pass over a held ChatGPT export counted, and the bounded lines it keeps to say so: the gaps that fail the
 * refresh, the unknown content kinds a reader must be taught, and the note a person reads for the export.
 *
 * Every list here accumulates across the WHOLE archive, which the archive sizes, so each is capped and what passes
 * the cap is counted rather than kept (`ingest.ts` § Nothing read is lost quietly).
 */
import type { StoredExport } from "./exportStore.js";

/** What one pass over an export counted, beside the records it committed. */
export interface PassTally {
  conversations: number;
  messages: number;
  withheld: number;
  duplicates: number;
  /** Conversations a newer export read in the same run already holds, so left to it. */
  superseded: number;
  written: number;
  /** Records the owner's sync-author denylist kept out of bronze: the owner's rule, so a note, never a gap. */
  excluded: number;
  offered: number;
  /** At most {@link KINDS_NAMED} distinct unknown kinds, each by name. */
  readonly unknownKinds: Map<string, number>;
  /** Messages whose unknown kind arrived after {@link KINDS_NAMED} were already named. */
  unknownKindsUnnamed: number;
  /** At most {@link GAPS_NAMED} gap lines, each cut to {@link GAP_CHARS}. */
  readonly gaps: string[];
  /** Gaps past {@link GAPS_NAMED}, counted rather than kept. */
  gapsUnnamed: number;
}

/**
 * How many gap lines, distinct unknown kinds, and characters per line one export's pass keeps. Choices, sized to
 * diagnose — a single gap already fails the refresh, so the count is what matters past these.
 */
const GAPS_NAMED = 50;
const KINDS_NAMED = 20;
const GAP_CHARS = 2000;

/**
 * A tally with nothing counted yet.
 *
 * @returns a fresh tally, every count zero and every list empty
 */
export function emptyTally(): PassTally {
  return {
    conversations: 0,
    duplicates: 0,
    excluded: 0,
    gaps: [],
    gapsUnnamed: 0,
    messages: 0,
    offered: 0,
    superseded: 0,
    unknownKinds: new Map(),
    unknownKindsUnnamed: 0,
    withheld: 0,
    written: 0,
  };
}

/**
 * Keep one gap line, cut, or count it once {@link GAPS_NAMED} are already kept.
 *
 * @param tally the pass the gap belongs to, updated in place
 * @param line what failed, as a person reads it
 */
export function noteGap({ tally, line }: { tally: PassTally; line: string }): void {
  if (tally.gaps.length >= GAPS_NAMED) {
    tally.gapsUnnamed += 1;
    return;
  }
  tally.gaps.push(line.slice(0, GAP_CHARS));
}

/**
 * The whole sync's gap lines — the merge's and every held export's — held to the bound one export's are: the first
 * {@link GAPS_NAMED} named and cut, the rest counted in one closing line, so however many exports are held the
 * output stays one readable page. Pure.
 *
 * @param lines every gap line the sync raised, the merge's first, then each export's in reading order
 * @returns at most {@link GAPS_NAMED} lines, plus the count line when any went unnamed
 */
export function syncGapLines({ lines }: { lines: readonly string[] }): readonly string[] {
  const named = lines.slice(0, GAPS_NAMED).map((line) => line.slice(0, GAP_CHARS));
  const unnamed = lines.length - named.length;
  if (unnamed > 0) {
    named.push(`chatgpt: and ${String(unnamed)} more gap line(s) across the held exports, counted rather than named`);
  }
  return named;
}

/**
 * Fold one conversation's unknown content kinds into the tally, naming at most {@link KINDS_NAMED} of them.
 *
 * @param kinds each unknown kind one conversation carried, and how many messages carried it
 * @param tally the pass to fold them into, updated in place
 */
export function noteUnknownKinds({ kinds, tally }: { kinds: ReadonlyMap<string, number>; tally: PassTally }): void {
  for (const [kind, count] of kinds) {
    const counted = tally.unknownKinds.get(kind);
    if (counted !== undefined) {
      tally.unknownKinds.set(kind, counted + count);
    } else if (tally.unknownKinds.size < KINDS_NAMED) {
      tally.unknownKinds.set(kind, count);
    } else {
      tally.unknownKindsUnnamed += count;
    }
  }
}

/**
 * The gaps a pass names only once it has read everything: each unknown kind, those past the kinds named, and the
 * count past the gap cap.
 *
 * @param tally the finished pass, its gaps appended in place
 */
export function closeTally({ tally }: { tally: PassTally }): void {
  for (const [kind, count] of tally.unknownKinds) {
    noteGap({
      line:
        `chatgpt: ${String(count)} message(s) carry the content kind \`${kind}\`, which this reader does not know — ` +
        "not stored; teach `corpus/chatgpt/exportMessage.ts` the kind",
      tally,
    });
  }
  if (tally.unknownKindsUnnamed > 0) {
    noteGap({
      line: `chatgpt: ${String(tally.unknownKindsUnnamed)} more message(s) carry content kinds past the ${String(KINDS_NAMED)} named — not stored`,
      tally,
    });
  }
  // Pushed past the cap on purpose: the count of what went unnamed is the one line that must survive it.
  if (tally.gapsUnnamed > 0) {
    tally.gaps.push(`chatgpt: and ${String(tally.gapsUnnamed)} more gap(s) in this export, counted rather than named`);
  }
}

/**
 * The note a person reads for one export the run read.
 *
 * @param stored the export that was read
 * @param tally what reading it counted
 * @returns one line: the export, when it was taken in, and what it held
 */
export function exportNote({ stored, tally }: { stored: StoredExport; tally: PassTally }): string {
  return (
    `read export ${stored.contentHash.slice(0, 12)} (taken in ${stored.importedAtIso}): ` +
    `${String(tally.conversations)} conversation(s) across ${String(stored.files.length)} file(s), ` +
    passCounts({ tally })
  );
}

/**
 * The note one pass over the live copy leaves on the run.
 *
 * @param snapshots how many conversation snapshots the live copy holds
 * @param tally what reading it counted
 * @returns one line: the live copy and what it held
 */
export function liveNote({ snapshots, tally }: { snapshots: number; tally: PassTally }): string {
  return (
    `read the live copy: ${String(tally.conversations)} conversation(s) from ${String(snapshots)} snapshot(s), ` +
    passCounts({ tally })
  );
}

/** What one pass projected, withheld and left to another held copy, as the tail of its note. */
function passCounts({ tally }: { tally: PassTally }): string {
  const extras = [
    tally.superseded > 0
      ? `${String(tally.superseded)} conversation(s) left to the copy holding their latest version`
      : "",
    tally.duplicates > 0 ? `${String(tally.duplicates)} exact duplicate conversation(s) read once` : "",
    tally.excluded > 0 ? `${String(tally.excluded)} kept out by the sync-author denylist` : "",
  ].filter((extra) => extra.length > 0);
  return (
    `${String(tally.messages)} message(s) projected, ${String(tally.withheld)} withheld as not part of what the owner saw` +
    extras.map((extra) => `, ${extra}`).join("")
  );
}
