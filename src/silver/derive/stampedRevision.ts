/**
 * The identity-roster revision a freshness stamp records, read and printed. Split out of `./freshness.ts`, which
 * compares it: this module is only what one stamp's field CAN hold and how a reason names it.
 */

/**
 * A stamp's roster revision when the stamp does not WITNESS one: written before the roster moved into the store,
 * or carrying a value that is neither a positive integer nor an explicit `null`. Never equal to any observation.
 */
export const UNWITNESSED_REVISION = "unwitnessed";

/**
 * The roster revision derive consumed: a positive integer, `null` for an explicit "no row", or
 * {@link UNWITNESSED_REVISION}. The third value is what keeps a pre-store stamp from passing as "no row": its
 * derive may have consumed a non-empty retired `identity.json`, so equating its missing field with an observed
 * `null` would call a roster built from overrides that no longer exist fresh. It reads stale against EVERY
 * observation, so the first read after the move re-derives once.
 */
export type StampedRevision = number | null | typeof UNWITNESSED_REVISION;

/**
 * The roster revision a stamp records: a positive integer, an explicit JSON `null` (derive read no row), else
 * {@link UNWITNESSED_REVISION} — a missing key or a malformed value, never conflated with "no row".
 *
 * @param stamp the parsed stamp object, before any field is defaulted
 * @returns the revision the stamp witnessed, or that it witnessed none
 */
export function stampedRevision({ stamp }: { stamp: Readonly<Record<string, unknown>> }): StampedRevision {
  if (!Object.hasOwn(stamp, "overrideRevision")) {
    return UNWITNESSED_REVISION;
  }
  const raw = stamp["overrideRevision"];
  if (raw === null) {
    return null;
  }
  if (typeof raw === "number" && Number.isInteger(raw) && raw > 0) {
    return raw;
  }
  return UNWITNESSED_REVISION;
}

/**
 * A roster revision as a staleness reason prints it.
 *
 * @param revision a stamped or observed revision
 * @returns the label, naming the unwitnessed case rather than printing its sentinel
 */
export function revisionLabel({ revision }: { revision: StampedRevision }): string {
  if (revision === null) {
    return "(none)";
  }
  if (revision === UNWITNESSED_REVISION) {
    return "(unwitnessed: a stamp from before the roster moved into the store)";
  }
  return String(revision);
}
