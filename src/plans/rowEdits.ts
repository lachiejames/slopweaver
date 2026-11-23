/**
 * The register's row-shaped edits that take something AWAY — a whole row, its pin, its lapse — and the owner's own
 * correction of a row's address or store path. Pure, like `./mutate.ts`, which dispatches here once it has resolved
 * the target.
 *
 * These exist because a register with only additive verbs is a corner: a plan dropped, a pin on the last Claude plan,
 * a lapse recorded by mistake and a Claude address typed wrong each had no way back: every register change has a verb.
 */

import { isDeepStrictEqual } from "node:util";
import { err, ok, type Result } from "#lib/result.js";

import { type PlanRegisterError, PlanRegisterErrors } from "./errors.js";
import { republishRows } from "./register.js";
import { removedAliasConflict, removedPlans, withRemoved } from "./removed.js";
import type {
  PlanMutation,
  PlanProvider,
  PlanRegisterDocument,
  PlanRegisterSnapshot,
  RegisteredPlan,
} from "./types.js";

/** One stored row, before this version has narrowed anything out of it. */
type RawRow = Readonly<Record<string, unknown>>;

/** The mutations this module applies. */
type RowEdit = Extract<PlanMutation, { kind: "clear-lapse" | "remove" | "set-email" | "set-store-dir" | "unpin" }>;

/** The kinds {@link applyRowEdit} applies, so a caller can route to it without restating them. */
const ROW_EDIT_KINDS: ReadonlySet<PlanMutation["kind"]> = new Set([
  "clear-lapse",
  "remove",
  "set-email",
  "set-store-dir",
  "unpin",
]);

/**
 * Whether a mutation is one of this module's.
 *
 * @param mutation the requested change
 * @returns whether {@link applyRowEdit} applies it
 */
export function isRowEdit(mutation: PlanMutation): mutation is RowEdit {
  return ROW_EDIT_KINDS.has(mutation.kind);
}

/**
 * Whether one raw row is the row a mutation names.
 *
 * @param row the raw row under consideration
 * @returns whether its provider and alias both match
 */
export function rowMatches({ alias, provider, row }: { alias: string; provider: PlanProvider; row: RawRow }): boolean {
  return row["provider"] === provider && row["alias"] === alias;
}

/**
 * Drop one key from a raw row without disturbing the others.
 *
 * @param key the field to remove
 * @param row the raw row to copy
 * @returns a copy carrying every other field, in its original order
 */
export function withoutKey({ key, row }: { key: string; row: RawRow }): RawRow {
  return Object.fromEntries(Object.entries(row).filter(([name]) => name !== key));
}

/**
 * The removal history with one alias's entry dropped.
 *
 * @param document the register document
 * @param provider the provider whose alias is dropped
 * @param alias the alias dropped
 * @returns every other removal, in recorded order
 */
function removedExcept({
  alias,
  document,
  provider,
}: {
  alias: string;
  document: PlanRegisterDocument;
  provider: PlanProvider;
}): ReturnType<typeof removedPlans> {
  return removedPlans({ document }).filter((prior) => !(prior.provider === provider && prior.alias === alias));
}

/**
 * Take one destination off the register, every other row kept byte for byte and in order, and remember its alias and
 * store so the alias can only ever come back at that store (`./removed.ts`).
 *
 * Nothing about the row is a reason to refuse: a pinned Claude row leaves the publisher seat routing like any other
 * (`../claude/seatPinning.ts`), a paused one was already out of the fleet, and a provider's last row leaves a register
 * with none, which every reader already takes as a valid, empty provider. The store directory is never touched — its
 * sign-in is the provider CLI's.
 *
 * @param mutation the removal being applied
 * @param snapshot the register as it currently stands
 * @param target the row the mutation names, already resolved
 * @returns the register without that row
 */
function applyRemove({
  mutation,
  snapshot,
  target,
}: {
  mutation: Extract<PlanMutation, { kind: "remove" }>;
  snapshot: PlanRegisterSnapshot;
  target: RegisteredPlan;
}): Result<PlanRegisterSnapshot, PlanRegisterError> {
  const entry = {
    alias: target.alias,
    provider: target.provider,
    removedAtIso: mutation.removedAtIso,
    storeDir: target.storeDir,
  };
  const earlier = removedExcept({ alias: target.alias, document: snapshot.document, provider: target.provider });
  return republishRows({
    document: withRemoved({ document: snapshot.document, entries: [...earlier, entry] }),
    rows: snapshot.document.rows.filter(
      (row) => !rowMatches({ alias: mutation.alias, provider: mutation.provider, row }),
    ),
  });
}

/**
 * The document an add publishes from: refused when the alias was removed while naming another store, and with the
 * alias's removal forgotten when it comes back at its own.
 *
 * @param row the destination being registered
 * @param snapshot the register as it currently stands
 * @returns the document to append the row to, or the refusal
 */
export function documentForAdd({
  row,
  snapshot,
}: {
  row: RegisteredPlan;
  snapshot: PlanRegisterSnapshot;
}): Result<PlanRegisterDocument, PlanRegisterError> {
  const conflict = removedAliasConflict({
    alias: row.alias,
    document: snapshot.document,
    provider: row.provider,
    storeDir: row.storeDir,
  });
  if (conflict !== undefined) {
    return err(PlanRegisterErrors.mutationConflict({ conflict }));
  }
  const kept = removedExcept({ alias: row.alias, document: snapshot.document, provider: row.provider });
  return ok(withRemoved({ document: snapshot.document, entries: kept }));
}

/**
 * Republish the register with one key edited on the named row and every other row untouched. An edit that leaves
 * the row exactly as it was is refused rather than committed: whole rows are compared, never one field, so no edit
 * kind has to ask a question of its own key.
 *
 * @param alias the row's alias
 * @param provider the row's provider
 * @param snapshot the register as it currently stands
 * @param edit what the named row becomes
 * @returns the changed register, or a conflict naming an edit that changes nothing
 */
function editRow({
  alias,
  edit,
  provider,
  snapshot,
}: {
  alias: string;
  edit: (row: RawRow) => RawRow;
  provider: PlanProvider;
  snapshot: PlanRegisterSnapshot;
}): Result<PlanRegisterSnapshot, PlanRegisterError> {
  const rows = snapshot.document.rows.map((row) => (rowMatches({ alias, provider, row }) ? edit(row) : row));
  if (isDeepStrictEqual(rows, snapshot.document.rows)) {
    return err(
      PlanRegisterErrors.mutationConflict({ conflict: `\`${alias}\` already reads that way, so nothing changes` }),
    );
  }
  return republishRows({ document: snapshot.document, rows });
}

/**
 * Take the pin off one row without putting it anywhere else. No pinned row is a valid register: the publisher seat
 * then routes like every other (`../claude/seatPinning.ts`), and it is what lets the LAST Claude plan be paused.
 *
 * @param mutation the unpin being applied
 * @param snapshot the register as it currently stands
 * @param target the row the mutation names, already resolved
 * @returns the changed register, or why there is no pin to take
 */
function applyUnpin({
  mutation,
  snapshot,
  target,
}: {
  mutation: Extract<PlanMutation, { kind: "unpin" }>;
  snapshot: PlanRegisterSnapshot;
  target: RegisteredPlan;
}): Result<PlanRegisterSnapshot, PlanRegisterError> {
  if (target.pinned !== true) {
    return err(
      PlanRegisterErrors.mutationConflict({ conflict: `\`${target.alias}\` is not pinned, so nothing unpins` }),
    );
  }
  return editRow({
    alias: mutation.alias,
    edit: (row) => withoutKey({ key: "pinned", row }),
    provider: mutation.provider,
    snapshot,
  });
}

/**
 * Forget the lapse recorded on one row, so it reads `lapse UNRECORDED` again.
 *
 * @param mutation the clear being applied
 * @param snapshot the register as it currently stands
 * @param target the row the mutation names, already resolved
 * @returns the changed register, or why there is no lapse to clear
 */
function applyClearLapse({
  mutation,
  snapshot,
  target,
}: {
  mutation: Extract<PlanMutation, { kind: "clear-lapse" }>;
  snapshot: PlanRegisterSnapshot;
  target: RegisteredPlan;
}): Result<PlanRegisterSnapshot, PlanRegisterError> {
  if (target.lapsesAtIso === undefined) {
    return err(
      PlanRegisterErrors.mutationConflict({ conflict: `\`${target.alias}\` has no lapse recorded, so nothing clears` }),
    );
  }
  return editRow({
    alias: mutation.alias,
    edit: (row) => withoutKey({ key: "lapsesAtIso", row }),
    provider: mutation.provider,
    snapshot,
  });
}

/**
 * Record the address the owner says one row's account is called. The register's own decode refuses an address with
 * no `@` or a line break, and {@link editRow} refuses the address a row already carries by comparing whole rows.
 * Comparing the two addresses here would ask which account an address names, the question
 * `claude-email-not-identity` keeps off the register's display cache.
 *
 * @param mutation the address being recorded
 * @param snapshot the register as it currently stands
 * @returns the changed register, or why the register refuses it
 */
function applySetEmail({
  mutation,
  snapshot,
}: {
  mutation: Extract<PlanMutation, { kind: "set-email" }>;
  snapshot: PlanRegisterSnapshot;
}): Result<PlanRegisterSnapshot, PlanRegisterError> {
  return editRow({
    alias: mutation.alias,
    edit: (row) => ({ ...row, email: mutation.email }),
    provider: mutation.provider,
    snapshot,
  });
}

/**
 * Re-home one row at a new store path, every other key and row kept. The alias, and everything keyed on it, stays:
 * this is the same account moved, never a way to give an alias to another account. A Codex row's `email` was
 * recorded off its old directory (`record-email`), so it goes when the path changes and `sync-accounts` reads it
 * again; a Claude row's is the owner's own word for the account, and stays. The same path is {@link editRow}'s
 * no-op refusal, so it clears nothing; a store another row already names is the register's republish to refuse.
 *
 * @param mutation the move being applied
 * @param snapshot the register as it currently stands
 * @returns the changed register, or why the register refuses it
 */
function applySetStoreDir({
  mutation,
  snapshot,
}: {
  mutation: Extract<PlanMutation, { kind: "set-store-dir" }>;
  snapshot: PlanRegisterSnapshot;
}): Result<PlanRegisterSnapshot, PlanRegisterError> {
  return editRow({
    alias: mutation.alias,
    edit: (row) => {
      const moved = { ...row, storeDir: mutation.storeDir };
      if (mutation.provider === "codex" && row["storeDir"] !== mutation.storeDir) {
        return withoutKey({ key: "email", row: moved });
      }
      return moved;
    },
    provider: mutation.provider,
    snapshot,
  });
}

/**
 * Apply one of this module's edits to the row `./mutate.ts` already resolved.
 *
 * @param mutation the edit being applied
 * @param snapshot the register as it currently stands
 * @param target the row the mutation names
 * @returns the changed register, or why the edit does not apply
 */
export function applyRowEdit({
  mutation,
  snapshot,
  target,
}: {
  mutation: RowEdit;
  snapshot: PlanRegisterSnapshot;
  target: RegisteredPlan;
}): Result<PlanRegisterSnapshot, PlanRegisterError> {
  switch (mutation.kind) {
    case "remove":
      return applyRemove({ mutation, snapshot, target });
    case "unpin":
      return applyUnpin({ mutation, snapshot, target });
    case "clear-lapse":
      return applyClearLapse({ mutation, snapshot, target });
    case "set-email":
      return applySetEmail({ mutation, snapshot });
    case "set-store-dir":
      return applySetStoreDir({ mutation, snapshot });
    default: {
      const unhandled: never = mutation;
      return unhandled;
    }
  }
}
