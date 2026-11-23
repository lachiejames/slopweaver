/**
 * The registry-wide census and invariant checks `tools/generateGoogleAdminSurfaces.ts` runs, both on freshly
 * extracted rows and (via `--verify`) on the committed table. Split out so the generator stays under the
 * file-size cap; every check throws on a violation and nothing here reaches the network or the filesystem.
 */
import {
  googleAdminNonGetReads,
  googleAdminObservationalKinds,
  googleAdminObservationalOperations,
} from "../src/atlas/googleAdmin/dispositions.js";
import {
  GOOGLE_ADMIN_DISCOVERY_PINS,
  GOOGLE_ADMIN_DISPOSITION_CENSUS,
  GOOGLE_ADMIN_DISTINCT_METHOD_IDS,
  GOOGLE_ADMIN_EXCLUSION_CENSUS,
  GOOGLE_ADMIN_METHOD_CENSUS,
  GOOGLE_ADMIN_SCOPELESS_CENSUS,
} from "../src/atlas/googleAdmin/generated/discoveryLock.js";
import { googleAdminProviderId } from "../src/atlas/googleAdmin/surfaceNaming.js";
import type { GoogleAdminSurfaceRow } from "../src/atlas/googleAdmin/surfaceRow.js";

/**
 * Check the whole registry against every census and invariant that does not need Google's bytes.
 *
 * This is what `--verify` runs on its own, so it must be able to fail on the things a bad EDIT does: a row
 * changing disposition, a duplicated name, a kind nobody declared, an observational rule left unused.
 *
 * @param rows the registry to check
 */
export function verifyRegistry({ rows }: { rows: readonly GoogleAdminSurfaceRow[] }): void {
  if (rows.length !== GOOGLE_ADMIN_METHOD_CENSUS) {
    throw new Error(`census: ${rows.length} methods, discoveryLock says ${GOOGLE_ADMIN_METHOD_CENSUS}`);
  }
  const names = new Set(rows.map((row) => row.name));
  if (names.size !== rows.length) {
    throw new Error(`census: ${rows.length} rows but ${names.size} distinct names — a name collides`);
  }
  const providerIds = new Set(rows.map((row) => googleAdminProviderId({ document: row.document, id: row.id })));
  if (providerIds.size !== rows.length) {
    throw new Error(`census: ${rows.length} rows but ${providerIds.size} distinct provider keys`);
  }
  const ids = new Set(rows.map((row) => row.id));
  if (ids.size !== GOOGLE_ADMIN_DISTINCT_METHOD_IDS) {
    throw new Error(`census: ${ids.size} distinct ids, discoveryLock says ${GOOGLE_ADMIN_DISTINCT_METHOD_IDS}`);
  }
  const scopeless = rows.filter((row) => row.scopes.length === 0).length;
  if (scopeless !== GOOGLE_ADMIN_SCOPELESS_CENSUS) {
    throw new Error(`census: ${scopeless} scopeless methods, discoveryLock says ${GOOGLE_ADMIN_SCOPELESS_CENSUS}`);
  }
  for (const pin of GOOGLE_ADMIN_DISCOVERY_PINS) {
    const declared = rows.filter((row) => row.document === pin.document).length;
    if (declared !== pin.methods) {
      throw new Error(`${pin.document}: ${declared} methods extracted, pin says ${pin.methods}`);
    }
  }
  for (const [disposition, expected] of Object.entries(GOOGLE_ADMIN_DISPOSITION_CENSUS)) {
    const counted = rows.filter((row) => row.disposition === disposition).length;
    if (counted !== expected) {
      throw new Error(`disposition census: ${counted} ${disposition} rows, discoveryLock says ${expected}`);
    }
  }
  for (const [reason, expected] of Object.entries(GOOGLE_ADMIN_EXCLUSION_CENSUS)) {
    const counted = rows.filter((row) => row.exclusionReason === reason).length;
    if (counted !== expected) {
      throw new Error(`exclusion census: ${counted} ${reason} rows, discoveryLock says ${expected}`);
    }
  }
  verifyRules({ rows });
}

/**
 * Check that every rule `dispositions.ts` states still names something in the registry.
 *
 * A rule naming nothing is a rule that has gone stale — the id was renamed, or the kind was — and it fails
 * SILENTLY by simply never matching, which is the shape of staleness a census cannot see.
 *
 * @param rows the registry to check
 */
function verifyRules({ rows }: { rows: readonly GoogleAdminSurfaceRow[] }): void {
  const kinds = new Set(rows.map((row) => row.kind));
  for (const kind of googleAdminObservationalKinds()) {
    if (!kinds.has(kind)) {
      throw new Error(`observational kind ${kind} names nothing in the registry — dispositions.ts is stale`);
    }
  }
  const ids = new Set(rows.map((row) => row.id));
  for (const id of [...googleAdminObservationalOperations(), ...googleAdminNonGetReads()]) {
    if (!ids.has(id)) {
      throw new Error(`dispositions.ts names ${id}, which the registry does not hold — the rule is stale`);
    }
  }
  for (const row of rows) {
    if (row.disposition !== "excluded" && row.exclusionReason !== null) {
      throw new Error(`${row.name}: a non-excluded row carries an exclusionReason`);
    }
    if (row.disposition === "excluded" && row.exclusionReason === null) {
      throw new Error(`${row.name}: an excluded row names no reason`);
    }
    if (row.disposition === "shape-index" && row.dispositionBecause === null) {
      throw new Error(`${row.name}: a shape-indexed row explains nothing`);
    }
  }
}
