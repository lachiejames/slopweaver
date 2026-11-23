/**
 * Apply one `plans set-thresholds` change to the register. Pure — `./mutate.ts` calls it inside the same
 * compare-and-set every other register change goes through.
 *
 * ## It edits the RAW object, never the decoded one
 *
 * A register naming no threshold decodes every field to its default (`./thresholds.ts`), and that decoded value is
 * never written back. So this starts from what the document actually stores: it copies the addressed provider's raw
 * object, deletes each reset field, then writes each set one. An object a reset empties is removed, and so is the
 * top-level key once both are — resetting the last field restores true absence, so the next change to a default
 * reaches this install too.
 *
 * ## A change that changes nothing is refused
 *
 * Setting the value already stored, or resetting a field the register does not name, would still bump the revision,
 * and a journal of threshold changes should show only real ones — the same rule `set-usage-limit` keeps. The whole
 * document is then re-parsed, so an ordering the gates cannot honour refuses as `REGISTER_INVALID` exactly as a read
 * of the same document would.
 */
import { isRecord } from "#lib/parsers.js";
import { err, type Result } from "#lib/result.js";

import { type PlanRegisterError, PlanRegisterErrors } from "./errors.js";
import { republishRows } from "./register.js";
import { THRESHOLDS_KEY, type ThresholdMutation } from "./thresholds.js";
import type { PlanRegisterDocument, PlanRegisterSnapshot } from "./types.js";

/** One raw object, before anything is narrowed out of it. */
type RawObject = Readonly<Record<string, unknown>>;

/**
 * A raw object with some keys removed, every other key kept in its original order.
 *
 * @param keys the keys to drop
 * @param value the object to copy
 * @returns the copy
 */
function withoutKeys({ keys, value }: { keys: readonly string[]; value: RawObject }): RawObject {
  return Object.fromEntries(Object.entries(value).filter(([name]) => !keys.includes(name)));
}

/**
 * Why a change would change nothing, or undefined when it changes something.
 *
 * @param change the change being applied
 * @param stored the provider's raw object as the register holds it
 * @returns the conflict sentence, or undefined
 */
function noOpConflict({ change, stored }: { change: ThresholdMutation; stored: RawObject }): string | undefined {
  const sets = Object.entries(change.set);
  if (sets.length === 0 && change.reset.length === 0) {
    return "a threshold change must set or reset at least one field";
  }
  const unnamed = change.reset.filter((field) => stored[field] === undefined);
  if (unnamed.length > 0) {
    return `the register names no ${change.provider} ${unnamed.join(", ")}, so it is already at its default`;
  }
  const unchanged = sets.filter(([field, value]) => stored[field] === value).map(([field]) => field);
  if (unchanged.length > 0 && unchanged.length === sets.length && change.reset.length === 0) {
    return `the register already sets ${change.provider} ${unchanged.join(", ")} to that value`;
  }
  return undefined;
}

/**
 * The document with one provider's threshold object replaced, an empty object and an empty key both removed.
 *
 * @param document the register document as stored
 * @param provider which provider's object is replaced
 * @param next that provider's new raw object
 * @returns the document to re-parse
 */
function documentWith({
  document,
  next,
  provider,
}: {
  document: PlanRegisterDocument;
  next: RawObject;
  provider: ThresholdMutation["provider"];
}): PlanRegisterDocument {
  const all = document[THRESHOLDS_KEY];
  // An empty sibling object names no field, so it is dropped with the rest: absence is the only spelling of "all
  // default", and a sibling `{}` would otherwise keep an empty-in-effect key alive after the last real reset.
  const others = isRecord(all)
    ? Object.fromEntries(
        Object.entries(withoutKeys({ keys: [provider], value: all })).filter(
          ([, value]) => !isRecord(value) || Object.keys(value).length > 0,
        ),
      )
    : {};
  const thresholds = Object.keys(next).length === 0 ? others : { ...others, [provider]: next };
  const rest = withoutKeys({ keys: [THRESHOLDS_KEY], value: document });
  if (Object.keys(thresholds).length === 0) {
    return { ...rest, rows: document.rows, version: document.version };
  }
  return { ...rest, rows: document.rows, [THRESHOLDS_KEY]: thresholds, version: document.version };
}

/**
 * Apply one threshold change, re-validating the whole register afterwards.
 *
 * @param change which provider's fields are set and which are handed back to their defaults
 * @param snapshot the register as it currently stands
 * @returns the changed register, or why the change does not apply
 */
export function applyThresholdMutation({
  change,
  snapshot,
}: {
  change: ThresholdMutation;
  snapshot: PlanRegisterSnapshot;
}): Result<PlanRegisterSnapshot, PlanRegisterError> {
  const all = snapshot.document[THRESHOLDS_KEY];
  const raw = isRecord(all) ? all[change.provider] : undefined;
  const stored: RawObject = isRecord(raw) ? raw : {};
  const conflict = noOpConflict({ change, stored });
  if (conflict !== undefined) {
    return err(PlanRegisterErrors.mutationConflict({ conflict }));
  }
  const next = { ...withoutKeys({ keys: change.reset, value: stored }), ...change.set };
  const document = documentWith({ document: snapshot.document, next, provider: change.provider });
  return republishRows({ document, rows: document.rows });
}
