/**
 * What `slopweaver talk find-card` says back: each found row placed on the board, in words the owner can hear. The ranking
 * that chose the rows is `./cardFind.ts`; this is only how the voice is told where each one stands.
 */
import { isClosedBoardSection } from "../handover/boardRefusal.js";
import type { BoardSection } from "../handover/boardTypes.js";
import { OWNER_WAIT_KIND, type OwnerWaitKind } from "../handover/ownerWait.js";
import { wordMatches } from "../pages/findWords.js";
import type { PlacedDraft } from "./queueDraftFind.js";

/** A found row placed on the board: where it stands, and what it says it is about. */
export interface PlacedCard {
  readonly slug: string;
  readonly section: BoardSection;
  /** What the row is really waiting on, as `handover list --json` publishes it — the verdict the Queue draws off. */
  readonly ownerWait: OwnerWaitKind;
  readonly summary: string | undefined;
  readonly matched: readonly string[];
  /** The probe budget ran out before this row, or a row it waits on, was checked: its section is as written. */
  readonly unchecked: boolean;
}

/**
 * Each board section as the owner hears it, for a row the Queue does not draw — which is exactly the card they could
 * not find by looking at it. A row it does draw is {@link ON_OWNER_QUEUE} whatever its section, a row still asking the
 * owner that it does not is said by {@link WAIT_SAID}, and a WAITING ON OWNER row asking nothing by {@link HELD_UNASKED}.
 */
const SECTION_SAID: Readonly<Record<Exclude<BoardSection, "WAITING ON OWNER">, string>> = {
  "AWAITING SHIP": "built and waiting to land",
  "CLOSED — NOT SHIPPED": "closed without shipping",
  CONTRADICTION: "on the board, its state contradicting itself",
  DONE: "done",
  "IN FLIGHT": "a session is working on it now",
  "LOOKS SHIPPED": "looks shipped, not yet closed",
  "NOT YET": "on the board, waiting on another row first",
  PAUSED: "paused",
  "RUN NOW": "on the board, ready for a session, nobody on it yet",
};

/**
 * A row the Queue draws. The Queue draws a row by its owner-wait alone (`site/lib/ownerAsks.ts`, `ownerAsksOf`), never by
 * its section, and the board can place a row waiting on the owner outside WAITING ON OWNER — in LOOKS SHIPPED when its
 * probes all pass — so such a row says this in every section.
 */
const ON_OWNER_QUEUE = "on your Queue, waiting on your word";

/**
 * A row still asking the owner that the Queue does not draw, by what it is really waiting on, whatever section the
 * board placed it in: a settled ask composes to DONE or CLOSED — NOT SHIPPED (`../handover/boardEvidence.ts`), where its
 * section alone would say only "done". A call once heard "on your Queue" for a row the owner had already ruled on, the
 * voice called `open_card` on it, and the console refused it in front of
 * them. Each mirrors `waitWord`'s reason and says it is not on the owner's Queue.
 */
const WAIT_SAID: Readonly<Record<Exclude<OwnerWaitKind, typeof OWNER_WAIT_KIND | "not-waiting">, string>> = {
  "already-ruled": "not on your Queue: you already ruled on it, and it waits on a session to act on that",
  "not-runnable": "not on your Queue: it is paused",
  settled: "not on your Queue: it is settled, its question never cleared",
};

/**
 * A row that would be the owner's, composed before its probes were checked. A passing probe moves a registered ask to
 * LOOKS SHIPPED, where `handover list --json` publishes it `not-waiting` and the Queue does not draw it, so "on your
 * Queue" would be a guess that fails in front of the owner.
 */
const UNCHECKED_QUEUE =
  "not known to be on your Queue: its probes ran out of time, so whether the Queue draws it is unchecked";

/** A WAITING ON OWNER row that asks the owner nothing — the one section a `not-waiting` row is not said by. */
const HELD_UNASKED = "not on your Queue: the board holds it for you, but no question is open on it";

/** A held draft the Queue draws, said as the card it is — it waits on the owner's word to send it, whatever the board says. */
const DRAFT_ON_OWNER_QUEUE = "on your Queue, a held draft waiting on your word";

/** The most held drafts one answer names, before the board rows. */
export const DRAFTS_SHOWN = 3;

/** The most live rows one answer names. */
export const LIVE_SHOWN = 6;

/** The most closed rows one answer names, after the live ones. */
export const CLOSED_SHOWN = 3;

/** How much of a row's summary a line carries, in graphemes. */
const SUMMARY_GRAPHEMES = 160;

/** How much of a held draft's own message its line carries, in graphemes. */
const DRAFT_OPENING_GRAPHEMES = 120;

/** Splits a summary where a reader sees a character break, so a cut never halves an emoji. */
const GRAPHEMES = new Intl.Segmenter("en", { granularity: "grapheme" });

/**
 * Where one row stands, as the owner hears it.
 *
 * @param section the board section the row composes to
 * @param ownerWait what the row is really waiting on, which alone decides whether it is on the owner's Queue
 * @returns the plain-words state
 */
export function sectionSaid({ section, ownerWait }: { section: BoardSection; ownerWait: OwnerWaitKind }): string {
  if (ownerWait === OWNER_WAIT_KIND) {
    return ON_OWNER_QUEUE;
  }
  if (ownerWait !== "not-waiting") {
    return WAIT_SAID[ownerWait];
  }
  if (section === "WAITING ON OWNER") {
    return HELD_UNASKED;
  }
  return SECTION_SAID[section];
}

/**
 * What one search answers: the held drafts on the owner's Queue first, then the live rows, best first, then a few closed
 * ones, each with its state in plain words, the board section, the start of its summary and the words it matched —
 * or one line saying nothing matches, naming what was searched, so "there is no card for that" is said from a search
 * rather than from a guess.
 *
 * A held draft is a card on the owner's Queue whatever the board says, so it is named in a group of its own ABOVE the
 * rows: a draft the owner asked for was once ranked against nothing, and the row that raised
 * it was closed and fell below the three closed rows shown (`./queueDraftFind.ts`).
 *
 * @param placed every found row the board placed, best first
 * @param drafts every held draft on the owner's Queue that matched, best first
 * @param said the words as the voice passed them, quoted back so a line never reads out a stemmed "acces"
 * @param closeAtTop how many rows the owner's words did not choose between
 * @param unsearchable the owner's words when none could be searched on
 * @param rowsSearched how many rows the board held
 * @param draftsSearched how many held drafts the owner's Queue draws
 * @returns the lines, top to bottom
 */
export function cardFindLines({
  placed,
  drafts,
  said,
  closeAtTop,
  unsearchable,
  rowsSearched,
  draftsSearched,
}: {
  placed: readonly PlacedCard[];
  drafts: readonly PlacedDraft[];
  said: readonly string[];
  closeAtTop: number;
  unsearchable: readonly string[];
  rowsSearched: number;
  draftsSearched: number;
}): readonly string[] {
  if (unsearchable.length > 0) {
    return [`no card searched: "${unsearchable.join(" ")}" names nothing to search on — pass what the card is about`];
  }
  const live = placed.filter((card) => !isClosedBoardSection({ section: card.section }));
  const closed = placed.filter((card) => isClosedBoardSection({ section: card.section }));
  const quoted = `"${said.join(" ")}"`;
  const across = `${String(rowsSearched)} board rows' summaries, the owner's words and open questions, and ${String(draftsSearched)} held drafts on the owner's Queue`;
  if (placed.length === 0 && drafts.length === 0) {
    return [`nothing matches ${quoted} — there is no card for that yet (searched ${across})`];
  }
  let heading = `${String(drafts.length)} held draft(s) and ${String(placed.length)} board row(s) matching ${quoted}, best first, drafts on the owner's Queue first, then live rows (searched ${across})`;
  if (closeAtTop > 1) {
    heading = `${heading}; ${String(closeAtTop)} close at the top, so read their summaries before naming one`;
  }
  const lines = [heading, ...draftBlock({ drafts })];
  if (drafts.length > 0 && placed.length > 0) {
    lines.push("board rows:");
  }
  return [...lines, ...rowBlock({ closed, live })];
}

/** The held drafts' group: a heading, the best few drafts, and how many more were left out. */
function draftBlock({ drafts }: { drafts: readonly PlacedDraft[] }): readonly string[] {
  if (drafts.length === 0) {
    return [];
  }
  const lines = [
    "held drafts on your Queue (open_card the key to put one in front of the owner):",
    ...drafts.slice(0, DRAFTS_SHOWN).map((draft) => draftLine({ draft })),
  ];
  if (drafts.length > DRAFTS_SHOWN) {
    lines.push(`  …${String(drafts.length - DRAFTS_SHOWN)} more held draft(s) not shown — pass fewer, rarer words`);
  }
  return lines;
}

/** The board rows: the best few live ones, then a few closed ones, each group saying how many more were left out. */
function rowBlock({ live, closed }: { live: readonly PlacedCard[]; closed: readonly PlacedCard[] }): readonly string[] {
  const lines: string[] = [];
  live.slice(0, LIVE_SHOWN).forEach((card) => {
    lines.push(cardLine({ card }));
  });
  if (live.length > LIVE_SHOWN) {
    lines.push(`  …${String(live.length - LIVE_SHOWN)} more live row(s) not shown — pass fewer, rarer words`);
  }
  if (live.length === 0 && closed.length > 0) {
    lines.push("  no LIVE row matches: every match below is closed");
  }
  if (closed.length > 0) {
    lines.push("closed:");
    closed.slice(0, CLOSED_SHOWN).forEach((card) => {
      lines.push(cardLine({ card }));
    });
  }
  if (closed.length > CLOSED_SHOWN) {
    lines.push(`  …${String(closed.length - CLOSED_SHOWN)} more closed row(s) not shown`);
  }
  return lines;
}

/**
 * One held draft's line: its Queue key (for open_card, never said aloud), that it is on the owner's Queue, where it goes and
 * as whom, what it is for, how the message itself opens, and the words it matched.
 */
function draftLine({ draft }: { draft: PlacedDraft }): string {
  const why = cutTo({ graphemes: SUMMARY_GRAPHEMES, text: draft.why });
  const says = cutTo({ graphemes: DRAFT_OPENING_GRAPHEMES, text: draft.says });
  const line = `  ${draft.key} — ${DRAFT_ON_OWNER_QUEUE}, to ${draft.to} as ${draft.as} — ${why} — it says "${says}"`;
  const where = matchPastOpening({ matched: draft.matched, says: draft.says });
  if (where === undefined) {
    return `${line} (matched ${draft.matched.join(", ")})`;
  }
  return `${line} … and where it matches, "${where}" (matched ${draft.matched.join(", ")})`;
}

/** How many words before the first match the second quote starts, so the match is read in its sentence. */
const LEAD_WORDS = 4;

/**
 * The stretch of a draft's message around the first word it matched, when that word lies past the opening its line
 * quotes — or `undefined` when the opening already shows it. Without it a draft matched only in its tail, under a
 * stale `why` and an opening about something else, reads as off topic though the search found the owner's words in it.
 */
function matchPastOpening({ says, matched }: { says: string; matched: readonly string[] }): string | undefined {
  const words = says.split(" ");
  const first = words.findIndex((word) =>
    word
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .some((pageWord) => matched.some((term) => wordMatches({ pageWord, word: term }))),
  );
  if (first === -1) {
    return undefined;
  }
  const throughMatch = words.slice(0, first + 1).join(" ");
  if (Array.from(GRAPHEMES.segment(throughMatch)).length < DRAFT_OPENING_GRAPHEMES) {
    return undefined;
  }
  const from = words.slice(Math.max(0, first - LEAD_WORDS)).join(" ");
  return `…${cutTo({ graphemes: DRAFT_OPENING_GRAPHEMES, text: from })}`;
}

/**
 * One row's line: slug (for tools, never said aloud), state, section, summary start, matched words — and, when its
 * probes were never checked, that the section is as written rather than as the board would compose it.
 */
function cardLine({ card }: { card: PlacedCard }): string {
  let summary = "(no summary)";
  if (card.summary !== undefined) {
    summary = cutTo({ graphemes: SUMMARY_GRAPHEMES, text: card.summary });
  }
  let said = sectionSaid({ ownerWait: card.ownerWait, section: card.section });
  if (card.unchecked && card.ownerWait === OWNER_WAIT_KIND) {
    said = UNCHECKED_QUEUE;
  }
  const line = `  ${card.slug} — ${said} [${card.section}] — ${summary} (matched ${card.matched.join(", ")})`;
  if (card.unchecked) {
    return `${line} — its probes ran out of time, so that is where it was written down, unchecked`;
  }
  return line;
}

/** A text cut to at most `graphemes` graphemes, an ellipsis marking the cut. */
function cutTo({ text, graphemes }: { text: string; graphemes: number }): string {
  const parts = Array.from(GRAPHEMES.segment(text.replace(/\s+/g, " ").trim()), (part) => part.segment);
  if (parts.length <= graphemes) {
    return parts.join("");
  }
  return `${parts.slice(0, graphemes - 1).join("")}…`;
}
