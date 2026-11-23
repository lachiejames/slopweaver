/**
 * Outlook categories: the mailbox's master list, and turning `--add`/`--remove` into an ABSOLUTE category set
 * per message.
 *
 * A message carries its categories by DISPLAY NAME, and Graph's PATCH replaces the whole list, so a change is
 * planned as "this message's categories become exactly X" from the categories it carries now. That makes the
 * write a replay-safe absolute state rather than a relative edit, which is why the PATCH may retry.
 *
 * A name the master list does not hold is refused rather than written: Outlook would accept it and show an
 * uncoloured category nobody created, which is a typo made permanent.
 */
import { unsetFieldAsNull } from "#lib/absent.js";
import { err, ok, type Result } from "#lib/result.js";
import type { OutlookApi } from "./apiCore.js";
import { type OutlookError, OutlookErrors } from "./errors.js";

/** One master category. */
export interface OutlookCategory {
  readonly id: string;
  readonly displayName: string;
  readonly color: string | null;
}

/** A requested category change, resolved to display names. */
export interface CategoryChange {
  readonly add: readonly string[];
  readonly remove: readonly string[];
}

/**
 * The mailbox's master category list.
 *
 * @returns every category, or why the list could not be read
 */
export async function listOutlookCategories({
  api,
}: {
  api: OutlookApi;
}): Promise<Result<readonly OutlookCategory[], OutlookError>> {
  const listed = await api.listCategories();
  return listed.map((categories) =>
    categories.map((category) => ({
      color: unsetFieldAsNull({ key: "color", record: category }),
      displayName: category.displayName,
      id: category.id,
    })),
  );
}

/** Resolve one reference — an id, or a display name case-insensitively — to its display name. */
function resolveOne({
  master,
  reference,
}: {
  master: readonly OutlookCategory[];
  reference: string;
}): Result<string, OutlookError> {
  const byId = master.find((category) => category.id === reference);
  if (byId !== undefined) {
    return ok(byId.displayName);
  }
  const wanted = reference.toLowerCase();
  const byName = master.filter((category) => category.displayName.toLowerCase() === wanted);
  const [only] = byName;
  if (only !== undefined && byName.length === 1) {
    return ok(only.displayName);
  }
  return err(
    OutlookErrors.referenceUnresolved({
      candidates: byName.map((category) => `${category.displayName} (${category.id})`),
      kind: "category",
      reference,
    }),
  );
}

/**
 * Resolve `--add` and `--remove` references against the master list, refusing one that names nothing and a
 * category asked for in both directions.
 *
 * @param master the mailbox's master categories
 * @param add references to add
 * @param remove references to remove
 * @returns the change in display names, or the first refusal
 */
export function resolveCategoryChange({
  master,
  add,
  remove,
}: {
  master: readonly OutlookCategory[];
  add: readonly string[];
  remove: readonly string[];
}): Result<CategoryChange, OutlookError> {
  const resolve = ({ references }: { references: readonly string[] }): Result<readonly string[], OutlookError> => {
    const names: string[] = [];
    for (const reference of references) {
      const name = resolveOne({ master, reference });
      if (name.isErr()) {
        return err(name.error);
      }
      names.push(name.value);
    }
    return ok([...new Set(names)]);
  };
  const adding = resolve({ references: add });
  if (adding.isErr()) {
    return err(adding.error);
  }
  const removing = resolve({ references: remove });
  if (removing.isErr()) {
    return err(removing.error);
  }
  const both = adding.value.filter((name) => removing.value.includes(name));
  if (both.length > 0) {
    return err(OutlookErrors.categoryConflict({ names: both }));
  }
  return ok({ add: adding.value, remove: removing.value });
}

/**
 * The absolute category list one message should carry after a change: its current list, minus every removal,
 * plus every addition not already there, in a stable order.
 *
 * @param current what the message carries now
 * @param change the resolved change
 * @returns the list to PATCH, and whether it differs from `current`
 */
export function nextCategories({ current, change }: { current: readonly string[]; change: CategoryChange }): {
  readonly categories: readonly string[];
  readonly changed: boolean;
} {
  const kept = current.filter((name) => !change.remove.includes(name));
  const added = change.add.filter((name) => !kept.includes(name));
  const categories = [...kept, ...added];
  const changed = categories.length !== current.length || categories.some((name, index) => name !== current[index]);
  return { categories, changed };
}
