/**
 * The words and the shape checks the app session harness's two wires share: which vendor runs a session, where a
 * session is in its life, and the predicates every guard on either wire is built from. The session wire is
 * `sessionControlProtocol.ts` (the CLI's `appProtocol.ts`), the usage wire `usageWire.ts`.
 *
 * Written ONCE and copied byte for byte, exactly as the session wire is: `desktop/src/wireBasics.ts` is the canonical
 * copy and `src/sessionHarness/wireBasics.ts` the mirror the CLI imports.
 * `desktop/__tests__/unit/sessionControlProtocolMirror.test.ts` fails the moment the two differ. So this file imports
 * nothing.
 */

/**
 * Which vendor runs a session.
 * @internal to the CLI's copy: the desktop's copy of this mirrored file is its consumer
 */
export type AppHarnessVendor = "codex" | "claude";

/**
 * Where an app-hosted session is in its life, as its card shows it.
 * @internal to the CLI's copy: the desktop's copy of this mirrored file is its consumer
 */
export type AppSessionState = "starting" | "idle" | "running" | "stopping" | "closed" | "failed";

/** Every {@link AppSessionState}, which a guard checks a state read off the wire against. */
export const APP_SESSION_STATES: ReadonlySet<string> = new Set([
  "starting",
  "idle",
  "running",
  "stopping",
  "closed",
  "failed",
]);

/**
 * Whether a value is a plain object, neither null nor an array.
 *
 * @param value anything parsed off the wire
 * @returns true for an object a guard may read keys from
 */
export function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Whether every key named holds a string.
 *
 * @param value the object a guard is reading
 * @param keys the fields that must be strings
 * @returns true when none is missing or another type
 */
export function hasStrings({
  value,
  keys,
}: {
  value: Readonly<Record<string, unknown>>;
  keys: readonly string[];
}): boolean {
  return keys.every((key) => typeof value[key] === "string");
}

/**
 * Whether every key named is absent or holds a string.
 *
 * @param value the object a guard is reading
 * @param keys the optional fields that, when present, must be strings
 * @returns true when none holds another type
 */
export function hasOptionalStrings({
  value,
  keys,
}: {
  value: Readonly<Record<string, unknown>>;
  keys: readonly string[];
}): boolean {
  return keys.every((key) => value[key] === undefined || typeof value[key] === "string");
}

/**
 * Whether an object carries exactly the keys named, no fewer and no other: a vendor's arm never carries another's.
 *
 * @param value the object a guard is reading
 * @param keys every field the shape allows
 * @returns true when the object carries no field outside them
 */
export function hasOnlyKeys({
  value,
  keys,
}: {
  value: Readonly<Record<string, unknown>>;
  keys: readonly string[];
}): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}
