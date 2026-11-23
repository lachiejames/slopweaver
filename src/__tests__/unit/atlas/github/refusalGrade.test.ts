/**
 * How a refused GitHub read is graded: expected or not, a hidden 404 or a missing route, and whether a kind is
 * dark for permissions alone — the stamp that exempts it from the kit's publish gate.
 */
import { describe, expect, it } from "vitest";

import { GithubAtlasErrors } from "../../../../atlas/github/errors.js";
import { GITHUB_CALLS } from "../../../../atlas/github/inventory.js";
import {
  type GithubKindFailure,
  isExpectedRefusal,
  permissionBlockedField,
  permissionGraded,
} from "../../../../atlas/github/refusalGrade.js";

const AT = "2026-09-29T00:00:00.000Z";

/** One failure against the webhook kind, refused unless a code says otherwise. */
function failure({ code = "SCOPE_REFUSED", expected, reason }: Partial<GithubKindFailure>): GithubKindFailure {
  return { code, expected: expected === true, kind: "webhook", reason: reason!, route: "/x" };
}

describe("isExpectedRefusal", () => {
  it("treats a 403 as expected when the call says so", () => {
    const call = GITHUB_CALLS.find((entry) => entry.id === "org-actions-policy")!;
    expect(isExpectedRefusal({ call, error: GithubAtlasErrors.scopeRefused({ route: "/x", scope: null }) })).toBe(true);
  });

  it("treats a 403 as UNexpected on a call that does not list it", () => {
    const call = GITHUB_CALLS.find((entry) => entry.id === "org-settings")!;
    expect(isExpectedRefusal({ call, error: GithubAtlasErrors.scopeRefused({ route: "/x", scope: null }) })).toBe(
      false,
    );
  });

  it("treats a 404 as expected only where the call lists it", () => {
    const listed = GITHUB_CALLS.find((entry) => entry.id === "org-code-security-configurations")!;
    const unlisted = GITHUB_CALLS.find((entry) => entry.id === "org-webhooks")!;
    expect(isExpectedRefusal({ call: listed, error: GithubAtlasErrors.routeAbsent({ route: "/x" }) })).toBe(true);
    expect(isExpectedRefusal({ call: unlisted, error: GithubAtlasErrors.routeAbsent({ route: "/x" }) })).toBe(false);
  });
});

describe("permissionGraded", () => {
  it("reads a 404 on a route GitHub hides from non-admins as a permission refusal", () => {
    const call = GITHUB_CALLS.find((entry) => entry.id === "repo-deploy-keys")!;
    const graded = permissionGraded({
      call,
      error: GithubAtlasErrors.routeAbsent({ route: "/repos/o/r/keys" }),
      route: "/repos/o/r/keys",
    });
    expect(graded.code).toBe("SCOPE_REFUSED");
    expect(isExpectedRefusal({ call, error: graded })).toBe(true);
  });

  it("leaves a 404 on the object's own document a missing route", () => {
    const call = GITHUB_CALLS.find((entry) => entry.id === "repo-settings")!;
    const graded = permissionGraded({
      call,
      error: GithubAtlasErrors.routeAbsent({ route: "/repos/o/r" }),
      route: "/repos/o/r",
    });
    expect(graded.code).toBe("ROUTE_ABSENT");
  });
});

describe("permissionBlockedField", () => {
  it("stamps a kind refused only by expected permission refusals, naming each route", () => {
    const field = permissionBlockedField({
      at: AT,
      failures: [failure({ expected: true, reason: "a" }), failure({ expected: true, reason: "b" })],
      kind: "webhook",
    });
    expect(field.permissionBlocked!.at).toBe(AT);
    expect(field.permissionBlocked!.detail).toBe("a; b");
  });

  it("names three routes and counts the rest", () => {
    const failures = ["a", "b", "c", "d", "e"].map((reason) => failure({ expected: true, reason }));
    const field = permissionBlockedField({ at: AT, failures, kind: "webhook" });
    expect(field.permissionBlocked!.detail).toBe("a; b; c; and 2 more route(s) refused alike");
  });

  it("does not stamp a kind that is also broken on another route", () => {
    const field = permissionBlockedField({
      at: AT,
      failures: [failure({ expected: true, reason: "a" }), failure({ code: "TRANSPORT_EXHAUSTED", reason: "b" })],
      kind: "webhook",
    });
    expect(field).toEqual({});
  });

  it("does not stamp a kind whose only refusal is an expected missing route", () => {
    const field = permissionBlockedField({
      at: AT,
      failures: [failure({ code: "ROUTE_ABSENT", expected: true, reason: "a" })],
      kind: "webhook",
    });
    expect(field).toEqual({});
  });
});
