/**
 * The pull-request snapshot's SHAPE and its pure decoding — what `github stack restack` records about every
 * open pull request of the operator's, and what `github stack submit` will refuse to push without.
 *
 * ## Why a snapshot rather than another per-pull-request ledger
 *
 * Every open pull request on the remote has local state tracking, stacked or not. The existing `./stackLedger.ts` is one file per pull request
 * and is never pruned when one merges: 227 stale entries in lachiejames/slopweaver made `stack sync
 * --dry-run` take 186 seconds to decide it had nothing to do. A snapshot is COMPLETE by construction, so a
 * merged pull request disappears by being absent from the next one, and nothing has to remember to delete
 * anything.
 *
 * ## Every row is a fact ABOUT THE REMOTE, measured at a known instant
 *
 * `remoteHeadSha` is what GitHub said the pull request's head was when the snapshot was cut. That single
 * field is what makes the submit refusal possible: if the remote branch moved beyond what the local state
 * said it was, `stack submit` fails and says the remote differs, and `--force` pushes it anyway. A submit compares the live head to this and refuses on a
 * mismatch. Everything else in a row exists to make that refusal precise rather than a shrug.
 *
 * Nothing here touches the filesystem — `./prStateStore.ts` reads and writes these rows.
 */
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { type PrStateError, PrStateErrors } from "./prStateErrors.js";

/** The snapshot format's version, bumped only when a reader could misread an older row. */
export const PR_STATE_VERSION = 1;

/** Line one of the file: which repository and which restack generation this whole snapshot describes. */
export interface PrStateHeader {
  readonly kind: "header";
  readonly version: number;
  /** `owner/name`, lower-cased, so a differently-cased remote cannot mint a second snapshot. */
  readonly repo: string;
  /** The generation of `refs/slopweaver/restack/<generation>/<branch>` every prepared row points into. */
  readonly generationId: string;
  readonly recordedAtIso: string;
}

/** Whether a pull request is ready to be submitted, or why it is not. */
export type PrPreparation =
  | { readonly kind: "ready"; readonly preparedSha: string; readonly preparedRef: string }
  | { readonly kind: "unchanged" }
  | { readonly kind: "blocked"; readonly reason: string };

/** One open pull request, as the last restack measured and prepared it. */
export interface PrStateEntry {
  readonly kind: "pull-request";
  readonly number: number;
  readonly headRef: string;
  readonly baseRef: string;
  /** What GitHub said this pull request's head was when the snapshot was cut. */
  readonly remoteHeadSha: string;
  /** The base branch's tip at the same instant, or `null` when it could not be read. */
  readonly observedBaseSha: string | null;
  /** What the local branch pointed at after the restack, or `null` when this checkout has no such branch. */
  readonly localBranchSha: string | null;
  readonly preparation: PrPreparation;
}

/** A whole snapshot: one header, then one row per open pull request, ordered by number. */
export interface PrState {
  readonly header: PrStateHeader;
  readonly entries: readonly PrStateEntry[];
}

/** Decode one preparation, or nothing when the value is not one. */
function decodePreparation({ value }: { value: unknown }): PrPreparation | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (value["kind"] === "unchanged") {
    return { kind: "unchanged" };
  }
  if (value["kind"] === "blocked" && typeof value["reason"] === "string") {
    return { kind: "blocked", reason: value["reason"] };
  }
  if (
    value["kind"] === "ready" &&
    typeof value["preparedSha"] === "string" &&
    typeof value["preparedRef"] === "string"
  ) {
    return { kind: "ready", preparedRef: value["preparedRef"], preparedSha: value["preparedSha"] };
  }
  return undefined;
}

/** A field that is a string or explicitly `null`, and nothing else. */
function nullableString({ value }: { value: unknown }): string | null | undefined {
  if (value === null || typeof value === "string") {
    return value;
  }
  return undefined;
}

/**
 * Decode one header row.
 *
 * @param value the parsed JSON of line one
 * @returns the header, or nothing when the row is not one
 */
export function decodePrStateHeader({ value }: { value: unknown }): PrStateHeader | undefined {
  if (!isRecord(value) || value["kind"] !== "header") {
    return undefined;
  }
  const { version, repo, generationId, recordedAtIso } = value;
  if (version !== PR_STATE_VERSION) {
    return undefined;
  }
  if (typeof repo !== "string" || typeof generationId !== "string" || typeof recordedAtIso !== "string") {
    return undefined;
  }
  return { generationId, kind: "header", recordedAtIso, repo, version };
}

/**
 * Decode one pull-request row.
 *
 * @param value the parsed JSON of one line after the header
 * @returns the entry, or nothing when the row is not one
 */
export function decodePrStateEntry({ value }: { value: unknown }): PrStateEntry | undefined {
  if (!isRecord(value) || value["kind"] !== "pull-request") {
    return undefined;
  }
  const { number, headRef, baseRef, remoteHeadSha } = value;
  if (typeof number !== "number" || !Number.isInteger(number) || number <= 0) {
    return undefined;
  }
  if (typeof headRef !== "string" || typeof baseRef !== "string" || typeof remoteHeadSha !== "string") {
    return undefined;
  }
  const observedBaseSha = nullableString({ value: value["observedBaseSha"] });
  const localBranchSha = nullableString({ value: value["localBranchSha"] });
  const preparation = decodePreparation({ value: value["preparation"] });
  if (observedBaseSha === undefined || localBranchSha === undefined || preparation === undefined) {
    return undefined;
  }
  return {
    baseRef,
    headRef,
    kind: "pull-request",
    localBranchSha,
    number,
    observedBaseSha,
    preparation,
    remoteHeadSha,
  };
}

/**
 * Assemble a whole snapshot from already-parsed rows, refusing anything it cannot fully account for.
 *
 * A row it cannot decode is a REFUSAL, never a skip. The snapshot's whole value is that it is complete, so
 * quietly dropping the one row it could not read would turn "every open pull request of yours" into "every
 * open pull request of yours that happened to parse" at exactly the moment a submit is deciding what to push.
 *
 * @param rows every line's parsed JSON, in file order
 * @param path where the rows came from, named in any refusal
 * @param repo the `owner/name` the caller expects this snapshot to describe, lower-cased
 * @returns the snapshot, or why it cannot be used
 */
export function assemblePrState({
  path,
  repo,
  rows,
}: {
  path: string;
  repo: string;
  rows: readonly unknown[];
}): Result<PrState, PrStateError> {
  const [first, ...rest] = rows;
  const header = decodePrStateHeader({ value: first });
  if (header === undefined) {
    return err(PrStateErrors.invalid({ path, why: "its first line is not a header of a version this reads" }));
  }
  if (header.repo !== repo) {
    return err(PrStateErrors.invalid({ path, why: `it describes ${header.repo}, not ${repo}` }));
  }
  const entries: PrStateEntry[] = [];
  const seen = new Set<number>();
  for (const row of rest) {
    const entry = decodePrStateEntry({ value: row });
    if (entry === undefined) {
      return err(PrStateErrors.invalid({ path, why: "one of its rows is not a pull-request row this reads" }));
    }
    if (seen.has(entry.number)) {
      return err(PrStateErrors.invalid({ path, why: `it carries two rows for #${String(entry.number)}` }));
    }
    seen.add(entry.number);
    entries.push(entry);
  }
  return ok({ entries: entries.toSorted((a, b) => a.number - b.number), header });
}

/**
 * The rows one snapshot is written as, header first and entries in pull-request order.
 *
 * @param state the snapshot to serialise
 * @returns one plain object per line, in file order
 */
export function prStateRows({ state }: { state: PrState }): readonly unknown[] {
  return [state.header, ...state.entries.toSorted((a, b) => a.number - b.number)];
}

/**
 * Whether the remote has moved under one recorded row — the check `stack submit` refuses on.
 *
 * @param liveHeadSha what the remote says this pull request's head is NOW
 * @returns true when the live head is not the one the snapshot recorded
 */
export function remoteHasMoved({ entry, liveHeadSha }: { entry: PrStateEntry; liveHeadSha: string }): boolean {
  return entry.remoteHeadSha !== liveHeadSha;
}
