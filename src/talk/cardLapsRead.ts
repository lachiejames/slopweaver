/**
 * The effectful half of `./cardLaps.ts`: the owner's words from the three places they speak and the hand register's
 * re-cuts, read once and judged.
 *
 * - **Calls** (`./callStore.ts`): every stretch of the OWNER's speech, with the card open when it began.
 * - **Console steers** (`./consoleTurns.ts`): typed or relayed, with the card the steer named.
 * - **The supervisor chain** (`../profile/supervisorWords.ts`): the owner's turns to each chair, read through the same
 *   filter `profile words` uses, so a relay the console typed into the chair is never counted as a second word of the
 *   owner's. A chair turn names no card, so it is never placed; it is read so the reading can say how much went
 *   unplaced, and so `--calibrate` scores a matcher against the whole of what the owner says.
 *
 * `--calibrate` alone reads the CANDIDATES: every `kind: ask` row on the board and every hand step ever posted, the
 * two registers whose cards carry their own words.
 *
 * ## A source that does not read is a gap, never "no looks"
 *
 * Every read that fails, wholly or by a line, is named in `gaps`, and the console says the measure is partial
 * rather than drawing "first try" over a card whose second look may be in the file that did not read.
 */
import { handRegisterPath, readHandRows } from "../hand/store.js";
import { scanBoard } from "../handover/store.js";
import { utterancesFromSupervisorTurns } from "../profile/ownerWords.js";
import { readSupervisorWords } from "../profile/supervisorWords.js";
import { readCalls } from "./callStore.js";
import {
  type CardLaps,
  cardLapsOf,
  type LapCandidate,
  type LapUtterance,
  type UnplacedWords,
  unplacedOf,
} from "./cardLaps.js";
import { readConsoleTurns } from "./consoleTurns.js";
import { namesOneRegisterCard } from "./prCardKey.js";
import { formatCallPointer } from "./unreadWords.js";

/** How far back the reading looks by default: a fortnight, the owner's own example of a time away the fleet must survive. */
export const LAPS_WINDOW_MS = 14 * 24 * 60 * 60_000;

/** @internal One source that did not read whole — named through {@link CardLapsReading}. */
export interface LapsGap {
  readonly source: "calls" | "console" | "supervisor" | "board" | "hands";
  readonly why: string;
}

/** What `talk laps` reports. */
export interface CardLapsReading {
  readonly observedAtIso: string;
  /** The oldest word read; a card's looks before it are not counted, so its laps are a floor. */
  readonly sinceIso: string;
  readonly cards: readonly CardLaps[];
  /** The owner's words in the window whose record named no card, per source — said, read, and not counted on any card. */
  readonly unplaced: UnplacedWords;
  readonly gaps: readonly LapsGap[];
}

/** A card key a record carried, kept only when it names one card a register holds. */
function heldCard({ key }: { key: string | undefined }): string | undefined {
  if (key === undefined || !namesOneRegisterCard({ key })) {
    return undefined;
  }
  return key;
}

/** The owner's call stretches inside the window, each with its open card. */
function callUtterances({ home, sinceIso, untilIso }: { home: string; sinceIso: string; untilIso: string }): {
  readonly utterances: readonly LapUtterance[];
  readonly gaps: readonly LapsGap[];
} {
  const read = readCalls({ home, keep: { sinceIso } });
  if (read.isErr()) {
    return { gaps: [{ source: "calls", why: read.error.message }], utterances: [] };
  }
  const gaps: LapsGap[] = read.value.unreadable.map((why) => ({ source: "calls" as const, why }));
  const floor = Date.parse(sinceIso);
  const ceiling = Date.parse(untilIso);
  const utterances = read.value.calls.flatMap((call) => {
    if (call.skipped > 0) {
      gaps.push({ source: "calls", why: `${String(call.skipped)} line(s) of call ${call.callId} do not parse` });
    }
    return call.segments
      .filter((segment) => {
        const at = Date.parse(segment.atIso);
        return segment.who === "owner" && segment.text.trim() !== "" && at >= floor && at < ceiling;
      })
      .map((segment): LapUtterance => ({
        anchor: formatCallPointer({ callId: call.callId, segmentId: segment.id }),
        atIso: segment.atIso,
        card: heldCard({ key: segment.open }),
        source: "call",
        text: segment.text,
      }));
  });
  return { gaps, utterances };
}

/** The owner's console steers inside the window, each with the card it named. */
function consoleUtterances({ home, sinceIso, untilIso }: { home: string; sinceIso: string; untilIso: string }): {
  readonly utterances: readonly LapUtterance[];
  readonly gaps: readonly LapsGap[];
} {
  const read = readConsoleTurns({ home, sinceIso, untilIso });
  if (read.isErr()) {
    return { gaps: [{ source: "console", why: read.error.message }], utterances: [] };
  }
  const gaps = read.value.unreadable.map((why): LapsGap => ({ source: "console", why }));
  const utterances = read.value.turns
    .filter((turn) => turn.heard.trim() !== "")
    .map((turn): LapUtterance => {
      const source = turn.typed ? "typed" : "relay";
      return {
        anchor: turn.anchor,
        atIso: turn.stagedAtIso,
        card: heldCard({ key: turn.about }),
        source,
        text: turn.heard,
      };
    });
  return { gaps, utterances };
}

/** The owner's turns to the supervisor chain inside the window. */
function chairUtterances({
  home,
  claudeHome,
  sinceIso,
  untilIso,
}: {
  home: string;
  claudeHome: string;
  sinceIso: string;
  untilIso: string;
}): { readonly utterances: readonly LapUtterance[]; readonly gaps: readonly LapsGap[] } {
  const words = utterancesFromSupervisorTurns(readSupervisorWords({ claudeHome, home, sinceIso, untilIso }));
  return {
    gaps: words.gaps.map((gap): LapsGap => ({ source: "supervisor", why: gap.why })),
    utterances: words.utterances.map((one): LapUtterance => ({
      anchor: one.anchor,
      atIso: one.atIso,
      card: undefined,
      source: "chair",
      text: one.text,
    })),
  };
}

/** The ask rows on the board, as cards a calibrated matcher may pick. */
function askCandidates({ handoverDir }: { handoverDir: string }): {
  readonly candidates: readonly LapCandidate[];
  readonly gaps: readonly LapsGap[];
} {
  const scan = scanBoard({ handoverDir });
  if (scan.isErr()) {
    return { candidates: [], gaps: [{ source: "board", why: scan.error.message }] };
  }
  const gaps = scan.value.unreadable.map((name): LapsGap => ({ source: "board", why: `${name} would not read` }));
  // A row a console steer registered is written in the owner's own words, so every later word of theirs on the subject would
  // match it: measured on the 14-day reading, 470 of 711 cards were such rows before this filter. Only a record
  // naming one counts it.
  const candidates = scan.value.docs
    .filter((doc) => doc.kind === "ask" && doc.anchor?.startsWith("talk:") !== true)
    .map((doc): LapCandidate => ({
      bornIso: doc.askedIso,
      key: `ask:${doc.slug}`,
      text: [doc.summary, doc.problem].filter((part) => part !== undefined).join("\n"),
    }));
  return { candidates, gaps };
}

/** Every hand step ever posted, as cards a calibrated matcher may pick, and each re-cut's successor. */
function handCandidates({ home }: { home: string }): {
  readonly candidates: readonly LapCandidate[];
  readonly successorOf: ReadonlyMap<string, string>;
  readonly gaps: readonly LapsGap[];
} {
  const read = readHandRows({ missing: "empty", path: handRegisterPath({ home }) });
  if (read.isErr()) {
    return { candidates: [], gaps: [{ source: "hands", why: read.error.message }], successorOf: new Map() };
  }
  const gaps = read.value.unparsed.map((problem): LapsGap => ({ source: "hands", why: problem.message }));
  const successorOf = new Map<string, string>();
  const candidates: LapCandidate[] = [];
  for (const row of read.value.rows) {
    if (row.kind !== "posted") {
      continue;
    }
    const key = `hand:${row.step.id}`;
    candidates.push({ bornIso: row.step.postedIso, key, text: [row.step.what, row.step.unblocks].join("\n") });
    if (row.settles !== undefined) {
      successorOf.set(`hand:${row.settles.id}`, key);
    }
  }
  return { candidates, gaps, successorOf };
}

/** Everything a reading is made from, read once. */
interface LapsInputs {
  readonly utterances: readonly LapUtterance[];
  readonly candidates: readonly LapCandidate[];
  readonly successorOf: ReadonlyMap<string, string>;
  readonly gaps: readonly LapsGap[];
}

/**
 * Read the owner's words inside a window, the cards a calibrated matcher may pick, and the hand register's re-cuts.
 *
 * @param home the Slopweaver home
 * @param claudeHome the directory holding Claude Code's `projects`
 * @param handoverDir the board directory whose ask rows a calibration scores against, or `undefined` for a plain reading
 * @param nowIso the window's ceiling
 * @param sinceIso the window's floor
 * @returns the inputs, every gap named
 */
export function readLapsInputs({
  home,
  claudeHome,
  handoverDir,
  nowIso,
  sinceIso,
}: {
  home: string;
  claudeHome: string;
  handoverDir: string | undefined;
  nowIso: string;
  sinceIso: string;
}): LapsInputs {
  const window = { sinceIso, untilIso: nowIso };
  const calls = callUtterances({ home, ...window });
  const steers = consoleUtterances({ home, ...window });
  const chair = chairUtterances({ claudeHome, home, ...window });
  // The board is read only for a calibration, so a board that will not read never marks a plain reading partial.
  let asks: ReturnType<typeof askCandidates> = { candidates: [], gaps: [] };
  if (handoverDir !== undefined) {
    asks = askCandidates({ handoverDir });
  }
  const hands = handCandidates({ home });
  return {
    candidates: [...asks.candidates, ...hands.candidates],
    gaps: [...calls.gaps, ...steers.gaps, ...chair.gaps, ...asks.gaps, ...hands.gaps],
    successorOf: hands.successorOf,
    utterances: [...calls.utterances, ...steers.utterances, ...chair.utterances],
  };
}

/**
 * Read the owner's words and the cards, and judge every card's laps.
 *
 * @param home the Slopweaver home
 * @param claudeHome the directory holding Claude Code's `projects`
 * @param nowIso the instant read at, the window's ceiling
 * @param sinceIso the window's floor
 * @returns the reading, every gap named
 */
export function readCardLaps({
  home,
  claudeHome,
  nowIso,
  sinceIso,
}: {
  home: string;
  claudeHome: string;
  nowIso: string;
  sinceIso: string;
}): CardLapsReading {
  const inputs = readLapsInputs({ claudeHome, handoverDir: undefined, home, nowIso, sinceIso });
  const cards = cardLapsOf({ successorOf: inputs.successorOf, utterances: inputs.utterances });
  return {
    cards,
    gaps: inputs.gaps,
    observedAtIso: nowIso,
    sinceIso,
    unplaced: unplacedOf({ utterances: inputs.utterances }),
  };
}
