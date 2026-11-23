/**
 * Adding one IAM member, and the superset proof that refuses any write taking something away.
 */
import { describe, expect, it } from "vitest";

import { addIamMember, isStrictSuperset } from "../../../gcp/iam.js";
import type { IamPolicy } from "../../../gcp/wire.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const ACCESSOR = "roles/secretmanager.secretAccessor";
const CONDITION = { expression: "request.time < timestamp('2027-01-01T00:00:00Z')", title: "until 2027" };

const POLICY: IamPolicy = {
  bindings: [
    { members: ["serviceAccount:a@my-project-01.iam.gserviceaccount.com"], role: ACCESSOR },
    { condition: CONDITION, members: ["user:b@example.com"], role: ACCESSOR },
    { members: ["projectOwner:my-project-01"], role: "roles/owner" },
  ],
  etag: "BwY=",
  version: 3,
};

describe("addIamMember", () => {
  it("widens the unconditional binding for the role and leaves the conditional one untouched", () => {
    const after = unwrap(addIamMember({ member: "user:c@example.com", policy: POLICY, role: ACCESSOR }));
    expect(after.bindings).toEqual([
      { members: ["serviceAccount:a@my-project-01.iam.gserviceaccount.com", "user:c@example.com"], role: ACCESSOR },
      { condition: CONDITION, members: ["user:b@example.com"], role: ACCESSOR },
      { members: ["projectOwner:my-project-01"], role: "roles/owner" },
    ]);
    expect(after.etag).toBe("BwY=");
  });

  it("appends a new binding for a role the policy does not grant", () => {
    const after = unwrap(addIamMember({ member: "allUsers", policy: { etag: "e" }, role: "roles/run.invoker" }));
    expect(after).toEqual({ bindings: [{ members: ["allUsers"], role: "roles/run.invoker" }], etag: "e" });
  });

  it("answers NO_CHANGE when the member already holds the role unconditionally", () => {
    const error = unwrapErr(
      addIamMember({
        member: "serviceAccount:a@my-project-01.iam.gserviceaccount.com",
        policy: POLICY,
        role: ACCESSOR,
      }),
    );
    expect(error.code).toBe("NO_CHANGE");
  });

  it("refuses a policy read with no etag, since its write could overwrite a concurrent edit", () => {
    expect(
      unwrapErr(addIamMember({ member: "user:c@example.com", policy: { bindings: [] }, role: ACCESSOR })).code,
    ).toBe("REQUEST_REFUSED");
  });
});

describe("isStrictSuperset", () => {
  const added = unwrap(addIamMember({ member: "user:c@example.com", policy: POLICY, role: ACCESSOR }));

  it("holds for the one-member merge", () => {
    expect(isStrictSuperset({ after: added, before: POLICY })).toBe(true);
  });

  it("fails when a member is swapped rather than added", () => {
    const swapped: IamPolicy = {
      ...POLICY,
      bindings: [{ members: ["user:c@example.com"], role: ACCESSOR }, ...POLICY.bindings!.slice(1)],
    };
    expect(isStrictSuperset({ after: swapped, before: POLICY })).toBe(false);
  });

  it("fails when a member moves from a conditional grant to an unconditional one", () => {
    const unconditional: IamPolicy = {
      ...POLICY,
      bindings: [
        { members: ["serviceAccount:a@my-project-01.iam.gserviceaccount.com", "user:b@example.com"], role: ACCESSOR },
        { condition: CONDITION, members: [], role: ACCESSOR },
        POLICY.bindings![2]!,
      ],
    };
    expect(isStrictSuperset({ after: unconditional, before: POLICY })).toBe(false);
  });

  it("fails on two added members, a changed etag, version or audit config, and on no change at all", () => {
    const twice = unwrap(addIamMember({ member: "user:d@example.com", policy: added, role: ACCESSOR }));
    expect([
      isStrictSuperset({ after: twice, before: POLICY }),
      isStrictSuperset({ after: { ...added, etag: "other" }, before: POLICY }),
      isStrictSuperset({ after: { ...added, version: 1 }, before: POLICY }),
      isStrictSuperset({ after: { ...added, auditConfigs: [{ service: "allServices" }] }, before: POLICY }),
      isStrictSuperset({ after: POLICY, before: POLICY }),
    ]).toEqual([false, false, false, false, false]);
  });
});
