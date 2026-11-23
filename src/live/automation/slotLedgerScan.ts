/**
 * Reads across the WHOLE slot ledger for one row — every firing it has, rather than the one firing
 * `./slotLedger.ts` reads, judges and writes under its lock.
 *
 * Split from the ledger along that seam: nothing here takes the lock or writes, and every caller is on a
 * release or seated path, never a tick. A scan that found a row is evidence to act on under the ledger's
 * own compare-and-set, never a verdict.
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";

import { readFileIfPresent } from "../../atlas/atlasFile.js";
import { safeJsonParse } from "../../lib/safeJson.js";
import { stateHomePaths } from "../../stateHome.js";
import type { RecipeSlotAttempt } from "./slotAttempt.js";
import { attemptOf } from "./slotAttemptCodec.js";

/**
 * The OPEN attempt on one row, whichever firing it belongs to — what a release has to find.
 *
 * A release names a ROW, because that is the surface every caller has; the attempt it is releasing belongs
 * to a FIRING, and the two come apart exactly when it matters. A run claimed for the 12:00 firing that
 * finishes at 13:00:05 is being released while the row's currently-due firing is 13:00, so deriving the
 * firing from the clock would look up an attempt that does not exist and release nothing — silently, which
 * is the failure this whole ledger exists to remove. Measured against exactly that case.
 *
 * It is a SCAN of the ledger rather than an index, and the trade is stated rather than hidden: an index
 * would be a second file that can disagree with the first, which is the two-mechanism defect one layer
 * down. The scan reads one small file per firing and runs only on the release path — a hand-typed
 * `automation claim --release` and a seat whose session never opened — never on a tick.
 *
 * **The ledger grows with time and nothing prunes it yet.** That is a real follow-up rather than an
 * oversight: a settled row is readable evidence of one firing and there is no rule yet for when it stops
 * being worth keeping. Until there is, this scan's cost grows with the number of firings the install has
 * ever had.
 *
 * @param home the state home the ledger lives under
 * @param recipeId the row being asked about
 * @returns the open attempt, or `null` when this row has none
 */
export function findOpenSlotAttempt({
  home,
  recipeId,
}: {
  readonly home: string;
  readonly recipeId: string;
}): RecipeSlotAttempt | null {
  return firstOpenAttempt({ home, matches: () => true, recipeId });
}

/**
 * The OPEN attempt one TOKEN holds on a row, whichever firing it belongs to — what a seated run has to find
 * when the firing its token was minted for is no longer the one the row is due for.
 *
 * `automation seat` takes the row's due firing and hands its token to the session it opens, and the attempt's
 * lease is the row's own next firing (`./definitionClaim.ts` says why no other expiry is allowed). MEASURED:
 * a seat just before a firing boundary took `resync-corpus-fathom`'s previous firing with a lease ending at that
 * boundary — 114 seconds — and the session it opened ran the row a minute after the boundary, by which time the
 * row was due for the next firing and nothing held THAT firing. Looking the due firing up found no row and nothing ran. The token is the
 * thing the session actually has, so this looks the attempt up by it: a never-started one is what
 * `cli/commands/automation/runDue.ts#carrySeatForward` gives back before taking the firing the row is due for.
 *
 * The same scan as {@link findOpenSlotAttempt}, with the same stated trade, and it runs only on the seated
 * path after the due firing's own row has already refused — at most once per seated row, never on a tick.
 *
 * @param home the state home the ledger lives under
 * @param recipeId the row being asked about
 * @param holderToken the token the seat minted for the session asking
 * @returns the open attempt that token holds, or `null` when no open attempt on this row carries it
 */
export function findAttemptHeldBy({
  home,
  recipeId,
  holderToken,
}: {
  readonly home: string;
  readonly recipeId: string;
  readonly holderToken: string;
}): RecipeSlotAttempt | null {
  return firstOpenAttempt({ home, matches: (attempt) => attempt.holderToken === holderToken, recipeId });
}

/** The first OPEN attempt on one row that `matches`, in the ledger directory's own order. */
function firstOpenAttempt({
  home,
  matches,
  recipeId,
}: {
  home: string;
  matches: (attempt: RecipeSlotAttempt) => boolean;
  recipeId: string;
}): RecipeSlotAttempt | null {
  const directory = stateHomePaths({ home }).live.recipe.slotAttemptsDir;
  let names: readonly string[] = [];
  try {
    names = readdirSync(directory).filter((name) => name.endsWith(".json"));
  } catch {
    return null;
  }
  for (const name of names) {
    const raw = readFileIfPresent({ path: join(directory, name) });
    if (raw.isErr() || raw.value === null) {
      continue;
    }
    let decoded: unknown;
    try {
      decoded = safeJsonParse({ label: name, text: raw.value });
    } catch {
      continue;
    }
    const parsed = attemptOf({ value: decoded });
    if (parsed?.recipeId === recipeId && parsed.outcome === null && matches(parsed)) {
      return parsed;
    }
  }
  return null;
}
