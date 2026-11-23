/**
 * Which Google SecOps instance this install reads, and the one host that instance may be reached on.
 *
 * The instance is a per-install fact, so it resolves from `$SLOPWEAVER_HOME` (`GOOGLE_SECOPS_INSTANCE`, else
 * `secrets/google-secops-instance`) and never from a constant: an identifier, not a credential, but state
 * outside the codebase all the same. There is no default — Chronicle has no List-instances method a
 * `chronicle.readonly` grant can call, so a guessed instance would be a read of nothing that looks like one.
 *
 * The HOST is derived from the instance's own location and is never configurable on its own. The location
 * pattern admits only a region-shaped token, so it cannot steer the origin off `*-chronicle.googleapis.com`.
 */
import { tokenFromEnvOrHomeFile } from "../../config.js";
import { err, ok, type Result } from "../../lib/result.js";
import { type GoogleSecopsReadError, GoogleSecopsReadErrors } from "./errors.js";

/** One addressable Chronicle instance. */
export interface SecopsInstance {
  /** The full resource name, `projects/<p>/locations/<l>/instances/<uuid>`. */
  readonly name: string;
  /** The location segment, which picks the regional host. */
  readonly location: string;
  /** The only origin a request for this instance may go to. */
  readonly origin: string;
}

/**
 * A project id (6-30 chars, lowercase, starts with a letter) or a project number; a multi-region (`us`) or a
 * region (`australia-southeast1`); and a lowercase uuid.
 */
const INSTANCE_NAME =
  /^projects\/([a-z][a-z0-9-]{4,28}[a-z0-9]|[0-9]+)\/locations\/([a-z]+(?:-[a-z]+[0-9]+)?)\/instances\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

/**
 * Parse one configured instance value.
 *
 * @param value the raw configured line, already trimmed
 * @returns the instance and its derived origin, or `INSTANCE_MALFORMED`
 */
export function parseSecopsInstance({ value }: { value: string }): Result<SecopsInstance, GoogleSecopsReadError> {
  const matched = INSTANCE_NAME.exec(value);
  if (matched === null) {
    return err(GoogleSecopsReadErrors.instanceMalformed({ value }));
  }
  const location = matched[2]!;
  return ok({ location, name: value, origin: `https://${location}-chronicle.googleapis.com` });
}

/**
 * Resolve the configured instance for a home.
 *
 * @param home the state home whose `google-secops-instance` is read
 * @returns the instance, `INSTANCE_MISSING` when none is configured, or `INSTANCE_MALFORMED`
 */
export function resolveSecopsInstance({ home }: { home: string }): Result<SecopsInstance, GoogleSecopsReadError> {
  const value = tokenFromEnvOrHomeFile({
    envNames: ["GOOGLE_SECOPS_INSTANCE"],
    home,
    secretName: "google-secops-instance",
  });
  if (value === undefined) {
    return err(GoogleSecopsReadErrors.instanceMissing());
  }
  return parseSecopsInstance({ value });
}
