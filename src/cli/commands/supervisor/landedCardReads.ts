/**
 * The approved-draft gate's landing reads: the card-landing ledger once, then exactly the cards an active landing
 * names — one doc and run journal per landed ask, the hand register once when a hand card landed. No board scan, no
 * directory listing, no external call. The binding itself is pure (`../../../supervisor/draftLandingBinding.ts`).
 *
 * A read that fails is the card's `unreadable`, never an empty card: an ask whose journal would not read may be
 * exactly the one naming the draft the owner's yes was for. A card whose record is GONE — no doc live or archived, no hand
 * line under its id — reads as no texts, since there is no card left for an id to sit on, and is reported as vanished
 * so a drop can still refuse to end a row the owner's words may have reached. An ask's journal and a hand
 * step's postings are read as they stood when the owner spoke; its DOC is read as it stands, since a doc keeps no history and
 * settling the ask after the owner's answer rewrites it — so the landing itself keeps the ids the card named as the owner's words
 * landed ({@link landedCardDraftIds}), and a doc rewritten after the owner's yes still binds them.
 */
import type { HandRow } from "../../../hand/row.js";
import type { HandStep } from "../../../hand/step.js";
import { handRegisterPath, readHandRows } from "../../../hand/store.js";
import { draftIdsNamed } from "../../../handover/namedDraftGate.js";
import { isSafeSlug, readRunJournal } from "../../../handover/runStore.js";
import { readExactDoc } from "../../../handover/store.js";
import type { SlackDraftItem } from "../../../outbound/slack/draftRegister.js";
import { stateHomePaths } from "../../../stateHome.js";
import {
  type DraftLandingBindings,
  type DraftLandingCardRead,
  draftLandingBindings,
  landingLedgerRow,
  namesDraftsInTexts,
  type VanishedDraftLanding,
} from "../../../supervisor/draftLandingBinding.js";
import {
  activeCardLandings,
  type CardLandedRow,
  type CardLandingRow,
  keptDraftIds,
  landedAnchors,
  utteranceLandings,
} from "../../../talk/cardLanding.js";
import { readCardLandings } from "../../../talk/cardLandingStore.js";
import { unreadableCardLinesOfAnyCard } from "../../../talk/cardLedgerFile.js";
import { askCardTexts, handCardTexts, openedAskSlug, stepAtLanding } from "./landedCardTexts.js";

/**
 * Every active landing bound to the held drafts its card names, or why the landing ledger could not be read. Beside
 * the bindings, every landing whose card's record is gone: the tick gate passes those (a swept ask owes nothing it can
 * still read), while a drop that would end a row's words may not pass one the owner's words reached after the row was parked
 * (`../slack/draftDropGuard.ts`).
 *
 * @param home the Slopweaver home the ledgers live under
 * @param items every folded draft-register row
 * @param skipped the draft-register lines the parse passed over, any of which may be a named row's
 * @returns the bindings and the vanished landings, or the reason
 */
export function readLandedDraftBindings({
  home,
  items,
  skipped,
}: {
  home: string;
  items: readonly SlackDraftItem[];
  skipped: readonly { readonly id: string | undefined }[];
}):
  | {
      readonly kind: "read";
      readonly bindings: DraftLandingBindings;
      readonly vanished: readonly VanishedDraftLanding[];
      readonly ledgerRows: number;
    }
  | { readonly kind: "unreadable"; readonly why: string } {
  const ledger = readCardLandings({ home });
  if (ledger.isErr()) {
    return { kind: "unreadable", why: `the card-landing ledger would not read — ${ledger.error.message}` };
  }
  // A refused line recording a key that is no card key was never a landing on any card, so it cannot be the yes.
  const unreadable = unreadableCardLinesOfAnyCard({ lines: ledger.value.unreadableLines });
  if (unreadable.length > 0) {
    const at = unreadable.map((line) => String(line.lineNumber)).join(", ");
    return {
      kind: "unreadable",
      why: `card-landing ledger line(s) ${at} would not read, and one may be the owner's yes`,
    };
  }
  const textCards = activeCardLandings({ rows: ledger.value.rows }).filter((landing) =>
    namesDraftsInTexts({ cardKey: landing.cardKey }),
  );
  const hand = lazyHandSteps({ home });
  const reads = textCards.map((landing) => ({ landing, ...cardRead({ hand, home, landing }) }));
  const cards = reads.map((read) => read.card);
  return {
    bindings: draftLandingBindings({ cards, items, landingRows: ledger.value.rows, skipped }),
    kind: "read",
    ledgerRows: ledger.value.rows.length,
    vanished: reads
      .filter((read) => read.gone)
      .map(({ landing }) => ({ landing, ledgerRow: landingLedgerRow({ landing, landingRows: ledger.value.rows }) })),
  };
}

/**
 * The Slack draft ids an ask or hand card names as the owner's words land on it, read exactly as the gate reads that card, so
 * the landing can keep them: the ask's doc keeps no history, and settling it after the owner's answer rewrites it.
 * A card that names drafts only by its key, or names none, yields none. A card that will not read yields
 * why, kept on the row so the gate reads the landing as unreadable even once the card reads again, since by then it
 * may have been rewritten. Every id, and every failed read, an earlier row of the same utterance
 * kept is carried too: a grown utterance must not lose an id the card dropped in between.
 *
 * @param home the Slopweaver home the card's records live under
 * @param landing the row about to be written
 * @param rows the landing ledger as read under its lock, whose rows of this utterance carry what they kept
 * @returns the row's `draftIds` and `draftIdsUnread` fields, each absent when there is nothing to keep
 */
export function landedCardDraftIds({
  home,
  landing,
  rows,
}: {
  home: string;
  landing: CardLandedRow;
  rows: readonly CardLandingRow[];
}): Pick<CardLandedRow, "draftIds" | "draftIdsUnread"> {
  const earlier = utteranceLandings({ ...landing, laterAnchors: landedAnchors({ row: landing }), rows });
  const now = namedNow({ home, landing });
  const ids = [...new Set([...earlier.flatMap((row) => keptDraftIds({ row })), ...now.ids])];
  const unread = [...earlier.map((row) => row.draftIdsUnread), now.unread].find((why) => why !== undefined);
  return {
    ...(ids.length === 0 ? {} : { draftIds: ids }),
    ...(unread === undefined ? {} : { draftIdsUnread: unread }),
  };
}

/** The ids the landed card's texts name now — none when it names drafts only by its key — or why it will not read. */
function namedNow({ home, landing }: { home: string; landing: CardLandedRow }): {
  readonly ids: readonly string[];
  readonly unread?: string;
} {
  if (!namesDraftsInTexts({ cardKey: landing.cardKey })) {
    return { ids: [] };
  }
  const { card } = cardRead({ hand: lazyHandSteps({ home }), home, landing });
  if (card.kind === "unreadable") {
    return { ids: [], unread: card.why };
  }
  return { ids: draftIdsNamed({ texts: card.texts }) };
}

/** The hand register's postings per step id, read at most once and only when a hand card asks for it. */
type HandSteps = () => { readonly kind: "read"; readonly steps: ReadonlyMap<string, readonly HandStep[]> } | Unreadable;

/** Why a card's texts could not be read. */
interface Unreadable {
  readonly kind: "unreadable";
  readonly why: string;
}

/** Read the hand register on first use, keeping every posting of each step id in register order, open or settled. */
function lazyHandSteps({ home }: { home: string }): HandSteps {
  let read: ReturnType<HandSteps> | undefined;
  return () => {
    if (read !== undefined) {
      return read;
    }
    const rows = readHandRows({ missing: "empty", path: handRegisterPath({ home }) });
    if (rows.isErr()) {
      read = { kind: "unreadable", why: `the hand register would not read — ${rows.error.message}` };
    } else if (rows.value.unparsed.length > 0) {
      read = {
        kind: "unreadable",
        why: `${String(rows.value.unparsed.length)} hand-register line(s) would not read, and one may be this step`,
      };
    } else {
      read = { kind: "read", steps: postingsById({ rows: rows.value.rows }) };
    }
    return read;
  };
}

/** Every posting of each hand step id, in register order. */
function postingsById({ rows }: { rows: readonly HandRow[] }): ReadonlyMap<string, readonly HandStep[]> {
  const steps = new Map<string, HandStep[]>();
  for (const row of rows) {
    if (row.kind !== "posted") {
      continue;
    }
    const earlier = steps.get(row.step.id);
    if (earlier === undefined) {
      steps.set(row.step.id, [row.step]);
    } else {
      earlier.push(row.step);
    }
  }
  return steps;
}

/**
 * One landed ask or hand card's drawn texts, as the card stood when the owner SPOKE (`decidedIso`) rather than when the
 * landing was written: a question opened in between must not stand in for the one the owner answered.
 */
function cardRead({ hand, home, landing }: { hand: HandSteps; home: string; landing: CardLandedRow }): {
  readonly card: DraftLandingCardRead;
  readonly gone: boolean;
} {
  const cardKey = landing.cardKey;
  const id = cardKey.slice(cardKey.indexOf(":") + 1);
  const texts = cardKey.startsWith("ask:")
    ? askTexts({ home, landedIso: landing.decidedIso, slug: id })
    : handTexts({ hand, home, id, landedIso: landing.decidedIso });
  if (texts.kind === "unreadable") {
    return { card: { cardKey, kind: "unreadable", why: texts.why }, gone: false };
  }
  return { card: { cardKey, kind: "read", texts: texts.texts }, gone: texts.gone };
}

/** What one card read found; `gone` when the card's record, or the ask it opens, is no longer there to read. */
type TextsRead =
  { readonly kind: "read"; readonly texts: readonly (string | undefined)[]; readonly gone: boolean } | Unreadable;

/** One ask's drawn texts at its landing: its doc, live or archived, and its run journal. */
function askTexts({ home, landedIso, slug }: { home: string; landedIso: string; slug: string }): TextsRead {
  if (!isSafeSlug({ slug })) {
    return { kind: "unreadable", why: `ask:${slug} is not a slug a doc can carry` };
  }
  const paths = stateHomePaths({ home });
  const doc = readExactDoc({ handoverDir: paths.handovers, slug });
  if (doc.isErr()) {
    return { kind: "unreadable", why: doc.error.message };
  }
  if (doc.value === undefined) {
    return { gone: true, kind: "read", texts: [] };
  }
  const journal = readRunJournal({ runsDir: paths.runs, slug });
  if (journal.isErr()) {
    return { kind: "unreadable", why: `the run journal of ${slug} would not read — ${journal.error.message}` };
  }
  if (journal.value.unreadable.length > 0) {
    return {
      kind: "unreadable",
      why: `${String(journal.value.unreadable.length)} line(s) of ${slug}'s run journal would not read on this build, and one may carry the question the owner saw`,
    };
  }
  const texts = askCardTexts({ doc: doc.value.doc, events: journal.value.events, landedIso });
  return { gone: false, kind: "read", texts };
}

/** One hand step's drawn texts, and the ask its link opens when it opens one. */
function handTexts({
  hand,
  home,
  id,
  landedIso,
}: {
  hand: HandSteps;
  home: string;
  id: string;
  landedIso: string;
}): TextsRead {
  const steps = hand();
  if (steps.kind === "unreadable") {
    return steps;
  }
  const postings = steps.steps.get(id);
  const step = postings === undefined ? undefined : stepAtLanding({ landedIso, postings });
  if (step === undefined) {
    return { gone: true, kind: "read", texts: [] };
  }
  const own = handCardTexts({ step });
  const opened = openedAskSlug({ url: step.url });
  if (opened === undefined) {
    return { gone: false, kind: "read", texts: own };
  }
  const ask = askTexts({ home, landedIso, slug: opened });
  if (ask.kind === "unreadable") {
    return ask;
  }
  return { gone: ask.gone, kind: "read", texts: [...own, ...ask.texts] };
}
