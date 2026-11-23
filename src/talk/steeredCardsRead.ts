/**
 * The effectful half of `./steeredCards.ts`: every relay that named a Queue card in the last
 * {@link STEER_WINDOW_MS}, joined to its landing, its row, its intake mark and the chair's ticks, and judged.
 *
 * ## Exact joins only
 *
 * A relay is its receipt in `talk/relays.jsonl` — appended once the row is on the board, so a receipt IS the word
 * "recorded". Its landing is the one whose anchor is the relay's own `talk:<turnId>` on the card the relay named
 * (`about`), never a transcript landing of the same words on another card. Its row is the doc filed at its slug
 * whose anchor is that same pointer: a slug is the first twelve hex of a turn id, and a doc whose anchor names
 * another turn witnesses nothing for this one. Nothing scans the board — one exact-slug read and one journal per
 * relay.
 *
 * ## A source that does not read is never "no action"
 *
 * A ledger every verdict needs that will not read fails the whole reading, and the console says so. A source one
 * relay needs — its doc, its journal — that will not read makes THAT verdict `unread`. Either way the page is told
 * it does not know, rather than shown a returned card claiming the chair never looked.
 *
 * The chair's passes come from the tick ledger's tail (`./steeredCardsTicks.ts`).
 */
import type { AutonomyLedgerPort } from "../autonomy/port.js";
import type { AutonomyRecord } from "../autonomy/types.js";
import { err, ok, type Result } from "../lib/result.js";
import { stateHomePaths } from "../stateHome.js";
import type { IntakeMark } from "../supervisor/intake.js";
import { readIntakeMarks } from "../supervisor/intakeStore.js";
import { supervisorTickLedgerPath } from "../supervisor/tickStore.js";
import { activeCardLandings } from "./cardLanding.js";
import { type CardLandingsRead, readCardLandings } from "./cardLandingStore.js";
import { unreadableCardLinesForKeys } from "./cardLedgerFile.js";
import { namesOneRegisterCard } from "./prCardKey.js";
import { relayAnchor } from "./relayDraft.js";
import { readRelayLedger, type TurnRecord } from "./relayStore.js";
import {
  firstPassAfter,
  type SteerEvidence,
  type SteerLanding,
  type SteerVerdict,
  steerVerdict,
} from "./steeredCards.js";
import { relayAction, relayLanding } from "./steeredCardsEvidence.js";
import { type ChairTick, readTickTail, type TickTailError } from "./steeredCardsTicks.js";

/** How far back a relay is reported: a week, past which a steer the page still holds is dropped by the page too. */
const STEER_WINDOW_MS = 7 * 24 * 60 * 60_000;

/** How much of the owner's words a steer carries back to the page: the collapsed line shows a clip, never the whole. */
const HEARD_CLIP = 280;

/** One steer as the console reads it. */
interface SteeredCard {
  readonly turnId: string;
  readonly relaySlug: string;
  readonly cardKey: string;
  readonly heard: string;
  readonly registeredAtIso: string;
  readonly verdict: SteerVerdict;
}

/** What `talk steers` reports. */
export interface SteeredCardsReading {
  readonly observedAtIso: string;
  /** The oldest registration this reading judges: a steer before it is out of the window, never one with no row. */
  readonly sinceIso: string;
  /** Relay-ledger lines that did not decode: a steer missing from `steers` may be one of them, never proof it was not recorded. */
  readonly undecodedRelays: number;
  readonly steers: readonly SteeredCard[];
}

/** A ledger every verdict needs would not read. */
interface SteerSourceUnreadableError {
  readonly code: "STEER_SOURCE_UNREADABLE";
  readonly message: string;
  readonly source: string;
}

/** Why the reading could not be made. */
export type SteeredCardsError = SteerSourceUnreadableError;

/** Constructors for {@link SteeredCardsError}. */
const SteeredCardsErrors = {
  sourceUnreadable: ({ source, why }: { source: string; why: string }): SteerSourceUnreadableError => ({
    code: "STEER_SOURCE_UNREADABLE",
    message: `${source} did not read: ${why}`,
    source,
  }),
} as const;

/**
 * The relays the reading covers: one receipt per turn, registered inside the window, naming a card a register holds —
 * never an Automations `recipe:` card or an Alignment `align:` question, which no register holds and so nothing
 * collapsed.
 *
 * @param rows the receipts, in file order
 * @param sinceMs the window's floor
 * @returns the latest receipt per turn and card
 */
export function steerReceipts({
  rows,
  sinceMs,
}: {
  rows: readonly TurnRecord[];
  sinceMs: number;
}): readonly TurnRecord[] {
  // Keyed on the turn AND the card, so a turn receipted against two cards keeps both rather than the later hiding the
  // earlier from the steer that names it.
  const byTurn = new Map<string, TurnRecord>();
  for (const row of rows) {
    if (row.registeredAtIso === null || Date.parse(row.registeredAtIso) < sinceMs) {
      continue;
    }
    if (!namesOneRegisterCard({ key: row.about })) {
      continue;
    }
    byTurn.set(`${row.turnId} ${row.about}`, row);
  }
  return [...byTurn.values()];
}

/**
 * Read and judge every steer in the window.
 *
 * @param home the Slopweaver home
 * @param handoverDir the board directory
 * @param ledger the autonomy ledger, read only when a steer answers a check-in
 * @param nowIso the instant judged at
 * @returns the reading, or the ledger that would not read
 */
export async function readSteeredCards({
  home,
  handoverDir,
  ledger,
  nowIso,
}: {
  home: string;
  handoverDir: string;
  ledger: AutonomyLedgerPort;
  nowIso: string;
}): Promise<Result<SteeredCardsReading, SteeredCardsError>> {
  const relays = readRelayLedger({ home });
  if (relays.isErr()) {
    return err(SteeredCardsErrors.sourceUnreadable({ source: "talk/relays.jsonl", why: relays.error.message }));
  }
  const sinceMs = Date.parse(nowIso) - STEER_WINDOW_MS;
  const sinceIso = new Date(sinceMs).toISOString();
  // A receipt whose anchor is not its own turn's would join another relay's landing and action: not one.
  const own = relays.value.rows.filter((row) => row.anchor === relayAnchor({ turnId: row.turnId }));
  const undecodedRelays = relays.value.undecoded + relays.value.rows.length - own.length;
  const receipts = steerReceipts({ rows: own, sinceMs });
  if (receipts.length === 0) {
    return ok({ observedAtIso: nowIso, sinceIso, steers: [], undecodedRelays });
  }
  const sources = await readSteerSources({ home, ledger, receipts });
  if (sources.isErr()) {
    return err(sources.error);
  }
  const { checkIns, landings, marks } = sources.value;
  const active = activeCardLandings({ rows: landings.rows });
  const runsDir = stateHomePaths({ home }).runs;
  const judged = receipts.map((receipt) => {
    const landing = relayLanding({ active, anchor: receipt.anchor, cardKey: receipt.about, rows: landings.rows });
    const action = relayAction({ checkIns, handoverDir, landing, marks, receipt, runsDir });
    return { action, landing, receipt };
  });
  // The tail is read only when a verdict turns on it: a steer landed, unacted and readable.
  const needsTicks = judged.some((one) => one.landing.kind === "active" && one.action === undefined);
  const ticks = needsTicks ? readTickTail({ path: supervisorTickLedgerPath({ home }) }) : ok([]);
  // A refused line can hide only the landing of the card it recorded, or of any card when it recorded none
  // (`./cardLedgerFile.ts`): another steer's damaged line is no gap for this one.
  const steers = judged.map((one) => {
    const unreadLandings = unreadableCardLinesForKeys({
      cardKeys: new Set([one.receipt.about]),
      lines: landings.unreadableLines,
    }).length;
    return judgedCard({ ...one, nowIso, ticks, unreadLandings });
  });
  return ok({ observedAtIso: nowIso, sinceIso, steers, undecodedRelays });
}

/**
 * The three ledgers every receipt is joined against — the card landings, the intake marks and, only when a steer
 * answers a check-in, the autonomy ledger — or the first that would not read.
 */
async function readSteerSources({
  home,
  ledger,
  receipts,
}: {
  home: string;
  ledger: AutonomyLedgerPort;
  receipts: readonly TurnRecord[];
}): Promise<
  Result<
    {
      readonly landings: CardLandingsRead;
      readonly marks: readonly IntakeMark[];
      readonly checkIns: readonly AutonomyRecord[];
    },
    SteeredCardsError
  >
> {
  const landings = readCardLandings({ home });
  if (landings.isErr()) {
    return err(
      SteeredCardsErrors.sourceUnreadable({ source: "talk/card-landings.jsonl", why: landings.error.message }),
    );
  }
  const marks = readIntakeMarks({ home });
  if (marks.isErr()) {
    return err(
      SteeredCardsErrors.sourceUnreadable({ source: "sessions/intake-marks.jsonl", why: marks.error.message }),
    );
  }
  const answersCheckIn = receipts.some((receipt) => receipt.about.startsWith("act:"));
  const checkIns = answersCheckIn ? await ledger.readRecords({ home }) : ok([]);
  if (checkIns.isErr()) {
    return err(SteeredCardsErrors.sourceUnreadable({ source: "the autonomy ledger", why: checkIns.error.message }));
  }
  return ok({ checkIns: checkIns.value, landings: landings.value, marks: marks.value });
}

/** One steer's card, its verdict judged over the joined evidence. */
function judgedCard({
  action,
  landing,
  receipt,
  ticks,
  unreadLandings,
  nowIso,
}: {
  action: SteerEvidence["action"];
  landing: SteerLanding;
  receipt: TurnRecord;
  ticks: Result<readonly ChairTick[], TickTailError>;
  unreadLandings: number;
  nowIso: string;
}): SteeredCard {
  const registeredAtIso = receipt.registeredAtIso!;
  const evidence: SteerEvidence = {
    action,
    chairPass: ticks.isOk() ? firstPassAfter({ registeredAtIso, ticks: ticks.value }) : undefined,
    landing,
    registeredAtIso,
    ticksRead: ticks.isOk(),
  };
  // A ledger with lines that did not read may hide this relay's landing, or the restore governing it, so an unacted
  // steer no readable restore has decided is unread rather than brought back with a reason that may be false (Codex).
  const landingMayBeUnread = action === undefined && landing.kind !== "lifted" && unreadLandings > 0;
  const verdict: SteerVerdict = landingMayBeUnread
    ? { kind: "unread", why: `${String(unreadLandings)} line(s) of the card-landings ledger did not read` }
    : steerVerdict({ evidence, nowIso });
  return {
    cardKey: receipt.about,
    heard: receipt.heard.slice(0, HEARD_CLIP),
    registeredAtIso,
    relaySlug: receipt.slug,
    turnId: receipt.turnId,
    verdict,
  };
}
