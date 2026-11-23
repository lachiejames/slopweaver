/**
 * `selectOwner` over the roster's decoded records: the first canonical person carrying a Linear id wins, past
 * earlier people on other providers, and a roster with nobody on Linear refuses with `NO_LINEAR_IDENTITY`. A
 * malformed entry never reaches this function — the roster port's strict decoder refuses it first — so no case
 * here feeds one.
 */
// The file reader and its permissive skip-the-malformed-entry cases went with it; the strict decoder's own
// refusals are pinned in `silver/identityRoster.test.ts`.
// deleted-with-code: readOwner
import { describe, expect, it } from "vitest";

import { selectOwner } from "../../../../../cli/commands/cycle/owner.js";
import { CycleErrors } from "../../../../../cycle/errors.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import type { IdentityRecord } from "../../../../../silver/identity.js";

const SLACK_ONLY: IdentityRecord = {
  handle: "slack-only",
  id: "slack-only",
  identities: [{ nativeId: "U01SLACK", source: "slack" }],
  name: "Slack Only",
};

describe("selectOwner", () => {
  it("takes the first person carrying a Linear id, past earlier people on other providers", () => {
    const records: readonly IdentityRecord[] = [
      SLACK_ONLY,
      {
        handle: "owner-one",
        id: "owner-one",
        identities: [
          { nativeId: "gh-owner", source: "github" },
          { nativeId: "lin-owner-1", source: "linear" },
        ],
        name: "Owner One",
      },
      {
        handle: "second",
        id: "second",
        identities: [{ nativeId: "lin-second", source: "linear" }],
        name: "Second Person",
      },
    ];
    expect(unwrap(selectOwner({ records }))).toEqual({ linearId: "lin-owner-1", name: "Owner One" });
  });

  it("refuses an empty roster with NO_LINEAR_IDENTITY", () => {
    expect(unwrapErr(selectOwner({ records: [] }))).toEqual(CycleErrors.noLinearIdentity());
  });

  it("refuses a roster whose people carry no Linear identity with NO_LINEAR_IDENTITY", () => {
    const owner = selectOwner({ records: [SLACK_ONLY] });
    expect(unwrapErr(owner).code).toBe("NO_LINEAR_IDENTITY");
    expect(unwrapErr(owner).message).toBe(
      "no person in the identity roster carries a Linear identity — nothing can be scoped to an owner " +
        "(`slopweaver identity roster show`)",
    );
  });
});
