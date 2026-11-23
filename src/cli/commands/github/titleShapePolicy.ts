/**
 * The effectful read of which repositories' pull-request titles are judged, and by which shape — the half
 * `../../../outbound/github/titleShape.ts` takes as a value.
 *
 * Two reads, both synchronous so the policy sits beside the hygiene denylist every PR-write caller already loads:
 * this build's own repository, derived from its checkout's `origin` exactly as the organisation derives it
 * (`../../../organisation/read.ts`), and the install's own `github.titleShapes` from `profile.json`. Neither
 * defaults: an unresolvable self repository or a corrupt profile refuses the write rather than judging no title,
 * while a profile that names no shapes is an install with none, and judges only this build's own titles.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import type { OrganisationError } from "../../../organisation/errors.js";
import { resolveSelfRepository } from "../../../organisation/read.js";
import type { TitleShapePolicy } from "../../../outbound/github/titleShape.js";
import { type ProfileReadError, readProfile } from "../../../profileStore.js";

/** Why the policy could not be read: either reader's own typed error, forwarded rather than re-worded. */
export type TitleShapePolicyError = OrganisationError | ProfileReadError;

/**
 * Read the title-shape policy a pull-request write is judged under.
 *
 * @param home the Slopweaver home whose profile and declared checkouts are read
 * @returns the policy, or the reader's own refusal
 */
export function loadTitleShapePolicy({ home }: { home: string }): Result<TitleShapePolicy, TitleShapePolicyError> {
  const self = resolveSelfRepository({ home });
  if (self.isErr()) {
    return err(self.error);
  }
  const profile = readProfile({ home });
  if (profile.isErr()) {
    return err(profile.error);
  }
  if (profile.value === null) {
    return ok({ repositoryShapes: {}, selfRepository: self.value });
  }
  return ok({ repositoryShapes: profile.value.github.titleShapes, selfRepository: self.value });
}
