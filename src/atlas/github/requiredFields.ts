/**
 * The response fields GitHub's own description declares REQUIRED on a record this atlas stores, refused at the
 * read rather than substituted in the projection.
 *
 * `@octokit/openapi-types` (pinned by `yarn.lock`) types both ruleset listings — `repos/get-org-rulesets` and
 * `repos/get-repo-rulesets` — as `components["schemas"]["repository-ruleset"][]`, and that schema declares
 * `enforcement` with no `?`: every ruleset GitHub returns says whether it is `active`, `evaluate` or
 * `disabled`. A listing whose record lacks it is not a ruleset with an unknown enforcement; it is a 200 this
 * atlas cannot read, so the whole call fails as `UNUSABLE_RESPONSE` — a coverage cell and a gap a reader sees,
 * with the rulesets already stored left exactly as they were — rather than storing a word GitHub never sent.
 *
 * The same description types `issues/list-labels-for-repo` as `components["schemas"]["label"][]`, whose `name`
 * and `color` carry no `?` either: a label is addressed by its name and reproduced by its colour, so one
 * without either is equally a response this atlas cannot read.
 */
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";

import type { GithubReadOutcome } from "./client.js";
import { type GithubAtlasError, GithubAtlasErrors } from "./errors.js";
import type { GithubCall } from "./inventoryShape.js";
import type { GithubKind } from "./model.js";
import { str } from "./projectionBase.js";

/** Each kind's required string fields, in the order a refusal names the first one missing. */
const REQUIRED_FIELDS: Readonly<Partial<Record<GithubKind, readonly string[]>>> = {
  "repository-label": ["name", "color"],
  ruleset: ["enforcement"],
};

/**
 * Refuse a read whose records omit a field GitHub declares required for the call's kind.
 *
 * A listing entry that is not an object at all is refused too, never left to the projection: it carries none
 * of the required fields, and the projection would drop it silently, so a listing of `[null]` would publish
 * as zero records measured rather than as a response this atlas cannot read.
 *
 * @param call the admitted call the read answered, whose kind names what its records must carry
 * @param route the concrete route, which the refusal names
 * @param read what the call returned
 * @returns the read unchanged, or `UNUSABLE_RESPONSE` naming the record and the field it omitted
 */
export function refuseMissingRequiredFields({
  call,
  route,
  read,
}: {
  call: GithubCall;
  route: string;
  read: GithubReadOutcome;
}): Result<GithubReadOutcome, GithubAtlasError> {
  const fields = REQUIRED_FIELDS[call.kind];
  if (fields === undefined) {
    return ok(read);
  }
  for (const [index, raw] of read.records.entries()) {
    if (!isRecord(raw)) {
      return err(
        GithubAtlasErrors.unusableResponse({
          reason: `${call.kind} record ${String(index)} is not an object`,
          route,
        }),
      );
    }
    const absent = fields.find((key) => str({ key, raw }) === null);
    if (absent !== undefined) {
      return err(
        GithubAtlasErrors.unusableResponse({
          reason: `${call.kind} record ${String(index)} omitted the required field ${absent}`,
          route,
        }),
      );
    }
  }
  return ok(read);
}
