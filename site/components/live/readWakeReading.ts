/**
 * The supervisor tick's last `handover wake --json`, as the readings ledger holds it: for every park on CI the wake
 * judged, what the pull request it waits on was when the tick read it. The board only says a row is parked on CI;
 * this says whether that CI is still running, finished, or the pull request already merged or closed — the reading the
 * Fleet page's parked count is split by (`../../lib/parkedWaits.ts`).
 *
 * A board once counted 57 pull requests waiting on CI while only twenty were open. Every one of the 57 named a pull request that had merged or closed; the board
 * could not tell, and the wake reading always could.
 *
 * The wire shape is `src/cli/commands/handover/wakeRows.ts`'s `WakeRowReport` and `src/handover/parkWake.ts`'s
 * `ParkWakeJudgement`, restated because `site/` imports nothing from `src/`. Each row names its park by slug and the
 * park's position in the decoded journal (`parkIndex`), the identity the board row carries too, since a slug names a
 * row and a row can be re-parked on the same pull request; the park's instant rides beside it as a consistency check.
 * A row that will not read — one from before the wake stamped that identity included, a clock row too — refuses the
 * WHOLE reading: a partial set would leave every dropped park unmeasured while reading as a measurement.
 */
import { type Bag, isBag } from "../../lib/bag";
import { type Reading, readingOf } from "./reading";
import { isJournalIndex, isUtcInstant, wakeOf } from "./readParkedWake";

/** What the tick's wake found of the pull request one CI park waits on. */
export type WakeCiState =
  /** Open, and its checks still running: the park waits on exactly what it says. */
  | "running"
  /** Open with no check still running — every check finished, or none ran at all (`isChecksTerminal` counts zero as done), so the page never says CI ran: due, the next wake reseats it. */
  | "finished"
  /** Merged: due, the next wake settles or reseats it. */
  | "merged"
  /** Closed without merging: due, the next wake reseats it. */
  | "closed"
  /** The wake could not read it, or did not judge the park. */
  | "unknown";

/** One CI park as the tick's wake judged it. */
export interface WakeCiObservation {
  readonly slug: string;
  /** Where the judged park sits in its decoded journal: with the slug, the park's identity. */
  readonly parkIndex: number;
  /** When the judged park was journalled, checked against the board's own reading of that park. */
  readonly parkedAtIso: string;
  readonly repo: string;
  readonly number: number;
  readonly state: WakeCiState;
  /**
   * Whether the park was gone once that same wake was done — reseated, settled or cleared — read off the row's
   * `parkStanding`, so a board read before the wake finished still shows a park that is no longer there.
   */
  readonly retired: boolean;
}

/* Every judgement kind a wake row can carry. */
const ANY_JUDGEMENT: ReadonlySet<string> = new Set(["due", "not-due", "unknown", "not-judged"]);
/* The one kind a row past the judging pass carries: only a due park is finished, deferred or reseated. */
const DUE: ReadonlySet<string> = new Set(["due"]);
/* The one kind a row the judging pass never judged carries: a paused park, or one `cmux spawn` refuses forever. */
const NOT_JUDGED: ReadonlySet<string> = new Set(["not-judged"]);

/*
 * Every `action` `src/cli/commands/handover/wakeRows.ts`'s `WakeRowReport` declares, with the judgement kinds its
 * producers pair it with. A finish (`wakeDueFinish.ts`), a deferral, a claim or guard failure and a reseat
 * (`wakeDueRow.ts`, `wakeReseat.ts`) act only on a `due` judgement; a pause or a clear (`wakeJudge.ts`'s `paused` and
 * `permanent` arms) only on a park never judged; and `none` closes every path, so it carries any. Any other pairing is
 * not the wire, and would word a park off a judgement the wake never made. Whether the park is
 * gone is NOT read off the action: a `spawn-failed` row may have cleared its park or left it, so `parkStanding` says.
 */
const ACTION_JUDGEMENTS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["none", ANY_JUDGEMENT],
  ["would-spawn", DUE],
  ["spawned", DUE],
  ["would-finish", DUE],
  ["finished", DUE],
  ["spawn-failed", DUE],
  ["spawn-deferred", DUE],
  ["due-deferred", DUE],
  ["reseat-in-flight", DUE],
  ["wake-journal-failed", DUE],
  // `wakeQuestionSuspend.ts`: a due merged park whose run waits only on the owner's question. Its park stands.
  ["would-suspend", DUE],
  ["wake-suspended", DUE],
  ["paused-skipped", NOT_JUDGED],
  ["would-clear", NOT_JUDGED],
  ["park-cleared", NOT_JUDGED],
  ["park-clear-failed", NOT_JUDGED],
]);

/**
 * Whether a row's action is one `WakeRowReport` declares, sitting on a judgement kind its producers pair it with.
 *
 * @param judgement the row's `judgement`, whose kind the action is held to
 * @returns true when it reads
 */
function actionReads({ action, judgement }: { action: unknown; judgement: unknown }): boolean {
  if (typeof action !== "string" || !isBag(judgement) || typeof judgement["kind"] !== "string") {
    return false;
  }
  return ACTION_JUDGEMENTS.get(action)?.has(judgement["kind"]) === true;
}

/**
 * Whether the row's park was gone once the wake was done, from its `parkStanding`: `unknown` (its journal did not
 * re-read whole), a value the wire does not declare, or none at all (a producer predating it) does not read.
 *
 * @param parkStanding the row's `parkStanding`
 * @returns true for `gone`, false for `standing`, `undefined` otherwise
 */
function retiredOf({ parkStanding }: { parkStanding: unknown }): boolean | undefined {
  if (parkStanding === "gone") {
    return true;
  }
  return parkStanding === "standing" ? false : undefined;
}

/**
 * A clock park the wake went on to reseat or clear. Its state is the board's to word, but a board read before that
 * wake finished still holds it, so the page needs to know it is gone.
 */
export interface WakeRetiredClock {
  readonly slug: string;
  readonly parkIndex: number;
  readonly parkedAtIso: string;
  /** The instant the park was to wake at, held equal to the board's as a consistency check. */
  readonly atIso: string;
}

/** One clock row as the reader keeps it: its park, and whether the wake retired it. */
interface ClockObservation extends WakeRetiredClock {
  readonly kind: "clock";
  readonly retired: boolean;
}

/** The CI parks one wake run judged, and the clock parks it retired. */
export interface WakeCiReading {
  /**
   * When the wake judged its rows: the report's own stamp, taken before it read a single pull request. The page ages
   * the states by THIS, never the readings ledger's stamp, which lands only once the wake has finished every finish
   * and reseat it chose.
   */
  readonly observedAtIso: string;
  readonly rows: readonly WakeCiObservation[];
  readonly retiredClocks: readonly WakeRetiredClock[];
}

/** The pull request a CI park waits on. */
interface CiTarget {
  readonly repo: string;
  readonly number: number;
}

/**
 * A due judgement's pull-request state — only when what it observed is the very pull request the park waits on.
 *
 * @param judgement the row's `judgement`, a `due` one
 * @param target the pull request the row's wake names
 * @returns the state, or `undefined` when the observation does not read or names another pull request
 */
function dueStateOf({ judgement, target }: { judgement: Bag; target: CiTarget }): WakeCiState | undefined {
  const observed = judgement["observed"];
  if (!isBag(observed) || observed["kind"] !== "checks") {
    return undefined;
  }
  if (observed["repo"] !== target.repo || observed["number"] !== target.number) {
    return undefined;
  }
  // An open pull request is observed with its head and a digest of its checks; a merged or closed one with neither.
  // Only a merged read carries its merge commit, beside the observation.
  switch (observed["prState"]) {
    case "OPEN": {
      const head = typeof observed["headSha"] === "string" && typeof observed["fingerprint"] === "string";
      const exact = keysAre({ bag: observed, keys: OPEN_OBSERVED_KEYS }) && keysAre({ bag: judgement, keys: DUE_KEYS });
      return head && exact ? "finished" : undefined;
    }
    case "MERGED": {
      const exact = keysAre({ bag: observed, keys: ENDED_OBSERVED_KEYS }) && mergedJudgementReads({ judgement });
      return exact ? "merged" : undefined;
    }
    case "CLOSED": {
      const exact =
        keysAre({ bag: observed, keys: ENDED_OBSERVED_KEYS }) && keysAre({ bag: judgement, keys: DUE_KEYS });
      return exact ? "closed" : undefined;
    }
    default: {
      return undefined;
    }
  }
}

/* The exact field sets of `src/handover/parkWake.ts`'s `ParkWakeJudgement` and `WakeObservation` arms. */
const UNDUE_KEYS: readonly string[] = ["kind", "reason"];
const DUE_KEYS: readonly string[] = ["kind", "observed", "reason"];
const ENDED_OBSERVED_KEYS: readonly string[] = ["kind", "number", "prState", "repo"];
const OPEN_OBSERVED_KEYS: readonly string[] = [...ENDED_OBSERVED_KEYS, "fingerprint", "headSha"];

/**
 * Whether a bag carries exactly these keys, no more and no fewer.
 *
 * @param keys the field set the wire's arm declares
 * @returns true when the bag's own keys are that set
 */
function keysAre({ bag, keys }: { bag: Bag; keys: readonly string[] }): boolean {
  const own = Object.keys(bag);
  return own.length === keys.length && keys.every((key) => Object.hasOwn(bag, key));
}

/**
 * Whether a merged read's judgement is the wire's: a due arm, its merge commit present only as a string.
 *
 * @returns true when it reads
 */
function mergedJudgementReads({ judgement }: { judgement: Bag }): boolean {
  if (!Object.hasOwn(judgement, "mergeCommitOid")) {
    return keysAre({ bag: judgement, keys: DUE_KEYS });
  }
  return (
    typeof judgement["mergeCommitOid"] === "string" &&
    keysAre({ bag: judgement, keys: [...DUE_KEYS, "mergeCommitOid"] })
  );
}

/**
 * One judgement's state: `not-due` is CI still running, `due` carries the pull request's state, and `unknown` or
 * `not-judged` is a park the wake did not read. Every arm is held to its exact field set — a `not-due` carrying
 * anything beside its reason is not the wire's shape, and would otherwise be said as this park's CI still running.
 *
 * @param judgement the row's `judgement`
 * @param target the pull request the row's wake names
 * @returns the state, or `undefined` when the judgement does not read
 */
function stateOf({ judgement, target }: { judgement: unknown; target: CiTarget }): WakeCiState | undefined {
  if (!isBag(judgement) || typeof judgement["reason"] !== "string") {
    return undefined;
  }
  const undue = keysAre({ bag: judgement, keys: UNDUE_KEYS });
  switch (judgement["kind"]) {
    case "not-due": {
      return undue ? "running" : undefined;
    }
    case "due": {
      return dueStateOf({ judgement, target });
    }
    case "unknown":
    case "not-judged": {
      return undue ? "unknown" : undefined;
    }
    default: {
      return undefined;
    }
  }
}

/**
 * One reported row: a CI park's observation, a clock park's identity and whether the wake retired it (its state is
 * the board's business, never this reading's), or `undefined` when a row does not read. Every row the wake reports is
 * stamped with the park it judged, clock rows included, so every row is held to that stamp and to the report's own
 * instant: a park journalled after the wake that judged it means the document is not this board's.
 *
 * @param raw one entry of the document's `rows`
 * @param judgedMs the report's own `observedAtIso`, which no park it judged can come after
 * @returns the observation, or `undefined`
 */
function observationOf({
  judgedMs,
  raw,
}: {
  judgedMs: number;
  raw: unknown;
}): WakeCiObservation | ClockObservation | undefined {
  if (!isBag(raw) || typeof raw["slug"] !== "string") {
    return undefined;
  }
  const { action, parkIndex, parkedAtIso } = raw;
  if (typeof parkedAtIso !== "string" || !isUtcInstant({ text: parkedAtIso }) || Date.parse(parkedAtIso) > judgedMs) {
    return undefined;
  }
  const retired = retiredOf({ parkStanding: raw["parkStanding"] });
  if (!isJournalIndex(parkIndex) || !actionReads({ action, judgement: raw["judgement"] }) || retired === undefined) {
    return undefined;
  }
  // The board's own wake rule, so a clock instant or pull request the board would call unread refuses here too.
  const wake = wakeOf({ raw: raw["wake"] });
  if (wake.kind === "unread") {
    return undefined;
  }
  if (wake.kind === "at") {
    return { atIso: wake.atIso, kind: "clock", parkIndex, parkedAtIso, retired, slug: raw["slug"] };
  }
  const { number, repo } = wake;
  const state = stateOf({ judgement: raw["judgement"], target: { number, repo } });
  if (state === undefined) {
    return undefined;
  }
  return { number, parkIndex, parkedAtIso, repo, retired, slug: raw["slug"], state };
}

/**
 * The CI parks a `handover wake --json` document judged, read whole or not at all.
 *
 * @param document the reading's document
 * @returns the reading, or `undefined` when the document or any CI row in it does not read
 */
export function readWakeCi(document: unknown): WakeCiReading | undefined {
  if (!isBag(document) || !Array.isArray(document["rows"])) {
    return undefined;
  }
  const { observedAtIso } = document;
  if (typeof observedAtIso !== "string" || !isUtcInstant({ text: observedAtIso })) {
    return undefined;
  }
  const judgedMs = Date.parse(observedAtIso);
  const rows: WakeCiObservation[] = [];
  const retiredClocks: WakeRetiredClock[] = [];
  // The wake reports each park once, so a document naming one park twice is not the wire.
  const parks = new Set<string>();
  for (const raw of document["rows"] as readonly unknown[]) {
    const observation = observationOf({ judgedMs, raw });
    if (observation === undefined) {
      return undefined;
    }
    const park = `${String(observation.parkIndex)}@${observation.slug}`;
    if (parks.has(park)) {
      return undefined;
    }
    parks.add(park);
    if (!("kind" in observation)) {
      rows.push(observation);
    } else if (observation.retired) {
      const { atIso, parkIndex, parkedAtIso, slug } = observation;
      retiredClocks.push({ atIso, parkIndex, parkedAtIso, slug });
    }
  }
  return { observedAtIso, retiredClocks, rows };
}

/**
 * The last recorded reading of `handover wake`, refused whole when it is out of time with itself. The ledger stamps
 * the envelope only once the wake has exited, so both of its instants come no earlier than the report's own; and the
 * wake stamps its report after reading the board, so the report's own comes no earlier than any park it judged. A wake
 * cannot have read a park that did not exist yet, nor been recorded before it ran. A document breaking either is not this board's, whatever its rows say.
 *
 * @returns the reading, or `undefined` when it does not read or its instants are out of order
 */
export function readWakeReading(payload: unknown): Reading<WakeCiReading> | undefined {
  const reading = readingOf({ payload, read: readWakeCi });
  if (reading === undefined) {
    return undefined;
  }
  const envelope = [reading.observedAtIso, reading.recordedAtIso];
  if (!envelope.every((text) => isUtcInstant({ text }))) {
    return undefined;
  }
  const envelopeMs = envelope.map((text) => Date.parse(text));
  // Each park against the report was checked row by row in `readWakeCi`, clock rows included.
  if (Date.parse(reading.value.observedAtIso) > Math.min(...envelopeMs)) {
    return undefined;
  }
  return reading;
}
