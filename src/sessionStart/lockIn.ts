/**
 * The LOCK-IN LEDGER: what the owner said about each row they were walked through, and what the next run does
 * with it. `$SLOPWEAVER_HOME/ledgers/session-start/lock-in.jsonl`, append-only.
 *
 * ## Why the walk is a conversation and only its RESULT is code
 *
 * Lock-in is the second half of the owner's ask: condense the list into something answered one word at a time, so they
 * can move through it — and, by the Cunningham's-Law effect, correct the ranking while they do. The walk
 * itself needs judgement and lives in a visible session. What lives here is the one thing a session cannot
 * hold: the record, and the effect that record has on tomorrow.
 *
 * ## A ledger nobody reads is a defect, so this one ships with its reader
 *
 * The design memo says exactly that about V1's own feedback ledger, and it is why this file exports
 * {@link applyResolutions} rather than only the append. The owner's corrections ARE the ranking — a resolution
 * given earlier that changes nothing now is not feedback, it is a diary.
 *
 * ## A resolution is recorded against the item's own clock, and lapses when the item moves
 *
 * This is the guard against the failure mode that would cost the most trust: work hidden forever. The owner resolves
 * an item as it stands, so the row carries the item's `whenIso` at that moment, and a resolution only governs
 * an item that has not moved since. A ticket the owner called not-theirs comes back the day somebody
 * reassigns it, without the owner having to remember they ever hid it.
 *
 * That is a deliberate departure from `src/reflect/seen.ts`, whose `drop` is terminal by owner ruling. A
 * reflection finding is a claim about the code that does not change under you; a task is a live object whose
 * whole nature is that it moves. Neither shape is a default worth copying across.
 *
 * Same pure-line / effectful-append split as the reflect ledger: {@link lockInLine} is pure and takes its
 * timestamp as an argument, {@link recordLockIn} is the thin effectful append, and {@link foldLockInLedger}
 * derives every piece of state from the whole file rather than storing it. Nothing here reads a clock.
 */

import { lstatSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { absentAs } from "#lib/absent.js";
import { appendLines } from "#lib/appendSeparator.js";
import { isRecord } from "../lib/parsers.js";
import { err, ok, type Result } from "../lib/result.js";
import { safeFs } from "../lib/safeBoundary.js";
import { stateHomePaths } from "../stateHome.js";
import type { Item } from "./item.js";
import { itemIdentity } from "./item.js";
import type { RankInput } from "./rank.js";

/**
 * The words the walk accepts, and the only ones that resolve a row.
 *
 * `jump` and `stop` from the memo's menu are deliberately absent: they move the walk rather than settle an
 * item, so they write nothing. A ledger row means the owner decided something about a specific thing.
 *
 * `agent` is absent for the reason the memo gives — tier-3 execution here is a visible workspace, and
 * `hand-off` already means that through `slopweaver handover`. Two verbs for one mechanism is how a surface
 * rots.
 */
export const LOCK_IN_VERBS = ["do", "hand-off", "defer", "skip", "note"] as const;

/** One word the owner replied with. */
export type LockInVerb = (typeof LOCK_IN_VERBS)[number];

/**
 * What the resolution amounted to, in the ranking's own terms.
 *
 * Separate from the verb because the same word can mean two things: `do` on the action as proposed is
 * `approved-as-proposed`, and `do` after the owner rewrote the action is `edited`. The distinction is the whole
 * measurement — a list whose proposals are always edited is a list ranking the right rows and describing
 * them wrongly, which is a different repair from one ranking the wrong rows.
 */
export const LOCK_IN_OUTCOMES = ["approved-as-proposed", "edited", "rejected", "deferred", "dropped", "noted"] as const;

/** What the resolution amounted to. */
export type LockInOutcome = (typeof LOCK_IN_OUTCOMES)[number];

/**
 * The one-tag reasons a rejection or an edit may carry.
 *
 * `already-done` leads because it is the number to measure first: the memo puts V1's own failure rate at 41%
 * of rows that were already finished, and it is the one tag whose count tells you whether trace-before-ranking
 * is working. The rest are the other ways a row can be wrong, one per kind rather than a free-text field
 * nothing can count.
 *
 * @internal exported for its own tests until a consumer outside this module reads it.
 */
export const LOCK_IN_REASONS = [
  "already-done",
  "not-mine",
  "not-now",
  "wrong-action",
  "unreadable",
  "duplicate",
] as const;

/** Why a row was rejected or its action rewritten. */
export type LockInReason = (typeof LOCK_IN_REASONS)[number];

/** One appended row. Flat on purpose: a ledger a `jq` one-liner can read outlives one that needs a parser. */
export interface LockInRow {
  /** When the row was written. Injected by the caller, never read from a clock in here. */
  readonly tsIso: string;
  /**
   * The item's stable identity, `<source>:<nativeId>` — or its anchor URL, when the ruling was recorded by
   * a caller holding the link rather than the row. Either is a join key for {@link resolutionFor}.
   */
  readonly identity: string;
  /**
   * The item's own `whenIso` at the moment the owner resolved it.
   *
   * This is what makes a resolution lapse rather than stick forever. See the module header.
   */
  readonly againstWhenIso: string;
  /** The action the list proposed, verbatim, so a reader can tell what the owner was actually answering. */
  readonly proposed: string;
  /** The word the owner replied with. */
  readonly verb: LockInVerb;
  /** What that amounted to in the ranking's terms. */
  readonly outcome: LockInOutcome;
  /** The one-tag reason, on a rejection or an edit. */
  readonly reason?: LockInReason;
  /** Anything the owner said in their own words. Stored verbatim — the memo's rule for every transcript. */
  readonly note?: string;
  /** When a `defer` stops holding. Absent on every other outcome. */
  readonly deferredUntilIso?: string;
}

/**
 * Render one row as its JSONL line. Pure and deterministic — keys are emitted in a fixed order so two runs
 * writing the same row produce byte-identical lines.
 *
 * @param row the row to render
 * @returns the JSON line, with no trailing newline
 */
export function lockInLine({ row }: { row: LockInRow }): string {
  return JSON.stringify({
    againstWhenIso: row.againstWhenIso,
    identity: row.identity,
    outcome: row.outcome,
    proposed: row.proposed,
    schemaVersion: 1,
    tsIso: row.tsIso,
    verb: row.verb,
    ...(row.deferredUntilIso === undefined ? {} : { deferredUntilIso: row.deferredUntilIso }),
    ...(row.note === undefined ? {} : { note: row.note }),
    ...(row.reason === undefined ? {} : { reason: row.reason }),
  });
}

/** Whether a parsed value is a verb this version knows. */
function isVerb(value: unknown): value is LockInVerb {
  return LOCK_IN_VERBS.some((known) => known === value);
}

/** Whether a parsed value is an outcome this version knows. */
function isOutcome(value: unknown): value is LockInOutcome {
  return LOCK_IN_OUTCOMES.some((known) => known === value);
}

/** Whether a parsed value is a reason tag this version knows. */
function isReason(value: unknown): value is LockInReason {
  return LOCK_IN_REASONS.some((known) => known === value);
}

/** One optional string field, kept only when it carries something. */
function optionalText({ value }: { value: unknown }): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

/** Decode one ledger line, or `undefined` when this version cannot read it. */
function decodeLockInRow({ line }: { line: string }): LockInRow | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed) || !isVerb(parsed["verb"]) || !isOutcome(parsed["outcome"])) {
    return undefined;
  }
  const { tsIso, identity, againstWhenIso, proposed } = parsed;
  const named = typeof tsIso === "string" && typeof identity === "string" && typeof againstWhenIso === "string";
  if (!named || typeof proposed !== "string") {
    return undefined;
  }
  const reason = parsed["reason"];
  const deferredUntilIso = optionalText({ value: parsed["deferredUntilIso"] });
  const note = optionalText({ value: parsed["note"] });
  return {
    againstWhenIso,
    identity,
    outcome: parsed["outcome"],
    proposed,
    tsIso,
    verb: parsed["verb"],
    ...(deferredUntilIso === undefined ? {} : { deferredUntilIso }),
    ...(note === undefined ? {} : { note }),
    ...(isReason(reason) ? { reason } : {}),
  };
}

/**
 * Parse the ledger text into rows, skipping what it cannot read.
 *
 * Tolerant for the reason every append-only ledger here is: a truncated final line is the normal consequence
 * of a process dying mid-append, and it must not make the whole file unreadable. Skipping can only LOSE a
 * resolution, never invent one, and a lost resolution shows an item again rather than hiding one.
 *
 * @param text the raw `lock-in.jsonl` contents
 * @returns the rows that decoded, in file order
 */
export function parseLockInRows({ text }: { text: string }): readonly LockInRow[] {
  return text.split("\n").flatMap((line) => {
    if (line.trim().length === 0) {
      return [];
    }
    const row = decodeLockInRow({ line });
    return row === undefined ? [] : [row];
  });
}

/**
 * Everything the ledger remembers about one item. Derived, never stored.
 *
 * @internal the contract between the fold and the ranking, exported ahead of a consumer outside this module.
 */
export interface LockInState {
  readonly identity: string;
  /** The most recent resolution's outcome. */
  readonly outcome: LockInOutcome;
  /** Its reason tag, when it carried one. */
  readonly reason: LockInReason | undefined;
  /** When it was resolved. */
  readonly resolvedAtIso: string;
  /** The item's own `whenIso` it was resolved against. A newer one lapses the resolution. */
  readonly againstWhenIso: string;
  /** When a `defer` stops holding, on the most recent resolution. */
  readonly deferredUntilIso: string | undefined;
  /**
   * Anything the owner said in their own words on the most recent resolution, verbatim.
   *
   * Folded through rather than dropped because it is the only place a ruling can NAME something — the page
   * that replaced this one, in particular. `../briefing/openArtifacts.ts` reads an artifact URL out of it to
   * mark a page superseded, which is a fact the owner recorded rather than one anything inferred.
   */
  readonly note: string | undefined;
  /** How many times the owner has resolved this item at all, across every state it has been in. */
  readonly resolutions: number;
}

/**
 * Fold the whole ledger into one state per item.
 *
 * Row order is file order, which is append order, so "most recent" is simply "last seen while folding".
 * Unlike the reflect ledger there is no terminal field: every resolution here is the latest word about the
 * item AS IT THEN STOOD, and {@link resolutionHolds} is what decides whether it still applies.
 *
 * @param rows the parsed ledger, in file order
 * @returns one state per item identity, keyed by identity
 */
export function foldLockInLedger({ rows }: { rows: readonly LockInRow[] }): ReadonlyMap<string, LockInState> {
  const states = new Map<string, LockInState>();
  for (const row of rows) {
    const prior = states.get(row.identity);
    states.set(row.identity, {
      againstWhenIso: row.againstWhenIso,
      deferredUntilIso: row.deferredUntilIso,
      identity: row.identity,
      note: row.note,
      outcome: row.outcome,
      reason: row.reason,
      // An item with no prior state is being resolved for the first time.
      resolutions: prior === undefined ? 1 : prior.resolutions + 1,
      resolvedAtIso: row.tsIso,
    });
  }
  return states;
}

/**
 * Whether a recorded resolution still governs the item in front of us.
 *
 * Two ways it stops. The item MOVED — its `whenIso` is newer than the one the owner answered against — so what they
 * settled is not what is being shown now. Or a `defer` ran out.
 *
 * An item that has not moved and is not deferred is still governed, whatever the outcome; whether that
 * outcome hides it is {@link suppression}'s question, not this one.
 *
 * @param state the folded resolution
 * @param whenIso the item's own last-moved instant, now
 * @param nowIso the run's own instant
 * @returns true while the resolution still describes this item
 */
export function resolutionHolds({
  state,
  whenIso,
  nowIso,
}: {
  state: LockInState;
  whenIso: string;
  nowIso: string;
}): boolean {
  if (whenIso > state.againstWhenIso) {
    return false;
  }
  if (state.deferredUntilIso !== undefined && nowIso >= state.deferredUntilIso) {
    return false;
  }
  return true;
}

/**
 * Why a held resolution keeps the item off the list, or `undefined` when it does not.
 *
 * `dropped`, `rejected` and `deferred` hide the row; that is what the owner said them for. `approved-as-proposed`
 * and `edited` do NOT, and that is the important half: the owner agreeing to do something is not the source
 * confirming they did. Hiding an approved row would be the memo's own rule broken — absence alone is never
 * done — and it is how a list starts quietly losing work.
 *
 * `noted` hides nothing either. A note is a comment on the row, not a verdict about it.
 *
 * @param state the folded resolution, already known to hold
 * @returns the reason a reader is shown, or undefined when the item still belongs on the list
 */
export function suppression({ state }: { state: LockInState }): string | undefined {
  const because = state.reason === undefined ? "" : ` (${state.reason})`;
  if (state.outcome === "dropped") {
    return `you dropped this on ${state.resolvedAtIso.slice(0, 10)}${because}, and it has not moved since`;
  }
  if (state.outcome === "rejected") {
    return `you rejected this on ${state.resolvedAtIso.slice(0, 10)}${because}, and it has not moved since`;
  }
  if (state.outcome === "deferred") {
    const until = absentAs({ value: state.deferredUntilIso, whenAbsent: "further notice" });
    return `you deferred this until ${until}, and it has not moved since`;
  }
  return undefined;
}

/**
 * What one item's own resolution did to it.
 *
 * @internal the contract between {@link applyResolutions} and the verb's own shell.
 */
export interface Resolved {
  readonly input: RankInput;
  /** Why it was held back, or undefined when it stays on the list. */
  readonly suppressedBecause: string | undefined;
}

/**
 * The ledger's word about one item, looked up by its identity and then by its anchor URL.
 *
 * The URL is the second key because a ruling does not always arrive through the walk. A supervisor relaying
 * what the owner said about a pull-request card holds the card's link, and MEASURED once it recorded the
 * ruling as prose in a state doc instead — which is how four already-ruled rows led the next supervisor's
 * list. `lock-in --item <url>` is accepted for exactly that caller, and this is where it lands.
 *
 * @param item the row being placed
 * @param states the folded ledger
 * @returns the most recent resolution naming this item either way, or undefined when there is none
 */
export function resolutionFor({
  item,
  states,
}: {
  item: Item;
  states: ReadonlyMap<string, LockInState>;
}): LockInState | undefined {
  const found = states.get(itemIdentity({ item }));
  if (found === undefined) {
    return states.get(item.where);
  }
  return found;
}

/**
 * Apply the ledger to a run's candidates.
 *
 * This is the function that makes the ledger feedback rather than a diary. It is deliberately the LAST gate
 * and not a signal: what the owner said about a row is not a weight another row's score can outvote.
 *
 * @param inputs every candidate the legs produced
 * @param states the folded ledger
 * @param nowIso the run's own instant
 * @returns each candidate with the reason it was held back, or undefined when it stays
 */
export function applyResolutions({
  inputs,
  states,
  nowIso,
}: {
  inputs: readonly RankInput[];
  states: ReadonlyMap<string, LockInState>;
  nowIso: string;
}): readonly Resolved[] {
  return inputs.map((input) => {
    const state = resolutionFor({ item: input.item, states });
    if (state === undefined || !resolutionHolds({ nowIso, state, whenIso: input.item.whenIso })) {
      return { input, suppressedBecause: undefined };
    }
    return { input, suppressedBecause: suppression({ state }) };
  });
}

/**
 * The lock-in ledger's own directory, a sibling of the flat ledgers under the state home.
 *
 * @internal exported for its own tests until a consumer outside this module reads it.
 *
 * @param home the state home (defaults to the resolved home)
 * @returns the absolute directory holding `lock-in.jsonl`
 */
export function lockInLedgerDir({ home }: { home?: string } = {}): string {
  return join(stateHomePaths(home !== undefined ? { home } : {}).ledgers, "session-start");
}

/**
 * The ledger file itself.
 *
 * @internal exported for its own tests until a consumer outside this module reads it.
 *
 * @param home the state home (defaults to the resolved home)
 * @returns the absolute path to `lock-in.jsonl`
 */
export function lockInLedgerPath({ home }: { home?: string } = {}): string {
  return join(lockInLedgerDir(home !== undefined ? { home } : {}), "lock-in.jsonl");
}

/**
 * Read the ledger's raw text.
 *
 * An absent ledger — a home the owner has never walked — is the empty string rather than an error, so a first run
 * reads as "nothing resolved yet" instead of as a broken home.
 *
 * @param home the state home
 * @returns the file's contents, or the empty string when it does not exist
 */
export function readLockInLedger({ home }: { home?: string } = {}): string {
  try {
    return readFileSync(lockInLedgerPath(home !== undefined ? { home } : {}), "utf8");
  } catch {
    return "";
  }
}

/** Whether anything at all — a file, a directory, a link however dangling — sits at the path itself. */
function pathEntryExists({ path }: { path: string }): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

/** Whether what the path resolves to is there and is anything but a regular file: a directory, a FIFO, a device. */
function isNonFileEntry({ path }: { path: string }): boolean {
  try {
    return !statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * Read the ledger's raw text for a caller that must not mistake an unreadable ledger for an empty one — a drop,
 * where a ledger that would not read hides whatever the owner's last word was. Absent is still empty.
 *
 * @param home the state home
 * @returns the file's contents, the empty string when it does not exist, or why it would not read
 */
export function readLockInLedgerExact({ home }: { home?: string } = {}): Result<string> {
  const path = lockInLedgerPath(home !== undefined ? { home } : {});
  // A FIFO or device at the path would BLOCK the read rather than fail it: only a regular file is read.
  if (isNonFileEntry({ path })) {
    return err([`the lock-in ledger at ${path} is not a regular file, so it was not read`]);
  }
  try {
    return ok(readFileSync(path, "utf8"));
  } catch (cause) {
    // ENOENT through a dangling link is a ledger that exists and will not read, not an absent one.
    if (isRecord(cause) && cause["code"] === "ENOENT" && !pathEntryExists({ path })) {
      return ok("");
    }
    const why = cause instanceof Error ? cause.message : String(cause);
    return err([`the lock-in ledger at ${path} would not read — ${why}`]);
  }
}

/**
 * Append one resolution.
 *
 * @param row the resolution to record
 * @param home the state home
 * @returns the path written, or the reason the append failed
 */
export function recordLockIn({ row, home }: { row: LockInRow; home?: string }): Result<string> {
  const dir = lockInLedgerDir(home !== undefined ? { home } : {});
  const path = lockInLedgerPath(home !== undefined ? { home } : {});
  const written = safeFs({
    execute: (): string => {
      mkdirSync(dir, { recursive: true });
      appendLines({ path, text: `${lockInLine({ row })}\n` });
      return path;
    },
    operation: "recordLockIn",
    path,
  });
  return written.isOk() ? ok(written.value) : err([written.error.message]);
}
