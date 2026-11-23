/**
 * The relay's turn TRANSACTION — the module that makes one turn write at most one board row.
 *
 * ## Why a file is the mutex
 *
 * A pre-mortem found the hole in a lock-free design: two relays of one turn can
 * both read "no completed receipt" and both proceed, because appending to a JSONL is not a transaction
 * around a registration, and `handover register`'s own guard is an `existsSync` followed by an ordinary
 * `writeFileSync` — a check both contenders pass. So the claim here is `createFileExclusive`
 * (`src/lib/writeAtomic.ts`), whose whole argument is that `O_EXCL` has no window and the loser is TOLD.
 * One turn file is the cross-process mutex and the idempotency key at the same time.
 *
 * ## Why a retry is compared on the DIGEST and not reconciled on the slug
 *
 * The first design recovered a crashed relay by asking whether the board already held the slug. On
 * `handover register`'s own eight-word slug that is a false-success path: two different asks sharing eight
 * opening words produce one slug (verified against the real `slugFromAsk`, `unit/talk/relayDraft.test.ts`),
 * so the second turn would find the first turn's row and promote a receipt for words nobody registered.
 * Two changes close it together — the slug is derived from the TURN (`relayDraft.ts`), and recovery matches
 * the row's `talk:<turnId>` ANCHOR and the words' digest rather than the name's existence.
 *
 * A retry carrying DIFFERENT words for a turn already spent is refused outright. It is not a retry, and
 * silently returning the old receipt would tell the caller the owner's new words were relayed.
 *
 * Who may work on a turn at all — one live run, never two racing — is `./relayLease.ts`, held before the claim.
 */
import { dirname, join } from "node:path";

import { readJsonlLines, UNDECODABLE_LINE } from "../corpus/corpusStore.js";
import { appendLines } from "../lib/appendSeparator.js";
import { isAbsentError, nonBlockingFileBytes } from "../lib/presentFile.js";
import { err, ok, type Result } from "../lib/result.js";
import { safeJsonParse, safeJsonStringify } from "../lib/safeJson.js";
import { createFileExclusive, ensureDirectory, writeFileAtomic } from "../lib/writeAtomic.js";
import { stateHomePaths } from "../stateHome.js";
import type { Delivery } from "./deliveryOutcome.js";
import type { DiscussFirstRecord } from "./discussFirst.js";
import { type TalkError, TalkErrors } from "./errors.js";
import type { RelayDraft } from "./relayDraft.js";
import type { RelayOffer } from "./relayOffer.js";
import type { RelayPicture } from "./relayPicture.js";
import type { TriageRuling } from "./triageVocabulary.js";
import { readTurnFiles, registeredSince } from "./turnFiles.js";
import { asTurnRecord, turnFiledElsewhere } from "./turnRecordShape.js";

/**
 * Where a turn has got to. `intended` means staged and not yet known to have reached the board;
 * `registering` means a run of this turn reached the registration call, so a row carrying its anchor may be
 * its own. Only a `registering` turn may adopt a row it finds: an `intended` one never asked for one, so a
 * row already there is not its row. A registration call that fails and leaves no row puts the
 * turn back to `intended`, so `registering` outlives a run only when that run was killed inside the call.
 *
 * Not exported: it is reachable as `TurnRecord["state"]`, and a second name for one field of an exported
 * record is a public surface nothing asked for.
 */
type TurnState = "intended" | "registering" | "registered";

/** The whole record of one relay turn — what the turn file holds and what a receipt line carries. */
export interface TurnRecord {
  readonly turnId: string;
  readonly words: string;
  /**
   * Every word the owner said or typed on this turn — the row quotes only a tail of a long one — or empty: a record written
   * before the owner's words were carried has none.
   */
  readonly heard: string;
  /**
   * Whether {@link heard} is only the TAIL of what the owner said. A record written now is `false`, since it keeps every word;
   * `true` survives on an older record that kept only the row's 1,500-character quote. Absent on a
   * record written before it was stored, where nobody knows — never read as `false`.
   */
  readonly heardTruncated?: boolean;
  /**
   * Whether {@link heard} ends mid-sentence: the page relayed while a call stretch was still open, so the words after
   * it were never carried. `false` on a typed steer. Absent on a record written before it was stored, or by a caller
   * that did not say, where nobody knows — never read as `false`, so such a voice relay never stands as a whole yes.
   */
  readonly heardTailCut?: boolean;
  /** The console record the owner was looking at, or empty. */
  readonly about: string;
  /** What the voice read after the owner last spoke, which is why `words` is empty; empty in full mode. */
  readonly readsAfter: readonly string[];
  /** Whether this was the page's retry of a refused relay, carrying the owner's words alone. */
  readonly wordsAlone: boolean;
  /** Whether the owner typed this steer on the console, so `heard` is their typed words and there was no voice at all. */
  readonly typed: boolean;
  /** The frame of the owner's shared screen or the image they attached that the row names, or why there is none. */
  readonly picture: RelayPicture;
  /**
   * The copy-tray offer the owner was reacting to, every byte, or `undefined` when the relay carried none — a record written
   * before relays carried one included. The voice's draft, never the owner's words (`./relayOffer.ts`). Optional in the type
   * only so a record built by hand for another reader need not name it; every write here names it.
   */
  readonly offered?: RelayOffer | undefined;
  /**
   * The owner's triage verdict, label and feedback on the card the pass had open; `null` when the relay carried none. Absent
   * on a record written before it was stored, where nobody knows — never read as `null`, since the row's prose may
   * carry a verdict no verb can read (a "needs more info" relay once read as a yes).
   * What `slack draft approve` and a repeat counter read.
   */
  readonly triageRuling?: TriageRuling | null;
  /**
   * The discuss-first question this relay put, or the owner's answer to one (`./discussFirst.ts`); `null` when it named no team
   * fix. Absent on a record written before it was stored. What `talk relay` checks a later answer's prior turn against,
   * so an answer naming a turn that put no question for that repository is never read as one.
   */
  readonly discussFirst?: DiscussFirstRecord | null;
  /**
   * The other Queue cards the voice judged the owner's words answer, which `talk relay` landed beside {@link about}; empty when
   * it named none. Absent on a record written before it was stored.
   */
  readonly alsoAnswers?: readonly string[];
  readonly digest: string;
  readonly slug: string;
  readonly anchor: string;
  readonly state: TurnState;
  readonly stagedAtIso: string;
  /** When the board row was confirmed, or `null` while the turn is still `intended`. */
  readonly registeredAtIso: string | null;
  /** What became of the line typed into the supervisor's chat, or `null` when none was attempted. */
  readonly delivery: Delivery | null;
  /**
   * What the relay read out of the owner's words for a held draft or the card on screen, which opens the chair's line
   * (`./relayChannelSteer.ts`) — stored so the chair's courier, handed only the turn id, types the very line the relay
   * would have. Absent when the relay found none, and on a turn written before it was stored.
   */
  readonly deliveryLead?: string;
}

/** What claiming a turn found. Not a Result shape — every arm is a legitimate, different next step. */
export type TurnClaim =
  /** This process created the turn file and owns the registration. */
  | { readonly outcome: "claimed"; readonly record: TurnRecord }
  /** The turn already reached the board carrying these exact words. Return its receipt; write nothing. */
  | { readonly outcome: "already-registered"; readonly record: TurnRecord }
  /** A previous attempt staged these words and did not finish. Reconcile against the board, then finish. */
  | { readonly outcome: "resume"; readonly record: TurnRecord };

/** The turn file one turn owns. */
function turnPath({ home, turnId }: { home: string; turnId: string }): string {
  return join(stateHomePaths({ home }).talkTurns, `${turnId}.json`);
}

/** The record a fresh claim writes, stamped `intended` at `nowIso`. */
function freshTurnOf({ draft, nowIso }: { draft: RelayDraft; nowIso: string }): TurnRecord {
  // Written either way, so a record written now always says whether it carried a ruling, and a question.
  const { discussFirst = null, triageRuling = null } = draft;
  return {
    about: draft.about,
    alsoAnswers: draft.alsoAnswers,
    anchor: draft.anchor,
    digest: draft.digest,
    discussFirst,
    heard: draft.heard,
    // Only a page that checked says either way; an unstated end stays absent, so it is never read as whole.
    ...(draft.heardTailCut === undefined ? {} : { heardTailCut: draft.heardTailCut }),
    heardTruncated: false,
    delivery: null,
    offered: draft.offered,
    picture: draft.picture,
    readsAfter: draft.readsAfter,
    registeredAtIso: null,
    slug: draft.slug,
    stagedAtIso: nowIso,
    state: "intended",
    triageRuling,
    turnId: draft.turnId,
    typed: draft.typed,
    words: draft.words,
    wordsAlone: draft.wordsAlone,
  };
}

/**
 * Claim a turn, or report what already holds it.
 *
 * @param home the Slopweaver home this relay's state lives under
 * @param draft the draft the relay is trying to write
 * @param nowIso the instant to stamp a fresh claim with
 * @returns which of the three situations applies, or `RELAY_CONFLICT` when the words changed
 */
export function claimTurn({
  home,
  draft,
  nowIso,
}: {
  home: string;
  draft: RelayDraft;
  nowIso: string;
}): Result<TurnClaim, TalkError> {
  const path = turnPath({ home, turnId: draft.turnId });
  const fresh = freshTurnOf({ draft, nowIso });
  ensureDirectory({ directory: stateHomePaths({ home }).talkTurns });
  try {
    createFileExclusive({ contents: `${safeJsonStringify({ label: "talk turn", value: fresh })}\n`, path });
    return ok({ outcome: "claimed", record: fresh });
  } catch (cause) {
    if (!isAlreadyExists({ cause })) {
      return err(TalkErrors.pathUnreadable({ cause, path }));
    }
  }
  const existing = readTurn({ home, turnId: draft.turnId });
  if (existing.isErr()) {
    return err(existing.error);
  }
  const record = existing.value;
  if (record.digest !== draft.digest) {
    return err(TalkErrors.relayConflict({ registered: record.state === "registered", turnId: draft.turnId }));
  }
  if (record.state === "registered") {
    return ok({ outcome: "already-registered", record });
  }
  return ok({ outcome: "resume", record });
}

/**
 * The claimed turn as this run carries it forward: the stored record with the picture and the copy-tray offer THIS
 * run formed.
 *
 * A claim that matched the digest already proves the sha256 is the same, and the draft's path is derived
 * from the turn, while the stored record's path is a file anything can edit between runs — so a replay that
 * named the stored one would type whatever path it now holds. The offer is the same: the digest bound
 * the draft's, and the stored copy is a file anything can edit, so the row is given the draft's.
 *
 * @param record the turn the claim returned
 * @param draft the draft this run formed, whose digest the claim matched
 * @returns the record naming this run's picture and offer
 */
export function withDraftPicture({ record, draft }: { record: TurnRecord; draft: RelayDraft }): TurnRecord {
  return { ...record, offered: draft.offered, picture: draft.picture };
}

/**
 * Record that a run of this turn is about to register its row — BEFORE the registration call, so a retry
 * after a crash inside it knows a row carrying the anchor may be this turn's own — or, when that call failed
 * and left no row, put the turn back to `intended`, so a row that appears later is never read as its own.
 *
 * @param home the Slopweaver home
 * @param record the claimed turn
 * @param registering `true` before the registration call, `false` after one that left no row
 * @returns the record as now written
 */
export function setTurnRegistering({
  home,
  record,
  registering,
}: {
  home: string;
  record: TurnRecord;
  registering: boolean;
}): Result<TurnRecord, TalkError> {
  return writeTurn({ home, record: { ...record, state: registering ? "registering" : "intended" } });
}

/**
 * Record that a turn's board row exists, and append its receipt.
 *
 * The turn file is rewritten BEFORE the receipt is appended, so a crash between the two leaves a turn that
 * reads `registered` with no receipt line — a missing log entry — rather than a receipt for a turn the
 * store still calls unfinished, which a later retry would act on.
 *
 * @param home the Slopweaver home
 * @param record the claimed turn
 * @param nowIso the instant the board row was confirmed
 * @returns the registered record
 */
export function markRegistered({
  home,
  record,
  nowIso,
}: {
  home: string;
  record: TurnRecord;
  nowIso: string;
}): Result<TurnRecord, TalkError> {
  const registered: TurnRecord = { ...record, registeredAtIso: nowIso, state: "registered" };
  const paths = stateHomePaths({ home });
  const path = turnPath({ home, turnId: record.turnId });
  try {
    writeFileAtomic({
      contents: `${safeJsonStringify({ label: "talk turn", value: registered })}\n`,
      path,
    });
    ensureDirectory({ directory: dirname(paths.talkRelaysJsonl) });
    const text = `${safeJsonStringify({ label: "talk receipt", value: registered })}\n`;
    appendLines({ mode: 0o600, path: paths.talkRelaysJsonl, text });
    return ok(registered);
  } catch (cause) {
    return err(TalkErrors.pathUnreadable({ cause, path }));
  }
}

/**
 * Record what became of a relay's supervisor line on the turn file — once as `attempting` before the paste,
 * once with the outcome after, so a retry never types the same turn twice.
 *
 * The receipt log is not rewritten: it records the ROW, and a delivery is a fact about a different surface.
 *
 * @param home the state home
 * @param record the registered turn
 * @param delivery what to record
 * @returns the turn as now written
 */
export function markDelivered({
  home,
  record,
  delivery,
}: {
  home: string;
  record: TurnRecord;
  delivery: Delivery;
}): Result<TurnRecord, TalkError> {
  return writeTurn({ home, record: { ...record, delivery } });
}

/**
 * Store the lead the chair's line opens on, before either delivery path runs, so the courier rebuilds the same line.
 * A turn with no lead is returned untouched: absent is what it would read back as.
 *
 * @param home the state home
 * @param record the registered turn
 * @param deliveryLead what the relay read out of the owner's words for the line's opening, or `undefined` for none
 * @returns the turn as now written
 */
export function markDeliveryLead({
  home,
  record,
  deliveryLead,
}: {
  home: string;
  record: TurnRecord;
  deliveryLead: string | undefined;
}): Result<TurnRecord, TalkError> {
  if (deliveryLead === undefined || record.deliveryLead === deliveryLead) {
    return ok(record);
  }
  return writeTurn({ home, record: { ...record, deliveryLead } });
}

/** Rewrite one turn's file whole, atomically, and answer the record as now written. */
function writeTurn({ home, record }: { home: string; record: TurnRecord }): Result<TurnRecord, TalkError> {
  const path = turnPath({ home, turnId: record.turnId });
  try {
    writeFileAtomic({ contents: `${safeJsonStringify({ label: "talk turn", value: record })}\n`, path });
    return ok(record);
  } catch (cause) {
    return err(TalkErrors.pathUnreadable({ cause, path }));
  }
}

/**
 * Read one turn's record.
 *
 * @param home the Slopweaver home
 * @param turnId the turn to read
 * @returns the record, or why it could not be read
 */
export function readTurn({ home, turnId }: { home: string; turnId: string }): Result<TurnRecord, TalkError> {
  const path = turnPath({ home, turnId });
  try {
    // Non-blocking, so a FIFO is refused rather than hanging; strict, so a damaged byte fails the read rather than
    // becoming words the owner never said.
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(nonBlockingFileBytes({ path }));
    const parsed = safeJsonParse({ label: "talk turn", text });
    const record = asTurnRecord({ value: parsed });
    if (record === undefined) {
      return err(TalkErrors.pathUnreadable({ cause: new Error("turn file is not a turn record"), path }));
    }
    const elsewhere = turnFiledElsewhere({ record, turnId });
    return elsewhere === undefined ? ok(record) : err(TalkErrors.pathUnreadable({ cause: new Error(elsewhere), path }));
  } catch (cause) {
    return err(TalkErrors.pathUnreadable({ cause, path }));
  }
}

/**
 * Every relay receipt, newest last, and how many lines would not decode as one, a blank line with a record after it
 * included — so a reader that must not look complete over a partly unreadable ledger can say so.
 *
 * An absent ledger is an empty list rather than a failure: an install that has never relayed is the normal
 * first state, not a fault.
 *
 * @param home the Slopweaver home
 * @returns the receipts and the count of lines that are not receipts, or why the ledger could not be read
 */
export function readRelayLedger({
  home,
}: {
  home: string;
}): Result<{ readonly rows: readonly TurnRecord[]; readonly undecoded: number }, TalkError> {
  const path = stateHomePaths({ home }).talkRelaysJsonl;
  const rows: TurnRecord[] = [];
  let undecoded = 0;
  let blanks = 0;
  try {
    readJsonlLines({
      onLine: ({ line }) => {
        // The reader hands back the empty tail after the final newline, so trailing blank lines are no record. A blank
        // line with a record after it is one no writer here appends, so it is undecoded rather than passed over.
        if (line.trim().length === 0) {
          blanks += 1;
          return;
        }
        undecoded += blanks;
        blanks = 0;
        // A line holding a byte that is not UTF-8 arrives as one lone U+FFFD: it is undecoded, never read repaired
        // into a receipt whose ruling the owner did not give.
        if (line === UNDECODABLE_LINE) {
          undecoded += 1;
          return;
        }
        const record = asTurnRecord({ value: safeJsonParse({ label: "talk receipt", text: line }) });
        if (record === undefined) {
          undecoded += 1;
          return;
        }
        rows.push(record);
      },
      path,
      strictUtf8: true,
    });
  } catch (cause) {
    // A ledger behind a dangling link could not be read; only one genuinely absent is no receipts.
    if (isAbsentError({ error: cause, path })) {
      return ok({ rows: [], undecoded: 0 });
    }
    return err(TalkErrors.pathUnreadable({ cause, path }));
  }
  return ok({ rows, undecoded });
}

/**
 * The relay receipts, newest last, bounded by `limit`.
 *
 * An absent ledger is an empty list rather than a failure: an install that has never relayed is the normal
 * first state, not a fault.
 *
 * @param home the Slopweaver home
 * @param limit how many of the most recent receipts to keep
 * @returns the receipts
 */
export function readRelayReceipts({
  home,
  limit,
}: {
  home: string;
  limit: number;
}): Result<readonly TurnRecord[], TalkError> {
  return readRelayLedger({ home }).map(({ rows }) => {
    // `slice(-0)` is `slice(0)`, so a zero limit would hand back EVERY receipt rather than none. Caught by
    // `unit/talk/relayStore.test.ts`; the guard is here rather than at a call site because every caller
    // would otherwise have to know it.
    if (limit <= 0) {
      return [];
    }
    return rows.slice(-limit);
  });
}

/**
 * The relays as they stand NOW: the receipt ledger says which turns reached the board and in what order, and
 * each turn's own file says what became of its supervisor line.
 *
 * The receipt is appended when the row is confirmed, BEFORE the line is typed, and is never rewritten
 * ({@link markDelivered}), so a receipt's `delivery` is `null` on every relay there has ever been. Measured:
 * all five receipts on one install read `null` while their turn files read `failed` — and
 * `skills/supervisor/reference/routing.md` § 3a′ has the chair check `talk log` for a delivery. So anything
 * that reports a delivery reads it here. A turn file that is missing or unreadable is a failure, never a
 * relay quietly shown with no delivery.
 *
 * The `sinceIso` read — the sweep's — walks the turn files themselves rather than the receipts: a crash
 * between {@link markRegistered}'s two writes leaves a registered turn with no receipt, and a relay the
 * sweep cannot see is exactly the one it exists to surface.
 *
 * The `aboutPrefix` read — the Alignment page's — keeps EVERY receipt whose record key opens with the prefix,
 * filtered before any bound: an answer the owner gave to an alignment question must keep that question answered however
 * many relays came after it, so a most-recent-N cut would bring an answered question back.
 *
 * @param home the Slopweaver home
 * @param keep the most recent `limit` relays by receipt, every turn registered at or after `sinceIso`, or every
 *   receipt whose `about` opens with `aboutPrefix`
 * @returns the current records, oldest first
 */
export function readRelayTurns({
  home,
  keep,
}: {
  home: string;
  keep: { readonly limit: number } | { readonly sinceIso: string } | { readonly aboutPrefix: string };
}): Result<readonly TurnRecord[], TalkError> {
  if ("sinceIso" in keep) {
    return readTurnFiles({ home, readTurn }).map((turns) => registeredSince({ sinceIso: keep.sinceIso, turns }));
  }
  if ("aboutPrefix" in keep) {
    return readRelayLedger({ home }).andThen(({ rows }) =>
      currentTurns({ home, receipts: rows.filter((row) => row.about.startsWith(keep.aboutPrefix)) }),
    );
  }
  return readRelayReceipts({ home, limit: keep.limit }).andThen((receipts) => currentTurns({ home, receipts }));
}

/**
 * Each receipt's turn as its own file holds it now — the receipt is never rewritten, so a delivery is read there.
 *
 * @param receipts the receipts to resolve, in ledger order
 * @returns the current records, or the first turn file that could not be read
 */
function currentTurns({
  home,
  receipts,
}: {
  home: string;
  receipts: readonly TurnRecord[];
}): Result<readonly TurnRecord[], TalkError> {
  const current: TurnRecord[] = [];
  for (const receipt of receipts) {
    const turn = readTurn({ home, turnId: receipt.turnId });
    if (turn.isErr()) {
      return err(turn.error);
    }
    current.push(turn.value);
  }
  return ok(current);
}

/** Whether a thrown filesystem error is the `O_EXCL` loser rather than a real fault. */
function isAlreadyExists({ cause }: { cause: unknown }): boolean {
  return errnoOf({ cause }) === "EEXIST";
}

/** The `code` of a Node filesystem error, or the empty string when there is not one. */
function errnoOf({ cause }: { cause: unknown }): string {
  if (!hasCode(cause)) {
    return "";
  }
  return typeof cause.code === "string" ? cause.code : "";
}

/** Narrows an unknown throw to something carrying a `code`, without asserting its shape. */
function hasCode(value: unknown): value is { code: unknown } {
  return typeof value === "object" && value !== null && "code" in value;
}
