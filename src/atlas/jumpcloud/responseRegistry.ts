/**
 * Every JumpCloud surface a production read pages, mapped to the strict boundary its answer is admitted through,
 * and the one function a paging read admits each page with.
 *
 * The six generated batches (`generated/responseBoundaries*.ts`, from `tools/generateJumpcloudResponseBoundaries.ts`)
 * declare every JSON-answering surface; the two file-answering surfaces are decoded by `fileResponses.ts` and then
 * admitted through the boundary declared beside each decoder, so they are deliberately absent here. A unit test holds
 * this map plus that table EQUAL to `jumpcloudPagedSurfaceNames()`, so a surface the sync pages can never be left
 * without a boundary — and {@link admitJumpcloudPage} refuses one that somehow is, rather than reading it some other
 * way.
 */
import { err, type Result } from "#lib/result.js";

import { type JumpcloudReadError, JumpcloudReadErrors } from "./errors.js";
import { JUMPCLOUD_FILE_RESPONSES } from "./fileResponses.js";
import { JUMPCLOUD_RESPONSE_BOUNDARIES_1 } from "./generated/responseBoundaries1.js";
import { JUMPCLOUD_RESPONSE_BOUNDARIES_2 } from "./generated/responseBoundaries2.js";
import { JUMPCLOUD_RESPONSE_BOUNDARIES_3 } from "./generated/responseBoundaries3.js";
import { JUMPCLOUD_RESPONSE_BOUNDARIES_4 } from "./generated/responseBoundaries4.js";
import { JUMPCLOUD_RESPONSE_BOUNDARIES_5 } from "./generated/responseBoundaries5.js";
import { JUMPCLOUD_RESPONSE_BOUNDARIES_6 } from "./generated/responseBoundaries6.js";
import type { JumpcloudPage } from "./paging.js";
import type { JumpcloudPageBoundary } from "./responseBoundary.js";

/**
 * How a paging read admits one answered page. A walk takes it as a REQUIRED dependency, and every production
 * dependency builder passes {@link admitJumpcloudPage}: the walk's own tests exercise pagination, journalling and
 * publishing over an invented tenancy whose records no measured boundary admits, so they pass a carrier reader of
 * their own, while the tests of the real admission drive this module's function directly.
 */
export type JumpcloudAdmit = (input: {
  surface: string;
  text: string;
  headers: Readonly<Record<string, string>>;
}) => Result<JumpcloudPage, JumpcloudReadError>;

/** Every generated boundary, keyed by the surface it admits. */
export const JUMPCLOUD_RESPONSE_REGISTRY: ReadonlyMap<string, JumpcloudPageBoundary> = new Map(
  [
    ...JUMPCLOUD_RESPONSE_BOUNDARIES_1,
    ...JUMPCLOUD_RESPONSE_BOUNDARIES_2,
    ...JUMPCLOUD_RESPONSE_BOUNDARIES_3,
    ...JUMPCLOUD_RESPONSE_BOUNDARIES_4,
    ...JUMPCLOUD_RESPONSE_BOUNDARIES_5,
    ...JUMPCLOUD_RESPONSE_BOUNDARIES_6,
  ].map((boundary) => [boundary.surface, boundary]),
);

/**
 * Admit one answered page of a paged surface: a file surface through its decoder and then its boundary, every other
 * surface through its generated boundary.
 *
 * @param surface the registry surface that answered
 * @param text the 2xx body exactly as the provider sent it
 * @param headers the response headers, lowercased
 * @returns the admitted page, or the refusal naming what drifted — `UNEXPECTED_SHAPE` for a surface no boundary
 *   declares, which the registry test makes unreachable for anything the sync pages
 */
export function admitJumpcloudPage({
  surface,
  text,
  headers,
}: {
  surface: string;
  text: string;
  headers: Readonly<Record<string, string>>;
}): Result<JumpcloudPage, JumpcloudReadError> {
  const file = JUMPCLOUD_FILE_RESPONSES[surface];
  if (file !== undefined) {
    return file.decode({ surface, text }).andThen((value) => file.boundary.admitValue({ headers, value }));
  }
  const boundary = JUMPCLOUD_RESPONSE_REGISTRY.get(surface);
  if (boundary === undefined) {
    return err(
      JumpcloudReadErrors.unexpectedShape({
        detail: "no response boundary is declared for this surface, so nothing it answers is admitted",
        surface,
      }),
    );
  }
  return boundary.admit({ headers, text });
}
