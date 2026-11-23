/**
 * `slopweaver github press-reseal` — re-key press-register rows whose stored key is not their own fields' hash.
 * The plan and the digest are pure; the apply runs over injected seams (`./pressResealStoreRows.ts` is
 * production's), so a unit test drives every branch over a plain in-memory fake.
 *
 * ## Why a repair verb, and why the reader stays strict
 *
 * `decodeStored` (`./pressJournalPort.ts`) refuses the WHOLE register when one row sits under a key its fields do
 * not hash to, and that is right: a key that lies is corruption a CHECK cannot see. MEASURED on a carried home —
 * a home and store moved between machines through a sanitiser that rewrote the repository slug in every row —
 * 237 rows, 0 of which hashed to their key, so `github landing` refused for every repository. Loosening the
 * reader would hide the next real corruption; this verb is the explicit, journalled act that repairs the one
 * known cause instead.
 *
 * ## What it refuses, and why each refusal leaves the register untouched
 *
 * - **A row that does not decode** — no key can be computed for it.
 * - **A mismatched row of a repository the caller did not name** — re-keying only part of the register would
 *   leave it unreadable, and naming the repositories is how the caller says whose rows they meant to re-key.
 * - **A new key already held** — by any stored row, or by another re-keyed one. Refused rather than collapsed,
 *   even when the two rows are the same press: a duplicate after a carry is a fact about the carry worth a
 *   human look, and refusing also means no order of the updates can ever meet the primary key mid-transaction.
 * - **A register that moved since the preview** — the apply names the preview's `sourceSha256`, and the
 *   transaction recomputes it before writing anything.
 * - **A register that still would not read after the re-key** — read back through `decodeStored` itself, inside
 *   the transaction, and rolled back unless it decodes whole.
 */
import { err, ok, type Result } from "#lib/result.js";

import { type StoreStepFailure, sha256Hex } from "../store/registerImport.js";
import { decodePressRecord, pressKey } from "./pressJournal.js";
import { decodeStored, type StoredPress } from "./pressJournalPort.js";
import { type PressResealError, PressResealErrors } from "./pressResealErrors.js";

/**
 * One row the reseal moves: from the key it is stored under to the key its fields hash to.
 *
 * @internal
 */
export interface PressResealPair {
  readonly oldKey: string;
  readonly newKey: string;
  readonly repoSlug: string;
  readonly number: number;
}

/**
 * How many rows one repository has re-keyed.
 *
 * @internal
 */
export interface PressResealRepoCount {
  readonly repoSlug: string;
  readonly rows: number;
}

/** What a reseal would do, or did. */
export interface PressResealPlan {
  /** The digest of every stored row, key and fields, before anything moved. */
  readonly sourceSha256: string;
  /** How many rows the register holds. */
  readonly rowCount: number;
  /** Every row to re-key, in stored order. */
  readonly pairs: readonly PressResealPair[];
  /** Rows to re-key per repository, by slug. */
  readonly perRepo: readonly PressResealRepoCount[];
}

/** The one line an applied reseal appends to its journal. */
export interface PressResealReceipt {
  readonly kind: "landing-press-reseal";
  readonly atIso: string;
  readonly reason: string;
  readonly repos: readonly string[];
  readonly sourceSha256: string;
  readonly count: number;
  readonly pairs: readonly PressResealPair[];
}

/** The statements one open transaction offers the apply. */
export interface PressResealTx {
  /** Every stored press, in insertion order. */
  readonly readAll: () => Promise<Result<readonly StoredPress[], StoreStepFailure>>;
  /** Move one row from `oldKey` to `newKey`; true when exactly one row moved. */
  readonly rekey: (request: {
    readonly oldKey: string;
    readonly newKey: string;
  }) => Promise<Result<boolean, StoreStepFailure>>;
}

/** Every effect the reseal performs. */
export interface PressResealSeams {
  /** Every stored press, read outside any transaction — the preview's read. */
  readonly readStored: (request: {
    readonly home: string;
  }) => Promise<Result<readonly StoredPress[], PressResealError>>;
  /** Run the body in ONE transaction, committing on ok and rolling back on err. */
  readonly inTransaction: (request: {
    readonly home: string;
    readonly body: (tx: PressResealTx) => Promise<Result<PressResealPlan, PressResealError>>;
  }) => Promise<Result<PressResealPlan, PressResealError>>;
  /** Append one receipt to the owner-only journal, answering its path. */
  readonly appendReceipt: (request: {
    readonly home: string;
    readonly receipt: PressResealReceipt;
  }) => Result<string, PressResealError>;
}

/**
 * The digest of the register as stored: sha-256 over one canonical JSON line per row — key, then every field —
 * sorted, so the read order cannot change it and any change to any row does.
 *
 * @param stored every stored row
 * @returns the lower-case hex digest
 */
export function pressRegisterDigest({ stored }: { stored: readonly StoredPress[] }): string {
  const lines = stored
    .map((row) => JSON.stringify([row.pressKey, row.repoSlug, row.number, row.headOid, row.entryState, row.atIso]))
    .toSorted();
  return sha256Hex({ text: lines.join("\n") });
}

/**
 * The first key two rows would share once the plan's pairs moved, counting every row's CURRENT key as held.
 *
 * @param stored every stored row
 * @param pairs the rows to move
 * @returns the refusal naming the key and its claimants, or undefined when every key is unique
 */
function firstCollision({
  stored,
  pairs,
}: {
  stored: readonly StoredPress[];
  pairs: readonly PressResealPair[];
}): PressResealError | undefined {
  const claimants = new Map<string, string[]>();
  for (const row of stored) {
    claimants.set(row.pressKey, [row.pressKey]);
  }
  for (const pair of pairs) {
    const held = claimants.get(pair.newKey);
    if (held !== undefined) {
      return PressResealErrors.keyCollision({ newKey: pair.newKey, oldKeys: [...held, pair.oldKey] });
    }
    claimants.set(pair.newKey, [pair.oldKey]);
  }
  return undefined;
}

/**
 * Rows to re-key per repository, sorted by slug.
 *
 * @param pairs the rows to move
 * @returns one count per repository
 */
function countPerRepo({ pairs }: { pairs: readonly PressResealPair[] }): readonly PressResealRepoCount[] {
  const counts = new Map<string, number>();
  for (const pair of pairs) {
    const prior = counts.get(pair.repoSlug);
    counts.set(pair.repoSlug, prior === undefined ? 1 : prior + 1);
  }
  return [...counts.entries()]
    .map(([repoSlug, rows]) => ({ repoSlug, rows }))
    .toSorted((a, b) => a.repoSlug.localeCompare(b.repoSlug));
}

/**
 * Plan a reseal: decode every row strictly, pair each mismatched key with its fields' hash, and refuse anything
 * that would leave the register unreadable or fold two rows into one.
 *
 * @param stored every stored row, in insertion order
 * @param repos the repositories the caller named, `owner/name`
 * @returns the plan — empty pairs when the register is already sound — or the refusal
 */
export function planPressReseal({
  stored,
  repos,
}: {
  stored: readonly StoredPress[];
  repos: readonly string[];
}): Result<PressResealPlan, PressResealError> {
  const pairs: PressResealPair[] = [];
  for (const row of stored) {
    const decoded = decodePressRecord({ value: row });
    if (decoded.isErr()) {
      return err(PressResealErrors.recordInvalid({ pressKey: row.pressKey, reason: decoded.error.message }));
    }
    const newKey = pressKey({ record: decoded.value });
    if (newKey !== row.pressKey) {
      pairs.push({ newKey, number: row.number, oldKey: row.pressKey, repoSlug: row.repoSlug });
    }
  }
  const named = new Set(repos);
  const unnamed = [...new Set(pairs.map((pair) => pair.repoSlug))].filter((slug) => !named.has(slug)).toSorted();
  if (unnamed.length > 0) {
    return err(PressResealErrors.repoNotNamed({ repos: unnamed }));
  }
  const collision = firstCollision({ pairs, stored });
  if (collision !== undefined) {
    return err(collision);
  }
  return ok({
    pairs,
    perRepo: countPerRepo({ pairs }),
    rowCount: stored.length,
    sourceSha256: pressRegisterDigest({ stored }),
  });
}

/**
 * Preview a reseal: read the register and plan it. Writes nothing.
 *
 * @param home the Slopweaver home whose store is meant
 * @param repos the repositories the caller named
 * @param seams the effects
 * @returns the plan, or the refusal
 */
export async function previewPressReseal({
  home,
  repos,
  seams,
}: {
  home: string;
  repos: readonly string[];
  seams: PressResealSeams;
}): Promise<Result<PressResealPlan, PressResealError>> {
  const stored = await seams.readStored({ home });
  if (stored.isErr()) {
    return err(stored.error);
  }
  return planPressReseal({ repos, stored: stored.value });
}

/**
 * The transaction body: re-read, prove the register is the previewed one, re-key, and read back through the
 * ordinary strict decoder. Any err rolls the whole transaction back.
 *
 * @param tx the open transaction
 * @param repos the repositories the caller named
 * @param expectedSourceSha256 the digest the preview printed
 * @returns the plan it carried out, or the refusal
 * @internal
 */
export async function resealWithin({
  tx,
  repos,
  expectedSourceSha256,
}: {
  tx: PressResealTx;
  repos: readonly string[];
  expectedSourceSha256: string;
}): Promise<Result<PressResealPlan, PressResealError>> {
  const stored = await tx.readAll();
  if (stored.isErr()) {
    return err(PressResealErrors.storeUnavailable(stored.error));
  }
  const observed = pressRegisterDigest({ stored: stored.value });
  if (observed !== expectedSourceSha256) {
    return err(PressResealErrors.sourceMoved({ expected: expectedSourceSha256, observed }));
  }
  const plan = planPressReseal({ repos, stored: stored.value });
  if (plan.isErr() || plan.value.pairs.length === 0) {
    return plan;
  }
  for (const pair of plan.value.pairs) {
    const moved = await tx.rekey({ newKey: pair.newKey, oldKey: pair.oldKey });
    if (moved.isErr()) {
      return err(PressResealErrors.storeUnavailable(moved.error));
    }
    if (!moved.value) {
      return err(PressResealErrors.rowMoved({ oldKey: pair.oldKey }));
    }
  }
  const after = await tx.readAll();
  if (after.isErr()) {
    return err(PressResealErrors.storeUnavailable(after.error));
  }
  if (after.value.length !== plan.value.rowCount) {
    return err(
      PressResealErrors.readbackUnsound({
        reason: `it holds ${String(after.value.length)} rows where ${String(plan.value.rowCount)} were re-keyed over`,
      }),
    );
  }
  const decoded = decodeStored({ stored: after.value });
  if (decoded.isErr()) {
    return err(PressResealErrors.readbackUnsound({ reason: decoded.error.message }));
  }
  return plan;
}

/** What an applied reseal reports: the plan carried out, and where its receipt went when one was written. */
export interface PressResealApplied {
  readonly plan: PressResealPlan;
  /** The journal the receipt was appended to; undefined when there was nothing to re-key, so nothing to journal. */
  readonly receiptPath: string | undefined;
}

/**
 * Apply a reseal in one transaction, then journal its receipt.
 *
 * @param home the Slopweaver home whose store and journal are meant
 * @param repos the repositories the caller named
 * @param expectedSourceSha256 the digest the preview printed
 * @param reason why, in the caller's words — recorded on the receipt
 * @param nowIso the receipt's instant
 * @param seams the effects
 * @returns the plan carried out and the receipt's path, or the refusal
 */
export async function applyPressReseal({
  home,
  repos,
  expectedSourceSha256,
  reason,
  nowIso,
  seams,
}: {
  home: string;
  repos: readonly string[];
  expectedSourceSha256: string;
  reason: string;
  nowIso: string;
  seams: PressResealSeams;
}): Promise<Result<PressResealApplied, PressResealError>> {
  const applied = await seams.inTransaction({
    body: (tx) => resealWithin({ expectedSourceSha256, repos, tx }),
    home,
  });
  if (applied.isErr()) {
    return err(applied.error);
  }
  const plan = applied.value;
  if (plan.pairs.length === 0) {
    return ok({ plan, receiptPath: undefined });
  }
  const receipt: PressResealReceipt = {
    atIso: nowIso,
    count: plan.pairs.length,
    kind: "landing-press-reseal",
    pairs: plan.pairs,
    reason,
    repos: [...repos].toSorted(),
    sourceSha256: plan.sourceSha256,
  };
  const written = seams.appendReceipt({ home, receipt });
  if (written.isErr()) {
    return err(written.error);
  }
  return ok({ plan, receiptPath: written.value });
}
