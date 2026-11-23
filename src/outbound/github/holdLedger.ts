/**
 * The merge hold's JOURNAL — one append-only row per transition, as pure functions. The bytes are written by
 * `./holdLedgerStore.ts`; nothing here touches the filesystem, the network or the clock.
 *
 * ## Why a journal beside a document that already exists
 *
 * `./mergeHoldStore.ts` writes ONE document and REPLACES it: `merge-hold.json` says which pull request owns
 * the queue right now, and a release deletes the entry. That is the correct shape for the refusal — a merge
 * asks "is anything held", and a document answers it in one read — but it means a hold that has been
 * released left nothing behind. How long a pull request held the queue, how many holds a shift placed, whether the
 * holder was still alive when it went stale: none of it survived the release. It existed only as prose,
 * inside the `why` sentence of a supervisor-stream event, phrased for a human to read once.
 *
 * MEASURED on this install (`slopweaver github hold --pr=999 --repo o/r --why probe --home
 * $(mktemp -d)`, then `find "$home" -type f`): a placement writes exactly two files — the hold document and
 * one supervisor-stream line — and a release removes the document entry. Nothing anywhere carries the
 * duration as a number.
 *
 * ## This makes holding AUDITABLE, never easier
 *
 * Stated because the reverse would be a defect rather than a bonus: a
 * hold is the EXCEPTION and `github enqueue` is the lane (`skills/github/reference/merge-queue.md`). Nothing
 * in this file refuses less, holds longer, or gives a hold any new power. It records what already happened,
 * so a shift that took a hold can be measured after the fact without measuring it by hand.
 *
 * ## One row per transition, never a running total
 *
 * Three kinds — `held`, `released`, `stale` — because those are the three moments anything about a hold
 * changes, and each is written by the surface that observes it. `heldMinutes` is carried on the row rather
 * than left for a reader to subtract, so a reader that has only the tail of the file still has the duration.
 */

import { isRecord } from "../../lib/parsers.js";
import { holdAgeMinutes, type MergeHold } from "./mergeHold.js";

/** The row layout marker, so a future shape change can be told from a corrupt line. */
export const HOLD_LEDGER_SCHEMA_VERSION = 1;

/**
 * What happened to a hold.
 *
 * `stale` is a row rather than only a stream event because it is the one transition that happens to a hold
 * NOBODY released — the case where the document is about to carry no duration at all.
 */
export type HoldLedgerKind = "held" | "released" | "stale";

/** One journalled transition of one hold. */
export interface HoldLedgerRow {
  readonly schemaVersion: number;
  readonly kind: HoldLedgerKind;
  /** The repository the hold governs, as `owner/name`. */
  readonly repo: string;
  /** The held pull request. */
  readonly pr: number;
  /** The session that placed it, so a row names who to ask rather than only what happened. */
  readonly holder: string;
  /** When this transition happened. */
  readonly atIso: string;
  /** When the hold was PLACED — equal to {@link atIso} on a `held` row. */
  readonly heldAtIso: string;
  /** How long the hold had stood at this transition, in whole minutes. Zero on a `held` row. */
  readonly heldMinutes: number;
  /** The threshold the hold was placed with, so a `stale` row can be judged against its own bound. */
  readonly staleMinutes: number;
  /** The holder's stated reason, carried verbatim so a row explains itself with no second lookup. */
  readonly why: string;
  /** The commit the held pull request landed as, on a `released` row that was given one. */
  readonly sha: string | undefined;
}

/**
 * The row one transition of one hold owes the journal.
 *
 * @param hold the hold this transition is about
 * @param kind which transition
 * @param nowIso when it happened
 * @param sha the landed commit, on a release that knows one
 * @returns the row to append
 */
export function holdLedgerRow({
  hold,
  kind,
  nowIso,
  sha,
}: {
  hold: MergeHold;
  kind: HoldLedgerKind;
  nowIso: string;
  sha?: string | undefined;
}): HoldLedgerRow {
  return {
    atIso: nowIso,
    heldAtIso: hold.atIso,
    heldMinutes: holdAgeMinutes({ hold, nowIso }),
    holder: hold.holder,
    kind,
    pr: hold.pr,
    repo: hold.repo,
    schemaVersion: HOLD_LEDGER_SCHEMA_VERSION,
    sha,
    staleMinutes: hold.staleMinutes,
    why: hold.why,
  };
}

/**
 * One row as the JSONL line to append.
 *
 * A row is fixed-size by construction — one hold's fields, never a collection — so it is serialised whole,
 * which is the shape `AGENTS.md`'s whole-file-string rule explicitly leaves alone. The FILE is read back a
 * line at a time; see `./holdLedgerStore.ts`.
 *
 * @param row the row to serialise
 * @returns the JSON line, with no trailing newline
 */
export function holdLedgerLine({ row }: { row: HoldLedgerRow }): string {
  return JSON.stringify(row);
}

/** Whether a decoded value is one of the three transition kinds. Positional: TS1230 forbids destructuring here. */
function isHoldLedgerKind(value: unknown): value is HoldLedgerKind {
  return value === "held" || value === "released" || value === "stale";
}

/**
 * Decode one journal line, or `undefined` when any load-bearing field is missing or the wrong shape.
 *
 * Tolerant for the same reason `parseMergeHolds` is: a half-written or hand-edited line must cost a reader
 * that one row, never the whole audit trail.
 *
 * @param line one raw JSONL line
 * @returns the decoded row, or `undefined`
 */
export function parseHoldLedgerRow({ line }: { line: string }): HoldLedgerRow | undefined {
  const raw = decodeLine({ line });
  if (raw === undefined) {
    return undefined;
  }
  const identity = rowIdentity({ raw });
  if (identity === undefined) {
    return undefined;
  }
  return { ...identity, ...rowDetail({ atIso: identity.atIso, raw }) };
}

/** The line as a JSON object, or `undefined` when it is blank, malformed, or not an object. */
function decodeLine({ line }: { line: string }): Record<string, unknown> | undefined {
  if (line.trim().length === 0) {
    return undefined;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return undefined;
  }
  return isRecord(raw) ? raw : undefined;
}

/** The five fields a row cannot be decoded without, or `undefined` when any of them is missing or wrong. */
function rowIdentity({
  raw,
}: {
  raw: Record<string, unknown>;
}): Pick<HoldLedgerRow, "atIso" | "holder" | "kind" | "pr" | "repo"> | undefined {
  const kind = raw["kind"];
  const repo = raw["repo"];
  const pr = raw["pr"];
  const holder = raw["holder"];
  const atIso = raw["atIso"];
  if (!isHoldLedgerKind(kind) || typeof repo !== "string" || repo.length === 0) {
    return undefined;
  }
  if (typeof pr !== "number" || !Number.isSafeInteger(pr) || pr <= 0) {
    return undefined;
  }
  if (typeof holder !== "string" || typeof atIso !== "string" || !Number.isFinite(Date.parse(atIso))) {
    return undefined;
  }
  return { atIso, holder, kind, pr, repo };
}

/**
 * The fields a first-version row may lack, defaulted rather than treated as a reason to drop the row: a
 * decodable transition with a missing duration is still evidence that the transition happened.
 */
function rowDetail({
  atIso,
  raw,
}: {
  atIso: string;
  raw: Record<string, unknown>;
}): Pick<HoldLedgerRow, "heldAtIso" | "heldMinutes" | "schemaVersion" | "sha" | "staleMinutes" | "why"> {
  const heldAtIso = raw["heldAtIso"];
  const heldMinutes = raw["heldMinutes"];
  const staleMinutes = raw["staleMinutes"];
  const why = raw["why"];
  const sha = raw["sha"];
  const schemaVersion = raw["schemaVersion"];
  return {
    heldAtIso: typeof heldAtIso === "string" ? heldAtIso : atIso,
    heldMinutes: typeof heldMinutes === "number" && Number.isFinite(heldMinutes) ? Math.max(0, heldMinutes) : 0,
    schemaVersion: typeof schemaVersion === "number" ? schemaVersion : HOLD_LEDGER_SCHEMA_VERSION,
    sha: typeof sha === "string" ? sha : undefined,
    staleMinutes: typeof staleMinutes === "number" && Number.isSafeInteger(staleMinutes) ? staleMinutes : 0,
    why: typeof why === "string" ? why : "",
  };
}

/** One row rendered as the line a human scans — when, what, which pull request, how long, and who held it. */
function ledgerLine({ row }: { row: HoldLedgerRow }): string {
  const landed = row.kind === "released" && row.sha !== undefined ? `\tlanded ${row.sha}` : "";
  return (
    `${row.atIso}\t${row.kind}\t${row.repo}#${String(row.pr)}\t` +
    `${String(row.heldMinutes)}m\tby ${row.holder}\t${row.why}${landed}`
  );
}

/**
 * What `github hold --history` prints.
 *
 * @param rows the journalled rows, oldest first
 * @returns one line per row, or the single line saying the journal is empty
 */
export function holdLedgerRenderedLines({ rows }: { rows: readonly HoldLedgerRow[] }): readonly string[] {
  if (rows.length === 0) {
    return ["no hold has been journalled in this home: nothing has held the merge queue through the door."];
  }
  return rows.map((row) => ledgerLine({ row }));
}
