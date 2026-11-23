/**
 * Which session harness a verb runs against: `--harness cmux` (the default, and every verb's behaviour before stage
 * 2) or `--harness app` (the desktop app's control plane). Chosen by the caller, never inferred — an app that is not
 * serving is a refusal naming the app, never a quiet fall back to cmux, because the two put a session in different
 * places on the owner's screen.
 */
import { err, ok, type Result } from "#lib/result.js";
import { withAppSessionHarness } from "./appHarness.js";
import { withSessionHarness } from "./cmuxHarness.js";
import type { SessionHarness } from "./sessionHarness.js";

/** The harnesses a verb can be pointed at. */
const HARNESS_NAMES = ["cmux", "app"] as const;

/** One harness's name. */
export type HarnessName = (typeof HARNESS_NAMES)[number];

/**
 * Read `--harness`.
 *
 * @param value the flag's value, `undefined` when it was not given
 * @returns the harness, `cmux` when none was named, or the refusal of an unknown name
 */
export function parseHarnessFlag({ value }: { value: string | undefined }): Result<HarnessName, string> {
  if (value === undefined) {
    return ok("cmux");
  }
  const named = HARNESS_NAMES.find((name) => name === value);
  if (named === undefined) {
    return err(`--harness must be one of ${HARNESS_NAMES.join(", ")}, not "${value}"`);
  }
  return ok(named);
}

/**
 * Whether a handle names an app-hosted session, so a verb given one without `--harness app` can say so.
 *
 * @param handle the handle a caller passed
 * @returns true for an `app:` handle
 */
export function isAppHandle({ handle }: { handle: string }): boolean {
  return handle.startsWith("app:");
}

/**
 * Run one body against the named harness.
 *
 * @param name which harness
 * @param body what to do with it
 * @returns whatever `body` returned
 */
export async function withNamedSessionHarness<T>({
  name,
  body,
}: {
  name: HarnessName;
  body: (options: { harness: SessionHarness }) => Promise<T>;
}): Promise<T> {
  if (name === "app") {
    return withAppSessionHarness({ body });
  }
  return withSessionHarness({ body });
}
