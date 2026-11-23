/**
 * Where the last call left off — the console voice's continuity across calls. The pure half of
 * `slopweaver talk recent`, of the lessons the pack stores and of the block `talk offer` reads fresh at mint.
 *
 * The need: a fresh call did not know the merge-conflict steer the owner had given the previous call minutes
 * earlier, though its relay was on their screen and on the board. The owner wants continuity across conversations,
 * so that hanging up and talking again later picks up where they left off. The pack already carried the owner's
 * supervisor turns; what it lacked was freshness (it is rebuilt once a sweep and rides in for an hour, so a relay
 * minutes old is not in it) and shape (nothing said "the owner's last steer, and what became of it").
 *
 * ## What it carries
 *
 * - **Steers**: every relay the voice made in the window, newest first — the owner's transcribed words, what the voice
 *   relayed, and one plain phrase for what became of it, read off the evidence the supervisor leaves: the row's
 *   settlement and its witness, an intake mark and its witness, the latest run-journal act on the row, and
 *   finally whether the line ever reached the supervisor's chat.
 * - **Rulings**: every `ruling` event journalled in the window, the owner's words and their anchor.
 * - **Knowledge**: every lesson recorded in the window — the claim and its verdict.
 * - **Typed**: every turn the owner typed straight into the current supervisor chat in the window, with its next
 *   reply. A steer given there is still their last steer — measured in this change's own bench, a fresh call asked for
 *   "my last steer" named a relay sixteen minutes older than the console batch the owner had just typed to the chair.
 * - **Calls**: every call written down in the window (`./callStore.ts`), newest first — how it ended, or that no
 *   end was recorded, and what the owner and the voice said, as transcribed. A call that dropped lost the steers it
 *   had been given, because the first three halves only see what was RELAYED. The owner's words on the newest call
 *   after their last relay are the ones nothing else carries, so the opener names them.
 *
 * A half that could not be read is named in `unread`, and a section heading then states no total, so "nothing
 * happened" is never read off a read that failed.
 *
 * The text a call is handed is `./continuityRender.ts`. Pure: every input is already read. No filesystem, no clock.
 */
import type { RunEvent } from "../handover/ledger.js";
import type { IntakeMark } from "../supervisor/intake.js";

import type { ContinuityCall, ContinuityReading } from "./continuityCalls.js";
import { clip } from "./packText.js";
import { RELAY_ACTION_KINDS, reachedSupervisorChat } from "./relayIntake.js";
import type { TurnRecord } from "./relayStore.js";

/** How far back a call looks for where the last one left off. */
export const CONTINUITY_LOOKBACK_MS = 72 * 60 * 60 * 1000;

/** The widest window `talk recent` reads, in hours: a week. */
export const MAX_RECENT_HOURS = 168;

/** What the supervisor's side left on the record about one relay. */
interface SteerOutcome {
  /** Whether a board row carries this relay's slug AND its `talk:<turnId>` anchor. */
  readonly rowPresent: boolean;
  readonly settlement: { readonly kind: string; readonly witness: string | undefined } | undefined;
  readonly marks: readonly { readonly kind: string; readonly witness: string; readonly atIso: string }[];
  /** The latest act on the row at or after the relay registered: claimed, dispatched, started and the rest. */
  readonly lastAction: { readonly kind: string; readonly atIso: string } | undefined;
}

/** One steer the owner gave the voice, or typed to the supervisor on the console, and what became of it. */
export interface ContinuitySteer {
  readonly turnId: string;
  readonly slug: string;
  /** When its board row was confirmed. */
  readonly atIso: string;
  /** The owner's transcribed words since the relay before it, or their typed words when {@link typed}. */
  readonly heard: string;
  /** Whether the owner typed it on the console's steer composer rather than saying it to the voice. */
  readonly typed: boolean;
  /** What the voice relayed; empty when its reading was dropped and only the owner's words travelled. */
  readonly words: string;
  readonly delivery: { readonly kind: string; readonly detail: string } | null;
  /** Whether the line reached the supervisor's chat: typed there, or queued behind a running turn. */
  readonly reachedChat: boolean;
  readonly outcome: SteerOutcome;
}

/** One ruling journalled on a row. */
export interface ContinuityRuling {
  readonly slug: string;
  readonly atIso: string;
  readonly ruling: string;
  readonly anchor: string;
}

/** One lesson recorded in the knowledge register. */
export interface ContinuityKnowledge {
  readonly id: string;
  readonly claim: string;
  readonly verdict: string;
  readonly domain: string;
  readonly recordedAtIso: string;
}

/** A half that could not be read, and why. */
export interface ContinuityUnread {
  readonly section: "steers" | "rulings" | "knowledge" | "typed" | "calls";
  readonly why: string;
}

/** One turn the owner typed straight into the supervisor's chat, not through the voice, and the reply that followed. */
export interface ContinuityTyped {
  readonly atIso: string;
  readonly text: string;
  /** Set when the supervisor read clipped the owner's turn (`TURN_MAX_CHARS`): their own words, so a real cut. */
  readonly cut?: true;
  /**
   * The supervisor's next turn when it came before the owner's next one; `undefined` when it has not answered. Its `cut` says
   * the supervisor read clipped it, the standing preview of a report that runs long.
   */
  readonly reply: { readonly atIso: string; readonly text: string; readonly cut?: true } | undefined;
}

/** The whole read, as `talk recent --json` prints it and the pack stores it. */
export interface TalkContinuity {
  readonly builtIso: string;
  /** The window's floor: every steer, ruling and lesson here is at or after it. */
  readonly sinceIso: string;
  readonly steers: readonly ContinuitySteer[];
  readonly rulings: readonly ContinuityRuling[];
  readonly knowledge: readonly ContinuityKnowledge[];
  /** Newest first. */
  readonly typed: readonly ContinuityTyped[];
  /** Newest first. */
  readonly calls: readonly ContinuityCall[];
  readonly unread: readonly ContinuityUnread[];
}

/**
 * The lessons half of a read, which is all of it the pack stores: the mint reads every other half fresh, and
 * storing them anyway is what took the pack past the bound the mint reads it under — 1,213,551 of its 1,443,970
 * bytes in a measured pack (`jq '.continuity|tostring|length' $SLOPWEAVER_HOME/talk/pack.json` on a pack written
 * before this change), so every call was minted without it.
 */
export interface StoredLessons {
  /** When the pack's read ran: a lesson recorded since is not here. */
  readonly builtIso: string;
  readonly knowledge: readonly ContinuityKnowledge[];
  /** The knowledge half's own unread entry, when the pack's read could not open the store. */
  readonly unread: readonly ContinuityUnread[];
}

/** The part of a board row a steer's outcome is read from. */
export interface SteerRowEvidence {
  readonly slug: string;
  readonly anchor: string | undefined;
  readonly settlement: string | undefined;
  readonly settlementWitness: string | undefined;
  readonly events: readonly RunEvent[];
}

/** Where the owner's heard words are cut, in characters. */
export const HEARD_CHARS = 600;

/** Where the relayed words, a ruling, a claim and a witness are cut, in characters. */
export const NOTE_CHARS = 300;

/**
 * Whether an instant is at or after a floor. An instant that does not parse is never inside a window.
 *
 * @param atIso the instant to test
 * @param sinceIso the floor
 * @returns whether it falls inside
 */
export function atOrAfter({ atIso, sinceIso }: { atIso: string; sinceIso: string }): boolean {
  const at = Date.parse(atIso);
  return !Number.isNaN(at) && at >= Date.parse(sinceIso);
}

/**
 * Newest first by an instant field, a stable order for ties.
 *
 * @param items what to order
 * @param at the instant each is ordered by
 * @returns a new array, newest first
 */
export function newestFirst<T>({ items, at }: { items: readonly T[]; at: (item: T) => string }): readonly T[] {
  return items.toSorted((a, b) => Date.parse(at(b)) - Date.parse(at(a)));
}

/**
 * What the supervisor's side left on the record about one relay: its row, the latest act on that row since the
 * relay registered, and the intake marks on its anchor.
 *
 * @param record the registered relay
 * @param atIso when it registered — acts before it are not about it
 * @param rows the rows relays created, with their journals
 * @param marks every intake mark
 * @returns the outcome
 */
function outcomeOf({
  record,
  atIso,
  rows,
  marks,
}: {
  record: TurnRecord;
  atIso: string;
  rows: readonly SteerRowEvidence[];
  marks: readonly IntakeMark[];
}): SteerOutcome {
  const matching = rows.filter((row) => row.slug === record.slug && row.anchor === record.anchor);
  // A settled row first; the sort is stable, so otherwise the first match.
  const row = matching.toSorted((a, b) => Number(b.settlement !== undefined) - Number(a.settlement !== undefined))[0];
  if (row === undefined) {
    return {
      lastAction: undefined,
      marks: marksOn({ anchor: record.anchor, marks }),
      rowPresent: false,
      settlement: undefined,
    };
  }
  const actions = row.events.filter(
    (event) => RELAY_ACTION_KINDS.has(event.kind) && atOrAfter({ atIso: event.atIso, sinceIso: atIso }),
  );
  const last = newestFirst({ at: (event) => event.atIso, items: actions })[0];
  return {
    lastAction: last === undefined ? undefined : { atIso: last.atIso, kind: last.kind },
    marks: marksOn({ anchor: record.anchor, marks }),
    rowPresent: true,
    settlement: row.settlement === undefined ? undefined : { kind: row.settlement, witness: row.settlementWitness },
  };
}

/**
 * The intake marks on one relay's anchor.
 *
 * @param anchor the relay's `talk:<turnId>`
 * @param marks every intake mark
 * @returns the marks on it, as the outcome carries them
 */
function marksOn({ anchor, marks }: { anchor: string; marks: readonly IntakeMark[] }): SteerOutcome["marks"] {
  return marks
    .filter((mark) => mark.pointer === anchor)
    .map((mark) => ({ atIso: mark.markedAtIso, kind: mark.kind, witness: mark.witness }));
}

/**
 * The relays in the window as steers, newest first, each with what became of it.
 *
 * A row counts only when it carries BOTH the relay's slug and its `talk:<turnId>` anchor — the same pairing
 * `./relayIntake.ts` reads, since two docs can share a slug. Of several matching rows a settled one wins.
 *
 * @param records the registered relay turns (`relayStore.readRelayTurns`)
 * @param rows the rows those relays created, with their journals
 * @param marks every intake mark; one on `talk:<turnId>` is the supervisor saying what it did
 * @returns the steers, newest first
 */
export function steersOf({
  records,
  rows,
  marks,
}: {
  records: readonly TurnRecord[];
  rows: readonly SteerRowEvidence[];
  marks: readonly IntakeMark[];
}): readonly ContinuitySteer[] {
  const steers: ContinuitySteer[] = [];
  for (const record of records) {
    if (record.state !== "registered" || record.registeredAtIso === null) {
      continue;
    }
    const atIso = record.registeredAtIso;
    steers.push({
      atIso,
      delivery: record.delivery === null ? null : { detail: record.delivery.detail, kind: record.delivery.kind },
      heard: record.heard,
      reachedChat: reachedSupervisorChat({ delivery: record.delivery }),
      outcome: outcomeOf({ atIso, marks, record, rows }),
      slug: record.slug,
      turnId: record.turnId,
      typed: record.typed,
      words: record.words,
    });
  }
  return newestFirst({ at: (steer) => steer.atIso, items: steers });
}

/**
 * The rulings journalled in the window, newest first.
 *
 * @param journals each run journal read, by the slug it belongs to
 * @param sinceIso the window's floor
 * @returns the rulings
 */
export function rulingsSince({
  journals,
  sinceIso,
}: {
  journals: readonly { readonly slug: string; readonly events: readonly RunEvent[] }[];
  sinceIso: string;
}): readonly ContinuityRuling[] {
  const rulings: ContinuityRuling[] = [];
  for (const journal of journals) {
    for (const event of journal.events) {
      if (event.kind === "ruling" && atOrAfter({ atIso: event.atIso, sinceIso })) {
        rulings.push({ anchor: event.anchor, atIso: event.atIso, ruling: event.ruling, slug: journal.slug });
      }
    }
  }
  return newestFirst({ at: (ruling) => ruling.atIso, items: rulings });
}

/**
 * The lessons recorded in the window, newest first.
 *
 * @param rows every lesson the register holds
 * @param sinceIso the window's floor
 * @returns the lessons
 */
export function knowledgeSince({
  rows,
  sinceIso,
}: {
  rows: readonly ContinuityKnowledge[];
  sinceIso: string;
}): readonly ContinuityKnowledge[] {
  const kept = rows.filter((row) => atOrAfter({ atIso: row.recordedAtIso, sinceIso }));
  return newestFirst({ at: (row) => row.recordedAtIso, items: kept });
}

/**
 * The fresh read taken at mint, with the knowledge half taken from the stored pack's own read when the mint
 * skipped it — a store connection costs seconds a connecting call should not wait. That read is as old as the
 * pack, so the half stays named unread with the instant it covers up to: a lesson recorded since is not in it,
 * and a heading must not state a total over a window it did not read to the end.
 *
 * @param fresh what the mint read just now
 * @param stored the lessons the stored pack carries, when a pack rode in
 * @returns the read to render
 */
export function withStoredKnowledge({
  fresh,
  stored,
}: {
  fresh: TalkContinuity;
  stored: StoredLessons | undefined;
}): TalkContinuity {
  if (stored === undefined || stored.unread.some((entry) => entry.section === "knowledge")) {
    return fresh;
  }
  return {
    ...fresh,
    knowledge: knowledgeSince({ rows: stored.knowledge, sinceIso: fresh.sinceIso }),
    unread: [
      ...fresh.unread.filter((entry) => entry.section !== "knowledge"),
      {
        section: "knowledge",
        why: `read when the pack was built, ${stored.builtIso}, so a lesson recorded since is not here — recent_steers reads them live`,
      },
    ],
  };
}

/**
 * A read in which nothing could be read, every half named with why — what a caller holds when the read itself
 * threw, so the call still connects and the voice says it could not look rather than that nothing happened.
 *
 * @param builtIso when the read was attempted
 * @param sinceIso the window's floor
 * @param why what went wrong
 * @returns the empty read, every half unread
 */
export function unreadContinuity({
  builtIso,
  sinceIso,
  why,
}: {
  builtIso: string;
  sinceIso: string;
  why: string;
}): TalkContinuity {
  return {
    builtIso,
    knowledge: [],
    rulings: [],
    sinceIso,
    calls: [],
    steers: [],
    typed: [],
    unread: (["steers", "typed", "calls", "rulings", "knowledge"] as const).map((section) => ({ section, why })),
  };
}

/**
 * A call's reading with the line it last told the owner cut where the render cuts it; the link is never cut, since a cut
 * link opens nothing, and the call file already bounds it.
 *
 * @param reading the call's reading, when it had one
 * @returns the same reading, its told line cut
 */
function readingForStorage({ reading }: { reading: ContinuityReading | undefined }): ContinuityReading | undefined {
  if (reading?.lastTold === undefined) {
    return reading;
  }
  return { ...reading, lastTold: clip({ max: HEARD_CHARS, text: reading.lastTold }) };
}

/**
 * The read with every passage cut where the render cuts it, so what is stored or printed is bounded by the
 * number of entries rather than the length of any one.
 *
 * @param continuity the read
 * @returns the same read, each passage cut
 */
export function continuityForStorage({ continuity }: { continuity: TalkContinuity }): TalkContinuity {
  const cut = ({ text }: { text: string }): string => clip({ max: NOTE_CHARS, text });
  return {
    ...continuity,
    calls: continuity.calls.map((call) => ({
      ...call,
      end: cut({ text: call.end }),
      lines: call.lines.map((line) => ({ ...line, text: clip({ max: HEARD_CHARS, text: line.text }) })),
      reading: readingForStorage({ reading: call.reading }),
    })),
    knowledge: continuity.knowledge.map((row) => ({ ...row, claim: cut({ text: row.claim }) })),
    rulings: continuity.rulings.map((ruling) => ({ ...ruling, ruling: cut({ text: ruling.ruling }) })),
    typed: continuity.typed.map((typed) => ({
      ...typed,
      reply: typed.reply === undefined ? undefined : { ...typed.reply, text: cut({ text: typed.reply.text }) },
      text: clip({ max: HEARD_CHARS, text: typed.text }),
    })),
    steers: continuity.steers.map((steer) => ({
      ...steer,
      heard: clip({ max: HEARD_CHARS, text: steer.heard }),
      outcome: {
        ...steer.outcome,
        marks: steer.outcome.marks.map((mark) => ({ ...mark, witness: cut({ text: mark.witness }) })),
        settlement:
          steer.outcome.settlement === undefined
            ? undefined
            : {
                kind: steer.outcome.settlement.kind,
                witness:
                  steer.outcome.settlement.witness === undefined
                    ? undefined
                    : cut({ text: steer.outcome.settlement.witness }),
              },
      },
      words: cut({ text: steer.words }),
    })),
    unread: continuity.unread.map((entry) => ({ ...entry, why: cut({ text: entry.why }) })),
  };
}

/**
 * The lessons half of a read as the pack stores it, each claim cut where the render cuts it.
 *
 * @param continuity the pack's read, taken with the store open
 * @returns its build instant, its lessons and the knowledge half's unread entry
 */
export function lessonsForStorage({ continuity }: { continuity: TalkContinuity }): StoredLessons {
  return {
    builtIso: continuity.builtIso,
    knowledge: continuity.knowledge.map((row) => ({ ...row, claim: clip({ max: NOTE_CHARS, text: row.claim }) })),
    unread: continuity.unread
      .filter((entry) => entry.section === "knowledge")
      .map((entry) => ({ ...entry, why: clip({ max: NOTE_CHARS, text: entry.why }) })),
  };
}
