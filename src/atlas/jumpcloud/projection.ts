/**
 * JumpCloud's own half of the storage boundary: the field denial, handed to the kit's walk.
 *
 * `kit/projection.ts` owns the walk, the pointer escaping, the depth bound and the drop report, and its
 * header carries the reasoning for all of it — including why this file no longer holds a copy of that walk.
 * What is JumpCloud's is the denial itself, and `sensitiveFields.ts` is the whole judgement. It is decided
 * from the field name for all but one field: `services.path` is a Windows service's COMMAND LINE while
 * every other `path` in the inventory is a filesystem path, so the bound ENDPOINT is closed over here and
 * the kit still receives a plain function of the name. A caller cannot project a JumpCloud document without
 * saying which call returned it, which is the point.
 */
import { type AtlasProjection, projectAtlasValue } from "../kit/projection.js";

import { jumpcloudFieldDenial } from "./sensitiveFields.js";

/**
 * Project one provider document, removing every denied field at any depth.
 *
 * @param endpoint the bound path this document came through, taken from the call that returned it and
 * never guessed. `undefined` says it could not be established, and every endpoint-scoped denial then
 * applies rather than none
 * @param value the provider's own JSON, exactly as the response carried it
 * @returns the storable value and every removal, sorted by pointer
 */
export function projectJumpcloudValue({
  endpoint,
  value,
}: {
  endpoint: string | undefined;
  value: unknown;
}): AtlasProjection {
  return projectAtlasValue({
    denyField: ({ field, record }) => jumpcloudFieldDenial({ endpoint, field, record }),
    value,
  });
}
