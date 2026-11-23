/**
 * What a first-party read does with a page its strict boundary has answered: a refusal becomes this atlas's own
 * typed error, and an admission is held as the census view, never the answer itself.
 */
import type { BoundaryError } from "#lib/boundary.js";
import { isRecord } from "#lib/parsers.js";

import { type TrelicaAtlasError, TrelicaAtlasErrors } from "./errors.js";
import type { TrelicaBoundary } from "./trelicaBoundary.js";

/**
 * The list at one key of a census view. A view is the census of a value its boundary just admitted, so the list is
 * always there; anything else yields nothing, failing closed rather than carrying an unviewed value on.
 *
 * @param view a census view, as {@link TrelicaBoundary.censusView} answers it
 * @returns the list held under `key`
 */
export function trelicaViewList({ view, key }: { view: unknown; key: string }): readonly unknown[] {
  if (!isRecord(view)) {
    return [];
  }
  const list = view[key];
  return Array.isArray(list) ? list : [];
}

/**
 * A boundary's refusal as this atlas's own: a body that is not JSON carries nothing of itself, a drift names its keys.
 *
 * @param callId the inventory's own id for the call, never a URL carrying a tenant label
 * @returns the typed refusal the call reports
 */
export function trelicaBoundaryRefusal({ callId, error }: { callId: string; error: BoundaryError }): TrelicaAtlasError {
  if (error.code === "BOUNDARY_NOT_JSON") {
    return TrelicaAtlasErrors.bodyUnparseable({ callId });
  }
  return TrelicaAtlasErrors.bodyShapeChanged({ callId, drift: error.drift });
}
