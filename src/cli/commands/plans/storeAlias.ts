/**
 * The one duplicate a register decode cannot see: two rows whose store paths differ as written but resolve to the
 * same directory on disk, through a symlink or a case-insensitive filesystem.
 *
 * `src/plans/structure.ts` refuses a duplicate store LEXICALLY, on purpose, because decoding the register is pure.
 * A usage cap is per row, so two rows over one store let the uncapped row spend the account past the capped row's
 * ceiling (a Codex review of `plans add --percent` built exactly that with `/tmp/codex-link -> /tmp/codex-real`).
 * `plans add` and `plans set-store-dir` are the two places a store path enters a row, so the filesystem check sits
 * here, in the verbs' shell.
 *
 * The check reads the register before the write does, so the verb pins its write to the revision it judged
 * (`PlanRegisterWrite.judgedAtRevision`): a second change landing in between moves the revision, and the first
 * refuses as `REGISTER_REVISION_CONFLICT` rather than committing past a judgement that no longer holds.
 */
import { err, ok, type Result } from "#lib/result.js";

import type { PlanRegisterError } from "../../../plans/errors.js";
import type { PlanMutation, PlanRegisterSnapshot, RegisteredPlan } from "../../../plans/types.js";

/**
 * The identity of the directory a store path names on disk — its device and inode in production, so every spelling
 * of one directory answers the same — `undefined` when nothing is there to resolve.
 */
export type ResolveStore = (input: { readonly storeDir: string }) => string | undefined;

/**
 * The already-registered row of the same provider whose store is the same directory as the one being added.
 *
 * A store that does not resolve (absent on disk) has no filesystem identity to share, so it matches nothing; a row
 * with the added row's own alias is the register's alias check to refuse, not this one.
 *
 * @param added the row `plans add` is about to write
 * @param plans the rows the register holds now
 * @param resolve the filesystem's answer for a path, injected so a test needs no symlink
 * @returns the row that already names that directory, or `undefined` when none does
 */
export function aliasedStore({
  added,
  plans,
  resolve,
}: {
  added: RegisteredPlan;
  plans: readonly RegisteredPlan[];
  resolve: ResolveStore;
}): RegisteredPlan | undefined {
  const own = resolve({ storeDir: added.storeDir });
  if (own === undefined) {
    return undefined;
  }
  return plans.find(
    (plan) =>
      plan.provider === added.provider && plan.alias !== added.alias && resolve({ storeDir: plan.storeDir }) === own,
  );
}

/** The two changes that put a store path on a row, and so the two this check judges. */
type StorePathMutation = Extract<PlanMutation, { kind: "add" | "set-store-dir" }>;

/**
 * The refusal printed when {@link aliasedStore} found a row.
 *
 * @param added the row as it would have been written
 * @param existing the row already naming that directory
 * @param kind which change was refused, so the line says what did not happen
 * @returns the one diagnostic line
 */
function aliasedStoreRefusal({
  added,
  existing,
  kind,
}: {
  added: RegisteredPlan;
  existing: RegisteredPlan;
  kind: StorePathMutation["kind"];
}): string {
  const outcome = kind === "add" ? "no row was added" : `\`${added.alias}\` was not moved`;
  return (
    `plans: ${added.storeDir} is the same directory as the ${existing.provider} plan \`${existing.alias}\`'s store ` +
    `${existing.storeDir}, so ${outcome} — two rows over one sign-in would let one spend past the other's ` +
    `usage limit. Change that plan's limit with \`plans set-usage-limit --provider ${existing.provider} --plan ${existing.alias}\` instead`
  );
}

/**
 * The row as the change would leave it: `add`'s row, or the named row at the path `set-store-dir` moves it to —
 * `undefined` when no row carries that alias, which the register's own write refuses as an unknown destination.
 *
 * @param mutation the change about to be written
 * @param plans the rows the register holds now
 * @returns the row to judge, or `undefined`
 */
function rowAfter({
  mutation,
  plans,
}: {
  mutation: StorePathMutation;
  plans: readonly RegisteredPlan[];
}): RegisteredPlan | undefined {
  if (mutation.kind === "add") {
    return mutation.row;
  }
  const target = plans.find((plan) => plan.provider === mutation.provider && plan.alias === mutation.alias);
  if (target === undefined) {
    return undefined;
  }
  return { ...target, storeDir: mutation.storeDir };
}

/**
 * Judge a change that puts a store path on a row against the register read just before it: refused when that read
 * failed or a row already names the same directory through another spelling, else the revision judged, which the
 * write is pinned to so the judgement still holds at commit. A path absent on disk resolves to nothing and passes,
 * so a move may be registered before its folder is copied.
 *
 * @param mutation the `add` or `set-store-dir` about to be written
 * @param read the register as the verb read it
 * @param resolve the filesystem's answer for a path
 * @returns the revision the check judged, or the diagnostic line
 */
function aliasCheck({
  mutation,
  read,
  resolve,
}: {
  mutation: StorePathMutation;
  read: Result<PlanRegisterSnapshot, PlanRegisterError>;
  resolve: ResolveStore;
}): Result<number | null, string> {
  if (read.isErr()) {
    return err(`plans: ${read.error.message}`);
  }
  const added = rowAfter({ mutation, plans: read.value.plans });
  if (added === undefined) {
    return ok(read.value.revision);
  }
  const existing = aliasedStore({ added, plans: read.value.plans, resolve });
  if (existing !== undefined) {
    return err(aliasedStoreRefusal({ added, existing, kind: mutation.kind }));
  }
  return ok(read.value.revision);
}

/**
 * The revision a change that puts a store path on a row was judged at, so its write is pinned to it — `undefined`
 * for every other change, which needs no filesystem check, reads nothing and pins nothing.
 *
 * @param mutation the single change about to be published
 * @param read reads the register as it stands, called only for a change this check judges
 * @param resolve the filesystem's answer for a path
 * @returns the revision to pin, or the diagnostic line when the check refused
 */
export async function judgedRevision({
  mutation,
  read,
  resolve,
}: {
  mutation: PlanMutation;
  read: () => Promise<Result<PlanRegisterSnapshot, PlanRegisterError>>;
  resolve: ResolveStore;
}): Promise<Result<number | null | undefined, string>> {
  if (mutation.kind !== "add" && mutation.kind !== "set-store-dir") {
    return ok(undefined);
  }
  return aliasCheck({ mutation, read: await read(), resolve });
}
