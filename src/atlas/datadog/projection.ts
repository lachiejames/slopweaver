/**
 * Datadog's own half of the storage boundary: the KIND-scoped denial, handed to the kit's walk.
 *
 * `kit/projection.ts` owns the walk, the pointer escaping, the depth bound and the drop report, and its
 * header carries the reasoning for all of it. What is Datadog's is the one judgement the kit cannot make:
 *
 * ## A Datadog denial is scoped to a KIND, and cannot be decided from a field name
 *
 * `sensitiveFields.ts` records the measurement. `key` is credential material on nine SDK models and a case
 * identifier, a feature-flag key or a tag key on the other forty; `token` is a share credential that
 * grants ANONYMOUS dashboard access under one kind and a pagination cursor under another. So the kind — read
 * off the surface row the document came through, fixed for the whole document — is closed over here and the
 * kit receives a plain function of the field name. A caller cannot project a Datadog document without
 * saying what it is a document OF, which is the point.
 */
import { type AtlasProjection, projectAtlasValue } from "../kit/projection.js";

import { datadogFieldDenial } from "./fieldDenial.js";
import type { DatadogKind } from "./model.js";

/**
 * Project one provider document, removing every denied field at any depth.
 *
 * @param kind the atlas kind this document belongs to — taken from the surface row it was read through,
 * never guessed, because it is what decides whether `key` here is an API key or a case identifier
 * @param value the provider's own JSON, exactly as the response carried it
 * @returns the storable value and every removal, sorted by pointer
 */
export function projectDatadogValue({ kind, value }: { kind: DatadogKind; value: unknown }): AtlasProjection {
  return projectAtlasValue({ denyField: ({ field }) => datadogFieldDenial({ field, kind }), value });
}
