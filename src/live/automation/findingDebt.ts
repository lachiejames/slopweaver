/**
 * A finding a failed firing OWES the board: the exact `handover register` argv that did not land, kept on disk
 * until a row by that slug is on the board.
 *
 * ## Why a file, and not a released hold or a diagnostic
 *
 * A held row whose finding never registered stands on a slug no board row carries, and no supervisor tick reads a
 * held recipe — so the breakage is invisible. Taking the hold back off instead lets a `write` or `read-write`
 * recipe run its effect again on a firing nobody has looked at, which the exactly-once contract forbids. And a
 * diagnostic is gone the moment the process exits. So the hold stays and the OBLIGATION persists: one
 * `<finding>.json` here per slug, which `automation run-due` retries on every tick and clears only once the
 * board holds a row by that slug (`../../cli/commands/automation/findingDebtRetry.ts`). The same file covers a
 * failure beneath the owner's own hold, which names no finding and so leaves nothing else behind.
 *
 * ## The board, not the exit code, says whether the finding landed
 *
 * `handover register` creates the row and THEN mirrors it, and a mirror failure exits non-zero over a row that
 * is already there. So every reader asks {@link findingOnBoard}, and a readable row clears the debt whatever any
 * exit code said. One that is there but will not read does NOT clear it: the hold reads the row the same way and
 * stands on it, so the debt keeps failing every tick, naming the slug, until somebody repairs the row.
 */
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import { errorMessage } from "#lib/errorMessage.js";
import { isRecord } from "#lib/parsers.js";
import { isAbsentError, nonBlockingFileBytes } from "#lib/presentFile.js";
import { err, ok, type Result } from "#lib/result.js";
import { safeJsonParse } from "#lib/safeJson.js";
import { writeFileAtomic } from "#lib/writeAtomic.js";

import { readDerivedRowState } from "../../handover/rowState.js";
import { isSafeSlug } from "../../handover/runStore.js";
import { stateHomePaths } from "../../stateHome.js";
import { RecipeErrors, type RecipeFindingDebtError } from "./errors.js";

/** One owed finding: the row it is for, and the argv that registers it. */
export interface FindingDebt {
  /** The finding's slug — also the file's name. */
  readonly finding: string;
  /** The recipe whose failure owes it. */
  readonly recipeId: string;
  /** The exact `handover register` argv, `--home` included. */
  readonly argv: readonly string[];
  /** When the registration first failed. */
  readonly recordedIso: string;
}

/** What one read of the debt directory found. */
export interface FindingDebts {
  readonly debts: readonly FindingDebt[];
  /** Files that would not read as a debt — named, never skipped silently. */
  readonly unread: readonly string[];
  /** Why the directory itself would not list, so NOTHING owed is known; `null` when it listed or is absent. */
  readonly unlisted: string | null;
}

/**
 * Where the owed findings live.
 *
 * @param home the state home
 * @returns `$home/live/recipe/finding-debt`
 */
export function findingDebtDir({ home }: { readonly home: string }): string {
  return join(stateHomePaths({ home }).live.recipe.root, "finding-debt");
}

/**
 * Why a finding is still not on the board after a `handover register` — its own failure, or, when it exited 0, a
 * registrar that reported success and wrote nothing.
 *
 * @param exited why the register failed, or `null` when it exited 0
 * @returns the reason a report line carries
 */
export function whyNotOnBoard({ exited }: { readonly exited: string | null }): string {
  if (exited !== null) {
    return exited;
  }
  return "handover register exited 0 and still no row by that slug is on the board";
}

/**
 * Whether the board holds a READABLE row by this slug, live or archived — the one test of whether a finding landed.
 *
 * It asks `readDerivedRowState` (`../../handover/rowState.ts`) — the exact read the failure hold lifts on
 * (`./failureHoldStore.ts`) — so the two can never disagree: the doc by exact slug, live or archived, AND its run
 * journal, whole. Archived counts: a finding fixed and archived before a retry has landed, and registering its slug
 * again would resurrect finished work. A row that does not read whole — a directory or another slug's doc at the
 * path, a journal line that will not decode — has NOT landed: the hold cannot read it either, so it stands, and the
 * debt stays owed and fails every tick rather than calling a row nobody can seat filed.
 *
 * @param home the state home whose board to look on
 * @param finding the slug
 * @returns `true` only when a row by that exact slug reads whole
 */
export function findingOnBoard({ home, finding }: { readonly home: string; readonly finding: string }): boolean {
  if (!isSafeSlug({ slug: finding })) {
    return false;
  }
  const paths = stateHomePaths({ home });
  return readDerivedRowState({ handoverDir: paths.handovers, runsDir: paths.runs, slug: finding }).isOk();
}

/**
 * Persist one owed finding, replacing any earlier record of the same slug.
 *
 * @param home the state home
 * @param debt what is owed
 * @returns nothing, or why it did not write
 */
export function recordFindingDebt({
  home,
  debt,
}: {
  readonly home: string;
  readonly debt: FindingDebt;
}): Result<void, RecipeFindingDebtError> {
  const path = join(findingDebtDir({ home }), `${debt.finding}.json`);
  if (!isSafeSlug({ slug: debt.finding })) {
    return err(RecipeErrors.findingDebtNotWritten({ detail: "the finding is not a safe slug", path }));
  }
  try {
    mkdirSync(findingDebtDir({ home }), { recursive: true });
    writeFileAtomic({ contents: `${JSON.stringify(debt)}\n`, path });
    return ok(undefined);
  } catch (cause) {
    return err(RecipeErrors.findingDebtNotWritten({ detail: errorMessage({ error: cause }), path }));
  }
}

/** Decode one debt file's text, or `null` when it is not one. */
function decodeDebt({ text, label }: { text: string; label: string }): FindingDebt | null {
  let value: unknown;
  try {
    value = safeJsonParse({ label, text });
  } catch {
    return null;
  }
  if (!isRecord(value)) {
    return null;
  }
  const { argv, finding, recipeId, recordedIso } = value;
  if (!Array.isArray(argv)) {
    return null;
  }
  const args = argv.filter((arg): arg is string => typeof arg === "string");
  const fieldsOk = typeof finding === "string" && typeof recipeId === "string" && typeof recordedIso === "string";
  if (args.length !== argv.length || !fieldsOk) {
    return null;
  }
  return { argv: args, finding, recipeId, recordedIso };
}

/**
 * Every owed finding, in file-name order. A missing directory owes nothing; one that will not list says why.
 *
 * @param home the state home
 * @returns the debts, the files that would not read as one, and why the directory would not list
 */
export function readFindingDebts({ home }: { readonly home: string }): FindingDebts {
  const dir = findingDebtDir({ home });
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch (cause) {
    // Only a directory genuinely not there owes nothing: `existsSync` answers false on EACCES too.
    if (isAbsentError({ error: cause, path: dir })) {
      return { debts: [], unlisted: null, unread: [] };
    }
    return { debts: [], unlisted: `${dir} would not list: ${errorMessage({ error: cause })}`, unread: [] };
  }
  const debts: FindingDebt[] = [];
  const unread: string[] = [];
  for (const name of names.filter((file) => file.endsWith(".json")).toSorted()) {
    const path = join(dir, name);
    let text: string;
    try {
      // Non-blocking, since a FIFO would hang the tick, and strict, since a repaired byte is a debt misread.
      text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(nonBlockingFileBytes({ path }));
    } catch {
      unread.push(name);
      continue;
    }
    const debt = decodeDebt({ label: path, text });
    if (debt === null || `${debt.finding}.json` !== name) {
      unread.push(name);
      continue;
    }
    debts.push(debt);
  }
  return { debts, unlisted: null, unread };
}

/**
 * Remove one owed finding, once the board holds its row.
 *
 * @param home the state home
 * @param finding the slug whose debt is paid
 * @returns nothing, or why it did not remove
 */
export function clearFindingDebt({
  home,
  finding,
}: {
  readonly home: string;
  readonly finding: string;
}): Result<void, RecipeFindingDebtError> {
  const path = join(findingDebtDir({ home }), `${finding}.json`);
  try {
    rmSync(path, { force: true });
    return ok(undefined);
  } catch (cause) {
    return err(RecipeErrors.findingDebtNotWritten({ detail: errorMessage({ error: cause }), path }));
  }
}
