/**
 * The claim `spend forward` holds on one receipt, so a daily run drafts each receipt's forward to Airwallex once.
 *
 * Modelled on `../gmail/boardDraftClaim.ts`, and for its reasons: the claim is created with `O_EXCL` BEFORE Gmail is
 * called, so two overlapping runs cannot both draft; the draft id is written into it once Gmail answers, so a later
 * run reads "already drafted" and names the draft; and a claim whose holder died is REFUSED as abandoned, never
 * taken over, because that run may have stored its draft before dying and nothing here can tell.
 *
 * One file per receipt, named for its Gmail message id, under `$SLOPWEAVER_HOME/spend/forwards/`. It also carries
 * the charge it answered (`expenseKey`), so a second receipt matched to the same charge later is not forwarded too.
 */
import { readdirSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";

import { err, ok, type Result } from "../../../lib/result.js";
import { safeJsonParse } from "../../../lib/safeJson.js";
import { createFileExclusive, ensureDirectory, writeFileAtomic } from "../../../lib/writeAtomic.js";
import { type SpendForwardError, SpendForwardErrors } from "../../../spend/tasks/forwardErrors.js";
import type { TaskAct } from "../../../spend/tasks/read.js";
import { stateHomePaths } from "../../../stateHome.js";

/**
 * The charge an act answers, as a claim records it: merchant, currency, amount in minor units and day.
 *
 * @returns the key two acts share exactly when they answer the same charge
 */
export function expenseKeyOf({ act }: { act: TaskAct }): string {
  const { amount, day, merchant } = act.expense;
  return `${merchant}|${amount.currency}|${String(amount.minor)}|${day}`;
}

/**
 * How many open expenses in one reading share each charge key, so a key held by two cannot be told apart by a claim.
 *
 * @returns each charge key and how many acts carry it
 */
export function openPerKeyOf({ acts }: { acts: readonly TaskAct[] }): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const act of acts) {
    const key = expenseKeyOf({ act });
    counts.set(key, acts.filter((other) => expenseKeyOf({ act: other }) === key).length);
  }
  return counts;
}

/** A claim as the file holds it: the holder, and the draft once one is stored. */
interface ClaimFile {
  readonly pid: number;
  readonly receiptId: string;
  readonly expenseKey: string;
  readonly draft: DraftedForward | undefined;
}

/** A receipt whose forward an earlier run stored. */
export interface DraftedForward {
  readonly receiptId: string;
  /** The charge the receipt answered: merchant, currency, amount and day. */
  readonly expenseKey: string;
  readonly draftId: string;
  readonly draftMessageId: string | undefined;
}

/** What taking a claim found: this run holds it now, or the receipt was drafted by an earlier run. */
export type ClaimOutcome = { readonly kind: "claimed" } | ({ readonly kind: "drafted" } & DraftedForward);

/** A Gmail message id — the only shape a claim file may be named for. */
const RECEIPT_ID = /^[A-Za-z0-9_-]+$/u;

/** Where one receipt's claim lives. */
function claimPath({ home, receiptId }: { home: string; receiptId: string }): string {
  return join(stateHomePaths({ home }).spendForwards, `${receiptId}.json`);
}

/** Whether a thrown filesystem error is the one `O_EXCL` raises when the file is already there. */
function alreadyExists({ error }: { error: unknown }): boolean {
  return error !== null && typeof error === "object" && "code" in error && error.code === "EEXIST";
}

/** One string field of a parsed claim, or undefined when it is absent or not a string. */
function stringField({ record, key }: { record: object; key: string }): string | undefined {
  const value: unknown = Object.getOwnPropertyDescriptor(record, key)?.value;
  return typeof value === "string" ? value : undefined;
}

/** A claim file's contents, or undefined when it names no holder a reader can use (unreadable or half-written). */
function readClaim({ path }: { path: string }): ClaimFile | undefined {
  let parsed: unknown;
  try {
    parsed = safeJsonParse({ label: "spend forward claim", text: readFileSync(path, "utf8") });
  } catch {
    // Unreadable or half-written: the holder is unknown, which the caller reports rather than takes over.
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || !("pid" in parsed) || typeof parsed.pid !== "number") {
    return undefined;
  }
  const receiptId = stringField({ key: "receiptId", record: parsed });
  const expenseKey = stringField({ key: "expenseKey", record: parsed });
  if (receiptId === undefined || expenseKey === undefined) {
    return undefined;
  }
  const draftId = stringField({ key: "draftId", record: parsed });
  let draft: DraftedForward | undefined;
  if (draftId !== undefined) {
    draft = { draftId, draftMessageId: stringField({ key: "draftMessageId", record: parsed }), expenseKey, receiptId };
  }
  return { draft, expenseKey, pid: parsed.pid, receiptId };
}

/**
 * Every receipt under the home whose forward an earlier run stored.
 *
 * @param home the Slopweaver home
 * @returns the drafted forwards, in directory order; empty when none was ever drafted
 */
export function draftedForwards({ home }: { home: string }): readonly DraftedForward[] {
  const directory = stateHomePaths({ home }).spendForwards;
  let names: readonly string[];
  try {
    names = readdirSync(directory);
  } catch {
    // No directory yet: no forward has ever been drafted under this home.
    return [];
  }
  return names
    .filter((name) => name.endsWith(".json"))
    .map((name) => readClaim({ path: join(directory, name) })?.draft)
    .filter((draft): draft is DraftedForward => draft !== undefined);
}

/**
 * Claim one receipt for this run, or say why this run may not draft it.
 *
 * @param home the Slopweaver home
 * @param receiptId the receipt's Gmail message id
 * @param expenseKey the charge the receipt answered, written into the claim
 * @param pid this run's process id, written into the claim
 * @param alive whether a pid is still in the process table; injected so a test can name a dead holder
 * @returns claimed, or the draft an earlier run stored, or why neither
 */
export function claimForward({
  home,
  receiptId,
  expenseKey,
  pid,
  alive,
}: {
  home: string;
  receiptId: string;
  expenseKey: string;
  pid: number;
  alive: (args: { pid: number }) => boolean;
}): Result<ClaimOutcome, SpendForwardError> {
  if (!RECEIPT_ID.test(receiptId)) {
    return err(SpendForwardErrors.receiptIdInvalid({ receiptId }));
  }
  const path = claimPath({ home, receiptId });
  try {
    ensureDirectory({ directory: stateHomePaths({ home }).spendForwards });
    createFileExclusive({ contents: `${JSON.stringify({ expenseKey, pid, receiptId })}\n`, path });
    return ok({ kind: "claimed" });
  } catch (error: unknown) {
    if (!alreadyExists({ error })) {
      return err(SpendForwardErrors.claimUnwritten({ cause: error instanceof Error ? error.message : String(error) }));
    }
  }
  const held = readClaim({ path });
  if (held === undefined) {
    return err(
      SpendForwardErrors.claimUnwritten({
        cause: `${path} is being written right now, or was left half-written by a run that died — run again`,
      }),
    );
  }
  if (held.draft !== undefined) {
    return ok({ kind: "drafted", ...held.draft });
  }
  if (!alive({ pid: held.pid })) {
    return err(SpendForwardErrors.claimAbandoned({ path, pid: held.pid }));
  }
  return err(SpendForwardErrors.inFlight({ pid: held.pid, receiptId }));
}

/**
 * Write the stored draft into the claim this run holds, so every later run reads it as drafted.
 *
 * @param home the Slopweaver home
 * @param pid this run's process id, kept on the claim
 * @param draftedAtIso when Gmail answered with the draft
 * @returns ok once written, or why the claim was not updated — it is then left holding this run's pid
 */
export function recordForward({
  home,
  pid,
  draft,
  draftedAtIso,
}: {
  home: string;
  pid: number;
  draft: DraftedForward;
  draftedAtIso: string;
}): Result<void, SpendForwardError> {
  const record = {
    draftId: draft.draftId,
    draftedAtIso,
    expenseKey: draft.expenseKey,
    pid,
    receiptId: draft.receiptId,
    ...(draft.draftMessageId === undefined ? {} : { draftMessageId: draft.draftMessageId }),
  };
  try {
    writeFileAtomic({ contents: `${JSON.stringify(record)}\n`, path: claimPath({ home, receiptId: draft.receiptId }) });
    return ok(undefined);
  } catch (error: unknown) {
    return err(SpendForwardErrors.claimUnwritten({ cause: error instanceof Error ? error.message : String(error) }));
  }
}

/**
 * Release a claim this run holds and drafted nothing under. Releasing a claim already gone is not an error.
 *
 * @param home the Slopweaver home
 * @param receiptId the receipt the claim names
 */
export function releaseForward({ home, receiptId }: { home: string; receiptId: string }): void {
  try {
    unlinkSync(claimPath({ home, receiptId }));
  } catch {
    // Already released, or never taken: either way no claim is left standing, which is the point.
  }
}
