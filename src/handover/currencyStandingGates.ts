/**
 * The ruling gates in force, read from EVERY run journal on the machine — the standing source of a card's steers half
 * that bears on every card (`./currencyStanding.ts`). Pure: the shell (`../cli/commands/handover/currencyStandingRead.ts`)
 * hands in each journal's text.
 *
 * Every journal, not the board's: a gate refuses verbs whatever row placed it, and a row whose doc left the board, or
 * whose run nobody is waiting on, still holds its gates — `./rulingGateStore.ts` rebuilds the projection the same way
 * (a journal no board doc claims would otherwise go unread, so a gate in it could not fail a card).
 *
 * Every journal is DECODED, never pre-filtered on its raw text: a JSON-equivalent spelling of the kind (`"k\u0069nd"`)
 * defeats a text match, so a gate in force behind one would pass every card.
 *
 * A journal that will not read, and an undecodable line that may be a ruling — one whose JSON names the ruling kind, or
 * one that is not JSON at all, so its kind is unknown — are gaps on every card: either may be a gate. A well-formed line
 * of any other kind cannot hide one, so it is not a gap, which keeps one newer line in an unrelated run from stripping
 * every card of its freshness.
 *
 * RESIDUE, stated rather than discovered: a gate's change is read off its journal's EVENTS — placed, released, lapsed —
 * because a run journal is append-only. A line rewritten in place keeping its old `atIso` is not a ruling any verb
 * writes, and it reads as the old instant. So does an event appended with a deliberately
 * backdated `--now`: it is read at the instant it declares, not the one it was appended. The
 * journal's mtime cannot close either: every append to any run moves it, so every card would read stale on unrelated
 * work. What would close both is a digest of each journal's gate lines recorded per reading and compared on the next.
 * The same digest would close the third: a journal deleted outright takes its gates with it, and the runs directory's
 * mtime moves on every new run.
 */
import { instantCeilingMs, type StandingEntry } from "./currencyStanding.js";
import type { StandingPart } from "./currencyStandingEntries.js";
import { parseLedger, type RunEvent } from "./ledger.js";
import { type StandingGate, standingGatesOf, unexpiredGates } from "./rulingGate.js";

/** One run journal as the shell read it: its text, or why it would not read. */
export type RunJournalRead =
  | { readonly kind: "read"; readonly slug: string; readonly text: string }
  | { readonly kind: "unreadable"; readonly slug: string; readonly why: string };

/**
 * Whether an undecodable journal line may be a ruling: anything but a JSON object whose `kind` is a string naming
 * some OTHER kind. A line with no `kind`, or one that is not a string, says nothing about what it is, so it may be a
 * ruling that lost its discriminator.
 *
 * @param line the raw line
 * @returns false only for a JSON object whose `kind` names some other kind
 */
function mayBeRuling({ line }: { line: string }): boolean {
  let decoded: unknown;
  try {
    decoded = JSON.parse(line);
  } catch {
    return true;
  }
  if (typeof decoded !== "object" || decoded === null) {
    return true;
  }
  const { kind } = decoded as { kind?: unknown };
  return typeof kind !== "string" || kind === "ruling";
}

/**
 * One journal's gates in force at the reading's clock: the ONE answer both the gate part and `rulingPart`
 * (`./currencyStandingEntries.ts`) read, so a ruling the rulings part leaves to this one is always listed here. Two
 * folds must agree under a backdated `--now`: a gate placed after the clock is in force to neither the rulings
 * part nor this one, and is listed by neither.
 *
 * @param events the journal's events, decoded and in order
 * @param slug the journal's row
 * @param nowIso the reading's clock
 * @returns the gates in force, first fold first
 */
export function gatesInForceAt({
  events,
  slug,
  nowIso,
}: {
  events: readonly RunEvent[];
  slug: string;
  nowIso: string;
}): readonly StandingGate[] {
  // The reading is a snapshot at its clock, so an event journalled after it — a release above all — is not folded in
  // yet: one appended mid-read lifted a gate still in force at checkedIso. An event IN
  // the clock's own millisecond may sit on either side of it, so the journal is folded both ways and a gate in force
  // in either is kept: a gate placed in that millisecond counts, and so does one released in it.
  const nowMs = Date.parse(nowIso);
  const through = events.filter((event) => !(Date.parse(event.atIso) > nowMs));
  const before = through.filter((event) => Date.parse(event.atIso) < nowMs);
  // Expiry judged a millisecond early: `Date.parse` truncates an `untilIso` of `12:00:00.0005Z` to the clock itself,
  // which read a gate still in force as lapsed. Early only ever keeps a gate.
  const expiryIso = new Date(nowMs - 1).toISOString();
  const inForce = new Map<string, StandingGate>();
  for (const folded of [through, before]) {
    for (const gate of unexpiredGates({ gates: standingGatesOf({ events: folded, slug }), nowIso: expiryIso })) {
      if (!inForce.has(gate.id)) {
        inForce.set(gate.id, gate);
      }
    }
  }
  return [...inForce.values()];
}

/**
 * One journal's gates in force at `nowIso`, and whether a ruling in it may have been missed.
 *
 * @param journal the journal's text and its row
 * @param nowIso the reading's clock, which an expired gate is judged at
 * @returns the entries, and whether an undecodable ruling line was found
 */
function journalGates({
  journal,
  nowIso,
}: {
  journal: { readonly slug: string; readonly text: string };
  nowIso: string;
}): {
  readonly endings: readonly StandingEntry[];
  readonly entries: readonly StandingEntry[];
  readonly missed: boolean;
} {
  const lines = journal.text.split("\n");
  const parsed = parseLedger({ text: journal.text });
  const missed = parsed.unreadable.some((lineNumber) => mayBeRuling({ line: lines[lineNumber - 1]! }));
  const nowMs = Date.parse(nowIso);
  const through = parsed.events.filter((event) => !(Date.parse(event.atIso) > nowMs));
  const inForce = gatesInForceAt({ events: parsed.events, nowIso, slug: journal.slug });
  const entries = inForce.map((gate): StandingEntry => ({
    atIso: gate.placedIso,
    pointer: `ruling:${gate.id}`,
    row: undefined,
    source: "ruling",
    text: gate.words,
  }));
  return { endings: gateEndings({ events: through, nowMs, slug: journal.slug }), entries, missed };
}

/**
 * Whether a gate's expiry falls at or before the clock. Judged INCLUSIVELY, unlike the in-force read's millisecond-early
 * expiry: a gate lapsing exactly at checkedIso lapsed within the reading, and judged early its lapse went unlisted while
 * its pre-floor placing would be dropped. Rounded up past the millisecond, so an expiry a
 * fraction after the clock lapses after it.
 *
 * @param nowMs the reading's clock
 * @param untilIso the gate's expiry as journalled
 * @returns true when the gate stopped standing at or before the clock
 */
function lapsedThrough({ nowMs, untilIso }: { nowMs: number; untilIso: string }): boolean {
  return instantCeilingMs({ iso: untilIso }) <= nowMs;
}

/**
 * Every gate that STOPPED standing through the reading's clock, as an entry at the instant it stopped: a release, at
 * the releasing ruling's own instant, and a lapse, at the later of its `untilIso` and its placing. A gate lifted between a card's floor and its
 * reading changed the owner's standing guidance exactly as one placed there did, yet folding to the gates in force alone
 * drops it, so a card would read fresh across it. Every ending is emitted whatever its
 * instant; `./currencyStanding.ts` keeps the ones after the card's floor.
 *
 * @param events the journal's events through the clock, decoded and in order
 * @param nowMs the reading's clock, a lapse at or before which is listed
 * @param slug the row whose journal this is
 * @returns one entry per release and per lapse
 */
function gateEndings({
  events,
  nowMs,
  slug,
}: {
  events: readonly RunEvent[];
  nowMs: number;
  slug: string;
}): readonly StandingEntry[] {
  const endings: StandingEntry[] = [];
  for (const event of events) {
    if (event.kind !== "ruling" || event.gateReleases === undefined || event.gateReleases.length === 0) {
      continue;
    }
    endings.push({
      atIso: event.atIso,
      pointer: `ruling:${slug}#${event.atIso}`,
      row: undefined,
      source: "ruling",
      text: event.ruling,
    });
  }
  for (const gate of standingGatesOf({ events, slug })) {
    if (gate.untilIso === undefined || !lapsedThrough({ nowMs, untilIso: gate.untilIso })) {
      continue;
    }
    // A gate appended with an expiry already past lapsed the moment it was placed, so it is dated at the later of the
    // two: dated at its expiry, one placed after a card's floor with an expiry before it would be dropped.
    const placedLater = instantCeilingMs({ iso: gate.placedIso }) > instantCeilingMs({ iso: gate.untilIso });
    endings.push({
      atIso: placedLater ? gate.placedIso : gate.untilIso,
      pointer: `ruling:${gate.id}`,
      row: undefined,
      source: "ruling",
      text: `lapsed: ${gate.words}`,
    });
  }
  return endings;
}

/**
 * Every gate in force at `nowIso`, and every release or lapse through it, as an entry filed to no card, and one gap
 * for every card naming how many journals may hide one.
 *
 * @param journals every run journal the shell found, read or not, or why the directory could not be listed
 * @param nowIso the reading's clock, which an expired gate is judged at
 * @returns the part
 */
export function gatePart({
  journals,
  nowIso,
}: {
  journals: readonly RunJournalRead[] | { readonly why: string };
  nowIso: string;
}): StandingPart {
  if ("why" in journals) {
    return {
      entries: [],
      gaps: [{ why: `your run journals could not be listed, so a ruling gate may be missed: ${journals.why}` }],
      source: `gates not read: ${journals.why}`,
    };
  }
  const entries: StandingEntry[] = [];
  let inForceCount = 0;
  let missed = 0;
  for (const journal of journals) {
    if (journal.kind === "unreadable") {
      missed += 1;
      continue;
    }
    const read = journalGates({ journal, nowIso });
    entries.push(...read.entries, ...read.endings);
    inForceCount += read.entries.length;
    missed += read.missed ? 1 : 0;
  }
  const inForce = `${String(inForceCount)} gates in force across ${String(journals.length)} run journals`;
  if (missed === 0) {
    return { entries, gaps: [], source: inForce };
  }
  const hold = missed === 1 ? "1 run journal holds" : `${String(missed)} run journals hold`;
  return {
    entries,
    gaps: [{ why: `${hold} a ruling this build could not read, so a ruling gate may be missed` }],
    source: `${inForce}; ${hold} a ruling this build could not read`,
  };
}
