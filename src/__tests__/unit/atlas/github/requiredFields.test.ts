/**
 * The read-boundary refusal of a ruleset listing whose record omits `enforcement`, which GitHub's own
 * description declares required on every `repository-ruleset`, and of a label listing whose record omits
 * the `name` or `color` its `label` schema requires.
 */
import { describe, expect, it } from "vitest";

import type { GithubReadOutcome } from "../../../../atlas/github/client.js";
import { GithubAtlasErrors } from "../../../../atlas/github/errors.js";
import { githubCallById } from "../../../../atlas/github/inventory.js";
import { refuseMissingRequiredFields } from "../../../../atlas/github/requiredFields.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const ROUTE = "/orgs/required-fields-org/rulesets";
const RULESETS = githubCallById({ id: "org-rulesets" });
const WEBHOOKS = githubCallById({ id: "org-webhooks" });
const LABELS = githubCallById({ id: "repo-labels" });
const LABEL_ROUTE = "/repos/required-fields-org/label-repo/labels";

/** A finished one-page read of the given records. */
function readOf({ records }: { records: readonly unknown[] }): GithubReadOutcome {
  return { pagesExhausted: true, records, reportedTotal: null };
}

describe("refuseMissingRequiredFields", () => {
  it("accepts a ruleset response carrying required enforcement", () => {
    const read = readOf({ records: [{ enforcement: "evaluate", id: 31, name: "required-fields-ruleset" }] });
    expect(unwrap(refuseMissingRequiredFields({ call: RULESETS, read, route: ROUTE }))).toBe(read);
  });

  it("refuses a ruleset response missing required enforcement", () => {
    const read = readOf({
      records: [
        { enforcement: "active", id: 31, name: "first-ruleset" },
        { id: 32, name: "unenforced-ruleset" },
      ],
    });
    const refused = unwrapErr(refuseMissingRequiredFields({ call: RULESETS, read, route: ROUTE }));
    expect(refused).toEqual(
      GithubAtlasErrors.unusableResponse({
        reason: "ruleset record 1 omitted the required field enforcement",
        route: ROUTE,
      }),
    );
    expect(refused.code).toBe("UNUSABLE_RESPONSE");
    expect(refused.message).toBe(
      "/orgs/required-fields-org/rulesets answered successfully with a body this atlas cannot read: ruleset record 1 omitted the required field enforcement",
    );
  });

  it("refuses an empty enforcement exactly as a missing one, since the projection reads both as absent", () => {
    const read = readOf({ records: [{ enforcement: "", id: 33, name: "blank-ruleset" }] });
    expect(unwrapErr(refuseMissingRequiredFields({ call: RULESETS, read, route: ROUTE }))).toEqual(
      GithubAtlasErrors.unusableResponse({
        reason: "ruleset record 0 omitted the required field enforcement",
        route: ROUTE,
      }),
    );
  });

  it("refuses a non-object ruleset entry, which the projection would otherwise drop unseen", () => {
    const read = readOf({ records: ["not-a-ruleset"] });
    expect(unwrapErr(refuseMissingRequiredFields({ call: RULESETS, read, route: ROUTE }))).toEqual(
      GithubAtlasErrors.unusableResponse({ reason: "ruleset record 0 is not an object", route: ROUTE }),
    );
  });

  it("refuses a label listing of [null] rather than publishing zero labels", () => {
    const read = readOf({ records: [{ color: "a2eeef", name: "kind: feature" }, null] });
    expect(unwrapErr(refuseMissingRequiredFields({ call: LABELS, read, route: LABEL_ROUTE }))).toEqual(
      GithubAtlasErrors.unusableResponse({ reason: "repository-label record 1 is not an object", route: LABEL_ROUTE }),
    );
  });

  it("leaves a non-object entry of a kind with no required fields to the projection", () => {
    const read = readOf({ records: ["not-a-webhook"] });
    expect(
      unwrap(refuseMissingRequiredFields({ call: WEBHOOKS, read, route: "/orgs/required-fields-org/hooks" })),
    ).toBe(read);
  });

  it("judges no other kind against the ruleset contract", () => {
    const read = readOf({ records: [{ active: true, id: 7 }] });
    expect(
      unwrap(refuseMissingRequiredFields({ call: WEBHOOKS, read, route: "/orgs/required-fields-org/hooks" })),
    ).toBe(read);
  });

  it("accepts a label listing whose every label carries a name and a colour", () => {
    const read = readOf({ records: [{ color: "a2eeef", description: null, id: 41, name: "kind: feature" }] });
    expect(unwrap(refuseMissingRequiredFields({ call: LABELS, read, route: LABEL_ROUTE }))).toBe(read);
  });

  it("refuses a label listing whose record omits its colour, naming that record and field", () => {
    const read = readOf({
      records: [
        { color: "a2eeef", name: "kind: feature" },
        { id: 42, name: "colourless" },
      ],
    });
    expect(unwrapErr(refuseMissingRequiredFields({ call: LABELS, read, route: LABEL_ROUTE }))).toEqual(
      GithubAtlasErrors.unusableResponse({
        reason: "repository-label record 1 omitted the required field color",
        route: LABEL_ROUTE,
      }),
    );
  });

  it("names the name first when a label omits both", () => {
    const read = readOf({ records: [{ id: 43 }] });
    expect(unwrapErr(refuseMissingRequiredFields({ call: LABELS, read, route: LABEL_ROUTE }))).toEqual(
      GithubAtlasErrors.unusableResponse({
        reason: "repository-label record 0 omitted the required field name",
        route: LABEL_ROUTE,
      }),
    );
  });
});
