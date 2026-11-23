/**
 * Which carrier one JumpCloud surface's generated boundary declares (`boundaryCodegen.ts` builds the record inside
 * it). A measured surface's carrier is the one every 2xx answer arrived in, and two carriers on one surface is
 * refused, never picked between: the boundary admits exactly one, and a guess is the defect the boundary retires. A
 * wrapped carrier is refused too when its envelope keys were measured as a kind its constructor does not declare. A
 * surface no answer measured takes its carrier from the published document instead.
 */
import { err, ok, type Result } from "#lib/result.js";

import type { ResponseJsonKind } from "../kit/responseStructure.js";

import { type JumpcloudCodegenError, JumpcloudCodegenErrors } from "./codegenErrors.js";
import type { JumpcloudSurfaceCensus } from "./responseCensus.js";

/** The carrier a generated boundary declares — `responseBoundary.ts`'s four constructors. */
export type JumpcloudDeclaredCarrier =
  | { readonly kind: "bare-array" }
  | { readonly kind: "wrapped"; readonly envelope: "results-total" | "results-only" }
  | { readonly kind: "single-object" }
  | { readonly kind: "empty" };

/**
 * The carrier one census envelope names, or the root kind when it names none. An empty and a filled bare array are
 * ONE carrier: the census tells them apart only to report what it saw, and a boundary that refused an empty page
 * would refuse the last page of every paged walk and every collection a tenant empties.
 */
function carrierOfEnvelope({ envelope }: { envelope: string }): JumpcloudDeclaredCarrier | string {
  if (envelope === "bare-array" || envelope === "bare-array-empty") {
    return { kind: "bare-array" };
  }
  if (envelope === "empty-text") {
    return { kind: "empty" };
  }
  if (envelope === "object{results,totalCount}") {
    return { envelope: "results-total", kind: "wrapped" };
  }
  if (envelope === "object{results}") {
    return { envelope: "results-only", kind: "wrapped" };
  }
  if (envelope.startsWith("object{")) {
    return { kind: "single-object" };
  }
  return envelope;
}

/** A carrier's one-line name, the identity two measured carriers are compared by. */
function carrierName({ carrier }: { carrier: JumpcloudDeclaredCarrier }): string {
  return carrier.kind === "wrapped" ? `wrapped ${carrier.envelope}` : carrier.kind;
}

/**
 * The one carrier every 2xx answer a surface gave arrived in.
 *
 * @param surface the registry surface, named in every refusal
 * @param stat the surface's census
 * @returns the carrier; `null` when no 2xx answer was measured; or why the measurement declares none — a non-JSON
 *   2xx answer among them, since the census keeps no envelope for one and would otherwise read as unmeasured
 */
export function jumpcloudCarrierFromCensus({
  surface,
  stat,
}: {
  surface: string;
  stat: JumpcloudSurfaceCensus;
}): Result<JumpcloudDeclaredCarrier | null, JumpcloudCodegenError> {
  if (stat.nonJson > 0) {
    return err(JumpcloudCodegenErrors.nonJsonAnswer({ count: stat.nonJson, surface }));
  }
  const carriers = new Map<string, JumpcloudDeclaredCarrier>();
  for (const envelope of Object.keys(stat.envelopes)) {
    const carrier = carrierOfEnvelope({ envelope });
    if (typeof carrier === "string") {
      return err(JumpcloudCodegenErrors.unsupportedRoot({ root: carrier, surface }));
    }
    carriers.set(carrierName({ carrier }), carrier);
  }
  const measured = [...carriers.values()];
  if (measured.length > 1) {
    return err(JumpcloudCodegenErrors.mixedCarrier({ carriers: [...carriers.keys()].toSorted(), surface }));
  }
  const [only] = measured;
  if (only === undefined) {
    return ok(null);
  }
  return envelopeKindsHold({ carrier: only, stat, surface }).map(() => only);
}

/**
 * Refuse a wrapped carrier whose envelope keys were measured as any kind but the one its constructor declares, since
 * the boundary would otherwise refuse the very answers it was generated from.
 */
function envelopeKindsHold({
  carrier,
  stat,
  surface,
}: {
  carrier: JumpcloudDeclaredCarrier;
  stat: JumpcloudSurfaceCensus;
  surface: string;
}): Result<null, JumpcloudCodegenError> {
  if (carrier.kind !== "wrapped") {
    return ok(null);
  }
  const declared: readonly (readonly [string, ResponseJsonKind])[] =
    carrier.envelope === "results-total"
      ? [
          ["results", "array"],
          ["totalCount", "number"],
        ]
      : [["results", "array"]];
  for (const [key, kind] of declared) {
    const measured = Object.keys(stat.paths[key]!.kinds).toSorted();
    if (measured.length !== 1 || measured[0] !== kind) {
      return err(JumpcloudCodegenErrors.envelopeKind({ declared: kind, key, measured, surface }));
    }
  }
  return ok(null);
}

/** A published response schema, already `$ref`-resolved by the caller at each level it hands in. */
interface SpecSchema {
  readonly type?: unknown;
  readonly properties?: unknown;
  readonly items?: unknown;
}

/**
 * The carrier the published document declares for a surface no answer measured.
 *
 * @param surface the registry surface, named in a refusal
 * @param schema the success response's JSON schema with its top-level `$ref` resolved, or `null` for a response
 * that declares no content
 * @param results the `results` property's schema with its `$ref` resolved, when the response declares one
 * @returns the carrier, or why the document declares none this layer has
 */
export function jumpcloudCarrierFromSpec({
  surface,
  schema,
  results,
}: {
  surface: string;
  schema: SpecSchema | null;
  results: SpecSchema | null;
}): Result<JumpcloudDeclaredCarrier, JumpcloudCodegenError> {
  if (schema === null) {
    return ok({ kind: "empty" });
  }
  if (schema.type === "array") {
    return ok({ kind: "bare-array" });
  }
  const properties = schema.properties;
  const isObject = schema.type === "object" || (typeof properties === "object" && properties !== null);
  if (!isObject) {
    return err(JumpcloudCodegenErrors.unreadableSpec({ surface, why: `a ${String(schema.type)} response` }));
  }
  if (results?.type === "array") {
    const declared = typeof properties === "object" && properties !== null ? Object.keys(properties) : [];
    return ok({ envelope: declared.includes("totalCount") ? "results-total" : "results-only", kind: "wrapped" });
  }
  return ok({ kind: "single-object" });
}
