/**
 * The Canva scope table and every census the registry is checked against.
 *
 * Split out of `tools/generateCanvaSurfaces.ts` so the generator stays under the file-size cap; the scope
 * extraction and the registry checks live here, and the pin check, the row walk and the output stay there.
 */
import { canvaJudgedPosts } from "../src/atlas/canva/effects.js";
import {
  CANVA_EFFECT_CENSUS,
  CANVA_ENTITLEMENT_CENSUS,
  CANVA_OPERATION_CENSUS,
  CANVA_SCOPE_CENSUS,
  CANVA_STABILITY_CENSUS,
} from "../src/atlas/canva/generated/specLock.js";
import { CANVA_OPERATION_KINDS, canvaKindForScope, canvaProviderId } from "../src/atlas/canva/surfaceNaming.js";
import type { CanvaSurfaceRow } from "../src/atlas/canva/surfaceRow.js";
import { isRecord, type LoadedSpec } from "./canvaSurfacesRows.js";

/** One OAuth scope the document declares, and the kind it governs. */
export interface CanvaScopeRow {
  /** The kind this scope governs — `surfaceNaming.ts`'s `canvaKindForScope` decides it. */
  readonly kind: string;
  /** Every operation that names it, sorted. Empty for a scope the call surface never uses. */
  readonly namedBy: readonly string[];
  /** The vendor's own scope string. */
  readonly scope: string;
}

/**
 * Every scope the document declares, filed under the kind it governs.
 *
 * Scopes are atlas content in their own right rather than a field on an operation, because the GRANT
 * surface is strictly wider than the CALL surface: MEASURED, the document declares 18 and its operations
 * between them name 16. A scope nothing calls is a capability the platform can be granted and this atlas
 * has no operation for, which is exactly the class of thing an atlas exists to reveal — so it gets a row
 * carrying an empty `namedBy` rather than being dropped for having no caller.
 *
 * @param rows the extracted registry, which says which scopes are actually named
 * @param spec the loaded document, whose security scheme declares them all
 * @returns one row per declared scope, sorted by scope
 */
export function scopeRows({
  rows,
  spec,
}: {
  rows: readonly CanvaSurfaceRow[];
  spec: LoadedSpec;
}): readonly CanvaScopeRow[] {
  const components = spec.json["components"];
  const schemes = isRecord(components) ? components["securitySchemes"] : null;
  const oauth = isRecord(schemes) ? schemes["oauthAuthCode"] : null;
  const flows = isRecord(oauth) ? oauth["flows"] : null;
  const authorizationCode = isRecord(flows) ? flows["authorizationCode"] : null;
  const declared = isRecord(authorizationCode) ? authorizationCode["scopes"] : null;
  if (!isRecord(declared)) {
    throw new Error("the oauthAuthCode scheme declares no authorizationCode scopes");
  }
  return Object.keys(declared)
    .toSorted()
    .map((scope) => ({
      kind: canvaKindForScope({ scope }),
      namedBy: rows
        .filter((row) => row.scopes.includes(scope))
        .map((row) => row.name)
        .toSorted(),
      scope,
    }));
}

/**
 * Check the whole registry against every census and invariant that does not need the vendor's bytes.
 *
 * This is what `--verify` runs on its own, so it must be able to fail on the things a bad EDIT does: a row
 * changing effect, stability or entitlement, a duplicated name, a kind nobody declared.
 *
 * @param rows the registry to check
 * @param scopes the scope table to check
 */
export function verifyRegistry({
  rows,
  scopes,
}: {
  rows: readonly CanvaSurfaceRow[];
  scopes: readonly CanvaScopeRow[];
}): void {
  if (rows.length !== CANVA_OPERATION_CENSUS) {
    throw new Error(`census: ${rows.length} operations, specLock says ${CANVA_OPERATION_CENSUS}`);
  }
  const names = new Set(rows.map((row) => row.name));
  if (names.size !== rows.length) {
    throw new Error(`census: ${rows.length} rows but ${names.size} distinct operation ids — a name collides`);
  }
  const providerIds = new Set(rows.map((row) => canvaProviderId({ method: row.method, path: row.path })));
  if (providerIds.size !== rows.length) {
    throw new Error(`census: ${rows.length} rows but ${providerIds.size} distinct provider keys`);
  }
  assertCensus({ census: CANVA_EFFECT_CENSUS, field: "effect", rows });
  assertCensus({ census: CANVA_STABILITY_CENSUS, field: "stability", rows });
  assertCensus({ census: CANVA_ENTITLEMENT_CENSUS, field: "entitlement", rows });
  for (const row of rows) {
    if (!CANVA_OPERATION_KINDS.some((kind) => kind === row.kind)) {
      throw new Error(`${row.name}: names kind ${row.kind}, which surfaceNaming does not declare`);
    }
    if (row.effect === "read" && row.effectBecause !== null) {
      throw new Error(`${row.name}: a read row carries an effectBecause`);
    }
    if (row.effect !== "read" && row.effectBecause === null) {
      throw new Error(`${row.name}: a ${row.effect} row names no reason`);
    }
    if ((row.entitlement === "none") !== (row.entitlementBecause === null)) {
      throw new Error(`${row.name}: its entitlement and its reason disagree about whether one exists`);
    }
  }
  const judged = new Set(canvaJudgedPosts());
  const posts = rows.filter((row) => row.method === "POST").map((row) => row.name);
  const unjudged = posts.filter((name) => !judged.has(name));
  if (unjudged.length > 0) {
    throw new Error(`effects.ts judges no POST named ${unjudged.toSorted().join(", ")}`);
  }
  if (judged.size !== posts.length) {
    throw new Error(`effects.ts judges ${judged.size} POSTs and the registry holds ${posts.length}`);
  }
  if (scopes.length !== CANVA_SCOPE_CENSUS.declared) {
    throw new Error(`scope census: ${scopes.length} declared, specLock says ${CANVA_SCOPE_CENSUS.declared}`);
  }
  const named = scopes.filter((scope) => scope.namedBy.length > 0).length;
  if (named !== CANVA_SCOPE_CENSUS.named) {
    throw new Error(`scope census: ${named} named by an operation, specLock says ${CANVA_SCOPE_CENSUS.named}`);
  }
}

/**
 * Assert one per-value census over one closed field of the registry.
 *
 * @param census the pinned counts, keyed by the field's own values
 * @param field which row field to count
 * @param rows the registry to count over
 */
function assertCensus({
  census,
  field,
  rows,
}: {
  census: Readonly<Record<string, number>>;
  field: "effect" | "stability" | "entitlement";
  rows: readonly CanvaSurfaceRow[];
}): void {
  for (const [value, expected] of Object.entries(census)) {
    const counted = rows.filter((row) => row[field] === value).length;
    if (counted !== expected) {
      throw new Error(`${field} census: ${counted} ${value} rows, specLock says ${expected}`);
    }
  }
}
