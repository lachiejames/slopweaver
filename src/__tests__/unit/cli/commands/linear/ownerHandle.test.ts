/**
 * The owner crosswalk's handling of what a roster person may leave out: no linked identities, a Linear
 * identity with a name but no handle, and one with an empty handle. The two crosswalks themselves are pinned
 * in `queryCore.test.ts`, where they were written.
 */
import { describe, expect, it } from "vitest";

import { resolveOwnerLinearHandle } from "../../../../../cli/commands/linear/ownerHandle.js";
import { LinearQueryErrors } from "../../../../../corpus/linear/queryErrors.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import type { IdentityRecord } from "../../../../../silver/identity.js";

describe("resolveOwnerLinearHandle — what a roster person leaves out", () => {
  it("refuses a profile person with no linked identities at all", () => {
    const roster: IdentityRecord[] = [{ handle: "kim", id: "person:kim", name: "Kim" }];
    expect(unwrapErr(resolveOwnerLinearHandle({ ownerSlackUserId: "U123", profileId: "person:kim", roster }))).toEqual(
      LinearQueryErrors.ownerUnresolved({ profileId: "person:kim" }),
    );
  });

  it("uses a Linear identity's display name when it carries no handle", () => {
    const roster: IdentityRecord[] = [
      {
        handle: "kim",
        id: "person:kim",
        identities: [{ name: "Kim Lee", nativeId: "linear-uuid", source: "linear" }],
        name: "Kim",
      },
    ];
    expect(unwrap(resolveOwnerLinearHandle({ ownerSlackUserId: undefined, profileId: "person:kim", roster }))).toBe(
      "Kim Lee",
    );
  });

  it("passes over an empty Linear handle, without reading the name, to the Slack crosswalk", () => {
    const roster: IdentityRecord[] = [
      {
        handle: "kim",
        id: "person:kim",
        identities: [{ handle: "", name: "Kim Lee", nativeId: "linear-uuid", source: "linear" }],
        name: "Kim",
      },
      {
        handle: "lee",
        id: "person:lee",
        identities: [
          { nativeId: "U123", source: "slack" },
          { handle: "lee.k", nativeId: "linear-uuid-2", source: "linear" },
        ],
        name: "Lee",
      },
    ];
    expect(unwrap(resolveOwnerLinearHandle({ ownerSlackUserId: "U123", profileId: "person:kim", roster }))).toBe(
      "lee.k",
    );
  });
});
