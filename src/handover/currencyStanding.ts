/**
 * The STANDING half of a Queue card's steers check: the owner's rulings, memories and owner profile, beside the words
 * the owner said since (`./currency.ts`). "Fresh" means nothing the
 * owner has said bears on the card — a memory written, a profile statement added or a ruling recorded after the card
 * reached the owner is read against it, not only the words said after.
 *
 * **The contract is the card's floor, the same instant the words half counts from.** Every session that composes a
 * card has the owner's memories and owner profile injected at its start, and a row's rulings are in the journal it reads, so
 * what could bear on a card unseen is whatever CHANGED after its floor. That is a lower bound on what its producer
 * had, never a proof it read every earlier entry: nothing binds a card to the context its session was actually
 * delivered, and a session that started on a cached profile had that cache. The console therefore says "nothing new
 * bears on it", never "nothing you have ever said". Relevance is never judged here — no text match, no model — so
 * every change after the floor counts, exactly as an unfiled word does.
 *
 * Three sources, each with one way a change files to a card:
 *
 * - **A memory leaf** (`../memory/store.ts`) names no card, so a change to one is unfiled — it could bear on any.
 * - **The owner profile** (`../store/profile/client.ts`) is injected into every session, so a change is unfiled too.
 * - **A ruling** (`./ledger.ts`) files to its own row: a card whose ask is that row reads it as tied here, every other
 *   card ignores it — the same rule an intake witness filing a word elsewhere follows. The exception is a ruling that
 *   places a gate still in force (`./rulingGate.ts`), which refuses verbs on every card, so it is unfiled — read
 *   from EVERY run journal under the home (`./currencyStandingGates.ts`), never only the journals the board claims.
 *
 * A source that could not be read is a GAP, carried beside what was read and never folded into "nothing changed". A
 * gap lands on every card: a memory or the profile could bear on any, and an unread journal, or an undecodable ruling
 * line in one, may be a ruling placing a gate.
 * Pure: the shell (`../cli/commands/handover/currencyStandingRead.ts`) reads, this decides.
 */

/** Where a standing entry was read from. */
type StandingSource = "memory" | "profile" | "ruling";

/** One standing entry as the shell read it, before any card's floor is applied. */
export interface StandingEntry {
  /** When it last changed — written, rewritten or recorded. */
  readonly atIso: string;
  readonly pointer: string;
  readonly source: StandingSource;
  /** What it says, quoted behind the card's closed fold. */
  readonly text: string;
  /** The one board row it is filed to, or `undefined` when it can bear on any card. */
  readonly row: string | undefined;
}

/** A standing read that could not be made — a gap on every card, since what it would have read could bear on any. */
export interface StandingGap {
  readonly why: string;
}

/** Everything the shell read of the owner's standing guidance, once per reading. */
export interface StandingRead {
  readonly entries: readonly StandingEntry[];
  readonly gaps: readonly StandingGap[];
  /** What each source read, or why it could not, as the card's "How this was checked" names it. */
  readonly sources: { readonly memory: string; readonly profile: string; readonly rulings: string };
}

/** One change to the owner's standing guidance after a card's floor, as the card's row carries it. */
export interface StandingChange {
  readonly atIso: string;
  readonly pointer: string;
  readonly source: StandingSource;
  /** `here` when it is a ruling on this card's own row; `unfiled` when it can bear on any card. */
  readonly filed: "here" | "unfiled";
}

/**
 * An instant as epoch milliseconds, rounded UP past the millisecond. `Date.parse` truncates `09:00:00.0005Z` to
 * `09:00:00.000Z`, so a change half a millisecond after a card's floor would compare equal to it and be dropped.
 * Rounding up only ever keeps a change.
 *
 * @param iso the instant as written
 * @returns the milliseconds, one more when a non-zero digit sits past the millisecond, or NaN when it does not parse
 */
export function instantCeilingMs({ iso }: { iso: string }): number {
  const truncated = Date.parse(iso);
  const beyond = /\.\d{3}(\d+)/.exec(iso);
  const subMillisecond = beyond !== null && !/^0+$/.test(beyond[1]!);
  return subMillisecond ? truncated + 1 : truncated;
}

/**
 * One card's standing changes: every entry that changed strictly after its floor and can bear on it, and every gap that
 * applies to it. An entry with no instant that parses is a gap, never dropped and never counted as before the floor.
 *
 * @param standing the reading's one standing read
 * @param floorMs the card's floor, epoch milliseconds
 * @param row the board row this card is, when it is an ask; `undefined` on every other kind
 * @returns the changes, oldest first, and the gaps
 */
export function standingSince({
  standing,
  floorMs,
  row,
}: {
  standing: StandingRead;
  floorMs: number;
  row: string | undefined;
}): { readonly changes: readonly StandingChange[]; readonly gaps: readonly string[] } {
  const gaps = standing.gaps.map((gap) => gap.why);
  const changes: StandingChange[] = [];
  for (const entry of standing.entries) {
    if (entry.row !== undefined && entry.row !== row) {
      continue;
    }
    const atMs = instantCeilingMs({ iso: entry.atIso });
    if (Number.isNaN(atMs)) {
      gaps.push(
        `one ${SOURCE_NOUN[entry.source]} carries no time, so whether it changed after this reached you cannot be told`,
      );
      continue;
    }
    if (atMs > floorMs) {
      const filed = entry.row === undefined ? "unfiled" : "here";
      changes.push({ atIso: entry.atIso, filed, pointer: entry.pointer, source: entry.source });
    }
  }
  const ordered = changes.toSorted(
    (a, b) => Date.parse(a.atIso) - Date.parse(b.atIso) || a.pointer.localeCompare(b.pointer),
  );
  return { changes: ordered, gaps };
}

/** Each source as one entry of it is named in a gap on the owner's card. */
const SOURCE_NOUN: Readonly<Record<StandingSource, string>> = {
  memory: "of your memories",
  profile: "owner-profile statement",
  ruling: "of your recorded rulings",
};
