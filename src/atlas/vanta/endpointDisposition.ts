/**
 * What this atlas does with one documented GET operation, decided as a pure function of the operation's own
 * path so `generated/getEndpoints.ts` can be regenerated and diffed rather than hand-maintained.
 *
 * ## Why a disposition per operation, rather than a list of the ones we call
 *
 * `inventory.ts` is the list of endpoints the sync CALLS. It cannot say anything about an endpoint nobody
 * thought of, so for as long as it was the only list, an unreached surface was an absence rather than a
 * gap — and an absence appears in no coverage report. The denominator is Vanta's own published document
 * (`generated/specLock.ts`), and this module is what turns each of its 107 GET operations into a claim a
 * reader can check.
 *
 * The point of {@link VANTA_ENDPOINT_DISPOSITIONS} being CLOSED is that there is no way to say nothing.
 * Every documented GET lands on exactly one of four claims, and one of them —
 * `not-fetched` — is refused by the `atlas-content-coverage` gate beyond its recorded debt.
 */

import { absentAsEmpty } from "#lib/absent.js";

/**
 * The four claims this atlas may make about a documented GET operation.
 *
 * - `synced` — called on every resync and its result stored. Carries the coverage surface that holds it.
 * - `covered-by-list` — a detail read whose response is the same object the collection read already stores,
 *   so calling it once per entity would fetch bytes this atlas already holds. Carries the collection's own
 *   path, because the claim is falsifiable only if a reader can go and compare the two.
 * - `entitlement-refused` — measured to answer 403 or 404 on this organisation's credential. A ceiling, not
 *   a decision, and it names the measurement.
 * @internal
 *
 * - `not-fetched` — nobody has been to get it. Refused by the gate: under the standing rule that
 *   an atlas missing coverage is unacceptable, so this is a debt with a number rather than a settled state.
 */
export const VANTA_ENDPOINT_DISPOSITIONS = ["synced", "covered-by-list", "entitlement-refused", "not-fetched"] as const;

export type VantaEndpointDisposition = (typeof VANTA_ENDPOINT_DISPOSITIONS)[number];

/**
 * The paths measured to be refused by this organisation's entitlement, with the measurement beside each.
 *
 * Both were established by calling them through `transport.ts` — see `descriptor.ts`, where the same two
 * are declared as the atlas's own `not-fetched` exclusion owed to the browser channel.
 */
const ENTITLEMENT_REFUSED: Readonly<Record<string, string>> = {
  "/contracts":
    "GET /v1/contracts answers HTTP 403 on this credential — contracts sit behind a separate entitlement this organisation does not hold",
  "/contracts/{contractId}": "the collection it reads one of answers HTTP 403 on this credential",
  "/vendors/{vendorId}/findings":
    "GET /v1/vendors/{vendorId}/findings answers HTTP 403 on this credential against a vendor this atlas holds, while every sibling sub-collection of the same vendor answers HTTP 200 — so this is one surface's own entitlement rather than a bound on the vendor. Measured by `yarn tsx tools/probeVantaGetEndpoints.ts`",
};

/**
 * The last path segment, so a detail operation can be recognised by its parameter.
 *
 * @param path the specification's own path template
 * @returns the final segment, or `null` for a path with none
 */
function lastSegment({ path }: { path: string }): string | null {
  const segments = path.split("/").filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    return null;
  }
  // Non-empty, checked just above, so the last index holds a segment.
  return segments[segments.length - 1]!;
}

/**
 * The collection path a detail path reads one member of, or `null` when the path is not a detail read.
 *
 * `/people/{personId}` yields `/people`; `/vendors/{vendorId}/findings` yields `null`, because it is not a
 * detail read of anything — it is a sub-collection with its own contents.
 *
 * @param path the specification's own path template
 * @returns the parent collection path, or `null`
 */
export function collectionPathFor({ path }: { path: string }): string | null {
  const segment = lastSegment({ path });
  if (segment === null || !segment.startsWith("{") || !segment.endsWith("}")) {
    return null;
  }
  const parent = path.slice(0, path.length - segment.length - 1);
  return parent.length > 0 ? parent : null;
}

/**
 * How a detail read's own 200 response compares to its collection's rows, read from the pinned document.
 *
 * `covered-by-list` is a CLAIM — "the detail response carries the same object the collection read already
 * stores" — and inferring it from the path's shape alone cannot see whether the
 * claim is true. MEASURED against Vanta's own document, the shape inference is false on two of the fifteen rows
 * carrying it: `GET /documents/{documentId}` answers six fields `/documents` does not
 * (`deactivatedStatus`, `nextRenewalDate`, `note`, `reminderWindow`, `renewalCadence`, `subscribers`) and
 * `GET /frameworks/{frameworkId}` answers `requirementCategories`, which `/frameworks` also does not. Both
 * were forgiven endpoints holding information nothing in this atlas held.
 *
 * So the generator computes this from the document and hands it in, and a detail read that adds a field is
 * `not-fetched` with the added fields named. Reproduce with
 * `yarn tsx tools/generateVantaEndpoints.ts --fetch`.
 */
export type VantaDetailAddedFields = ReadonlyMap<string, readonly string[]>;

/** One decided operation: the claim, and the words that make it falsifiable. */
export interface VantaEndpointVerdict {
  readonly disposition: VantaEndpointDisposition;
  readonly because: string;
}

/**
 * Decide what this atlas does with one documented GET operation.
 *
 * @param path the specification's own path template, relative to the `/v1` server
 * @param syncedPaths every path template the sync actually calls, in the same shape
 * @param detailAddedFields per detail path, the response fields its collection's rows do not carry
 * @returns the disposition and the reason a reader can check it against
 */
export function vantaEndpointVerdict({
  path,
  syncedPaths,
  detailAddedFields,
}: {
  path: string;
  syncedPaths: ReadonlySet<string>;
  detailAddedFields: VantaDetailAddedFields;
}): VantaEndpointVerdict {
  if (syncedPaths.has(path)) {
    return {
      because: "called on every resync and its result stored in this atlas's own kind file",
      disposition: "synced",
    };
  }
  const refused = ENTITLEMENT_REFUSED[path];
  if (refused !== undefined) {
    return { because: refused, disposition: "entitlement-refused" };
  }
  const collection = collectionPathFor({ path });
  if (collection !== null && syncedPaths.has(collection)) {
    const added = absentAsEmpty({ value: detailAddedFields.get(path) });
    if (added.length === 0) {
      return {
        because: `a detail read of one member of ${collection}, which this atlas walks exhaustively and stores whole — the detail response carries the same object`,
        disposition: "covered-by-list",
      };
    }
    return {
      because: `a detail read of one member of ${collection}, which this atlas walks whole — but its own response declares ${String(added.length)} field(s) the collection's rows do not carry (${added.join(", ")}), so what it returns is NOT already held. Measured from the pinned OpenAPI document`,
      disposition: "not-fetched",
    };
  }
  return {
    because:
      "nobody has been to get it: no surface in this atlas calls this operation, so nothing it returns is held locally",
    disposition: "not-fetched",
  };
}
