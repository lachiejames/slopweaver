/**
 * Which required rows the store still holds exactly as an earlier build wrote them — the one present state
 * the declaration (`./declaredStandingRows.ts`) may judge besides absence.
 *
 * A stored row equal to a {@link StandingRow.supersedes} entry was written by `register-standing` and never
 * touched, so bringing it forward overrides nobody. Without that, a changed declaration never reaches an
 * install already holding the old row: `worktree-prune` stayed `0 4 * * *` on the install its hourly
 * declaration was written for. Anything else present — paused, held by the owner, hand-edited — stays
 * somebody's deliberate act and is never reported here; a FAILURE hold the store placed is set aside and carried
 * forward ({@link splitStoreOverlay}).
 *
 * **Judged per FILE, never per id.** The store can hold one recipe id in two files, or under another file's
 * name (`./definitionStore.ts`'s `definitionFiles` says why that roster keeps every name). A supersession is
 * therefore clean only when the id stands in exactly one file, named `<recipeId>.json`, holding the earlier
 * shape. Any other arrangement with an earlier shape in it is AMBIGUOUS: reported with every file it stands
 * in, and never written, because rewriting the canonical file while a daily copy sits beside it would report
 * the same supersession on every pass and never converge.
 *
 * Pure: the roster in, a verdict out.
 */
import { isDeepStrictEqual } from "node:util";

import { isRecord } from "../../lib/parsers.js";
import { safeJsonParse, safeJsonStringify } from "../../lib/safeJson.js";
import type { RecipeDefinition } from "./definition.js";
import { failureFindingSlug, failureHoldReason } from "./failureHold.js";
import type { StandingRow } from "./standingRow.js";

/**
 * Whether two definitions say the same thing as JSON — the form the store holds them in.
 *
 * Structural equality alone is wrong here: the definition parser hands back an absent optional field as a
 * key holding `undefined` (`hold`, `channelApprovals`), which a strict deep-equal counts as a difference
 * from a declaration that never names the key. Both sides are compared after one JSON round trip, which
 * drops exactly those keys and nothing else a row can carry.
 *
 * @param stored a row as the store handed it back, or as its file parses
 * @param declared a declared definition
 * @returns whether they serialise to the same row
 */
export function sameStoredRow({ stored, declared }: { readonly stored: unknown; readonly declared: unknown }): boolean {
  const asStored = ({ value }: { readonly value: unknown }): unknown =>
    safeJsonParse({ label: "standing row", text: safeJsonStringify({ label: "standing row", value }) });
  return isDeepStrictEqual(asStored({ value: stored }), asStored({ value: declared }));
}

/**
 * A stored row split into what an earlier build DECLARED and the one overlay the STORE itself may have added since.
 *
 * A failure hold (`hold.finding` set) is placed by `automation run-due` when a firing fails, never by a person, so
 * it does not make the row somebody's edit — and a row that failed BECAUSE its declaration was wrong is exactly the
 * row a corrected declaration must reach. MEASURED: the fleet ceiling row was held on its finding for the
 * very Slack destination this build removes, and an exact comparison would have left it held on the old shape for
 * good. The hold is carried onto the brought-forward row, so it still stands until its finding settles. An owner
 * hold (no `finding`) is the owner's word, and a row carrying one is never split here.
 *
 * @param stored a row as its file parses
 * @returns the declared part to compare, and the failure hold to carry forward when there is one
 */
export function splitStoreOverlay({ stored }: { readonly stored: unknown }): {
  readonly declared: unknown;
  readonly failureHold: unknown;
} {
  if (!isRecord(stored)) {
    return { declared: stored, failureHold: undefined };
  }
  const { hold, ...declared } = stored;
  if (!isStoreFailureHold({ hold, recipeId: stored["recipeId"] })) {
    return { declared: stored, failureHold: undefined };
  }
  return { declared, failureHold: hold };
}

/** The keys `./failureHoldStore.ts`'s `placeFailureHold` writes, and nothing else. */
const STORE_FAILURE_HOLD_KEYS = ["askedIso", "clearedBy", "finding", "reason"] as const;

/**
 * The shape `failureHoldReason` writes, its parts captured: recipe, slot, attempt, what failed, finding. Anchored at
 * both ends, and `what` is the one free part, so a reason matching this and rebuilt from its own parts byte for byte
 * is the store's template and nothing else. An attempt is 1-based (`./slotAttempt.ts`), so `0` is not one the store
 * writes.
 */
const STORE_FAILURE_REASON =
  /^held by the store: (.+)'s (\S+) firing failed on attempt ([1-9]\d*) \((.*)\); a row that fails once is paused until its fix lands, never fired again to fail the same way — the fix is board row (\S+)$/su;

/**
 * Whether a string is an instant exactly as `Date#toISOString` spells it — the only spelling the store writes for a
 * slot or an `askedIso`. `failureFindingSlug` lowercases the slot, so without this a `z` for a `Z` would derive the
 * same finding and pass as the store's.
 */
function isCanonicalInstant({ text }: { readonly text: string }): boolean {
  const parsed = Date.parse(text);
  return !Number.isNaN(parsed) && new Date(parsed).toISOString() === text;
}

/**
 * Whether a `hold` is exactly the one the store places on a failed firing — four keys, never cleared, and a finding
 * and reason that are the store's own derivations for THIS row (`./failureHold.ts`'s `failureFindingSlug` and
 * `failureHoldReason`). Any other key, a `clearedBy` a person set, or a finding or reason that is not what the store would
 * have written for this recipe is somebody's edit, so the row is not the build's own write and is not set aside
 * (a `manualNote` inside a failure hold, or an edited `reason`, is such an edit).
 *
 * The residue, stated: the parenthesised `what` inside the reason is free text the store took from the failure, so
 * an edit confined to it, keeping the template, is indistinguishable from the store's write; so is an `askedIso`
 * moved to another valid instant, or a slot and attempt the template admits but this row's cadence and retry budget
 * never produced. The file carries no provenance for any of them: this is a check of the store's TEMPLATE, never a
 * replay of the store's history.
 */
function isStoreFailureHold({ hold, recipeId }: { readonly hold: unknown; readonly recipeId: unknown }): boolean {
  if (!isRecord(hold) || typeof recipeId !== "string") {
    return false;
  }
  // A parsed hold may carry an optional key as `undefined`, which no file holds and so no edit wrote.
  const keys = Object.keys(hold)
    .filter((key) => hold[key] !== undefined)
    .toSorted();
  const { askedIso, clearedBy, finding, reason } = hold;
  const shaped =
    keys.length === STORE_FAILURE_HOLD_KEYS.length &&
    STORE_FAILURE_HOLD_KEYS.every((key, index) => keys[index] === key) &&
    typeof askedIso === "string" &&
    isCanonicalInstant({ text: askedIso }) &&
    clearedBy === null &&
    typeof finding === "string" &&
    typeof reason === "string";
  if (!shaped) {
    return false;
  }
  const parts = STORE_FAILURE_REASON.exec(reason);
  if (parts === null) {
    return false;
  }
  const [, reasonRecipe, slotIso, attemptText, what, reasonFinding] = parts;
  const attempt = Number(attemptText!);
  return (
    reasonRecipe === recipeId &&
    reasonFinding === finding &&
    isCanonicalInstant({ text: slotIso! }) &&
    failureFindingSlug({ attempt, recipeId, slotIso: slotIso! }) === finding &&
    failureHoldReason({ attempt, finding, recipeId, slotIso: slotIso!, what: what! }) === reason
  );
}

/**
 * Whether a stored row is one of a declaration's earlier shapes, once any failure hold the store placed is set aside.
 *
 * @param stored a row as the store handed it back, or as its file parses
 * @param supersedes the earlier shapes a build declared
 * @returns whether the row is exactly one of them apart from a failure hold
 */
export function holdsEarlierShape({
  stored,
  supersedes,
}: {
  readonly stored: unknown;
  readonly supersedes: readonly RecipeDefinition[];
}): boolean {
  const { declared } = splitStoreOverlay({ stored });
  return supersedes.some((shape) => sameStoredRow({ declared: shape, stored: declared }));
}

/** One required row the store still holds as an earlier build wrote it. */
export interface StandingRowSupersession {
  readonly recipeId: string;
  /** The cadence the earlier row runs on. */
  readonly storedCadence: string;
  /** The cadence this build declares. */
  readonly declaredCadence: string;
  /**
   * Every file holding this recipe id, when that is anything but the one canonical file — the row is then
   * ambiguous and left alone. Empty for a clean supersession.
   */
  readonly ambiguousFiles: readonly string[];
}

/**
 * Which required rows the store holds in a shape an earlier build declared and nobody has edited since.
 *
 * @param declared the rows this build requires
 * @param existing every row the store parsed
 * @param files the file each entry of `existing` was read from, index-aligned — the roster's `definitionFiles`
 * @returns one entry per required row with an earlier shape anywhere in the store, ordered by recipe id
 */
export function supersededStandingRows({
  declared,
  existing,
  files,
}: {
  readonly declared: readonly StandingRow[];
  readonly existing: readonly RecipeDefinition[];
  readonly files: readonly string[];
}): readonly StandingRowSupersession[] {
  return declared
    .flatMap((row) => {
      const { supersedes = [] } = row;
      const recipeId = row.definition.recipeId;
      const copies = existing.flatMap((definition, index) =>
        definition.recipeId === recipeId ? [{ definition, file: files[index]! }] : [],
      );
      const earlier = copies.find((copy) => holdsEarlierShape({ stored: copy.definition, supersedes }));
      if (earlier === undefined) {
        return [];
      }
      const clean = copies.length === 1 && earlier.file === `${recipeId}.json`;
      return [
        {
          ambiguousFiles: clean ? [] : copies.map((copy) => copy.file),
          declaredCadence: row.definition.cadence,
          recipeId,
          storedCadence: earlier.definition.cadence,
        },
      ];
    })
    .toSorted((left, right) => left.recipeId.localeCompare(right.recipeId));
}

/**
 * The line `automation due` prints for one row still standing in a superseded shape.
 *
 * @param supersession the row an earlier build wrote
 * @returns the line to print
 */
export function supersededStandingRowLine({
  supersession,
}: {
  readonly supersession: StandingRowSupersession;
}): string {
  // A row can move on its argv alone, and "on `x` where this build declares `x`" names no difference at all.
  const difference =
    supersession.storedCadence === supersession.declaredCadence
      ? `on the same cadence, \`${supersession.declaredCadence}\`, in a shape this build has replaced`
      : `on \`${supersession.storedCadence}\` where this build declares \`${supersession.declaredCadence}\``;
  const head = `!! ${supersession.recipeId} · SUPERSEDED — the store still holds an earlier build's row, untouched, ${difference}. `;
  if (supersession.ambiguousFiles.length > 0) {
    return (
      `${head}It stands in ${supersession.ambiguousFiles.join(", ")}, so \`slopweaver automation register-standing\` ` +
      `leaves it: remove every copy but \`${supersession.recipeId}.json\`, then run it`
    );
  }
  return `${head}Bring it forward with \`slopweaver automation register-standing\``;
}
