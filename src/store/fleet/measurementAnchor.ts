/**
 * Reading an anchor that cites a measurement file as the key `measurement_location` is looked up by.
 *
 * Every path spelling canon uses resolves through `./homeAnchor.ts`, exactly as an owner-turn anchor does. A
 * bare 64-hex token is a body's own hash, so a reader holding only the hash — a pull-request body that
 * quoted it, a Storage object key — reaches the same bytes. A path outside the four roots is refused with
 * the reason rather than looked up and reported empty.
 */
import { err, ok, type Result } from "#lib/result.js";

import { type FleetImportError, FleetImportErrors } from "./errors.js";
import { anchorToken, homeRelativeOfToken } from "./homeAnchor.js";
import { measurementClassOf } from "./measurement.js";

/** What an anchor resolved to. */
export type MeasurementRef =
  /** One file, by its path under the home — every body ever recorded there. */
  | { readonly kind: "path"; readonly relativePath: string }
  /** One body, by its hash — every path it was found at. */
  | { readonly kind: "sha"; readonly bodySha256: string };

/** A body hash, as `measurement_blob.body_sha256` stores it. */
const SHA256_HEX = /^[0-9a-f]{64}$/u;

/**
 * Resolve an anchor, a home-relative path or a body hash.
 *
 * @param ref what the caller typed
 * @param home the state home an absolute path must sit under
 * @returns the path or hash to look up, or the refusal naming why the anchor cites no measurement
 */
export function resolveMeasurementRef({
  ref,
  home,
}: {
  ref: string;
  home: string;
}): Result<MeasurementRef, FleetImportError> {
  const token = anchorToken({ ref });
  if (token === undefined) {
    return err(
      FleetImportErrors.unstorableMeasurement({
        path: ref,
        reason: "the anchor names a transcript or other record, not a file",
      }),
    );
  }
  if (SHA256_HEX.test(token)) {
    return ok({ bodySha256: token, kind: "sha" });
  }
  const underHome = homeRelativeOfToken({ home, token });
  if (underHome === undefined) {
    return err(FleetImportErrors.unstorableMeasurement({ path: ref, reason: `it is outside the state home ${home}` }));
  }
  if (measurementClassOf({ relativePath: underHome }) === undefined) {
    return err(
      FleetImportErrors.unstorableMeasurement({
        path: ref,
        reason: "it is not a file under bakeoff/, datadog-shots/, evidence/ or proof/",
      }),
    );
  }
  return ok({ kind: "path", relativePath: underHome });
}
