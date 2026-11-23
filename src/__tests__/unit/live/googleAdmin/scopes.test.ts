/**
 * Unit: the Google Admin door's scope table, checked against the GENERATED registry it exists to reach.
 *
 * The table in `src/live/googleAdmin/scopes.ts` is hand-written on purpose — a table that recomputed itself
 * would silently change what a person is asked to approve the day Google republishes a discovery document.
 * This file is the other half of that decision: every claim the table makes is re-derived here from
 * `generated/surfaces.ts`, so drift fails a test instead of changing a consent screen.
 */
import { describe, expect, it } from "vitest";

import { GOOGLE_ADMIN_SURFACES } from "../../../../atlas/googleAdmin/generated/surfaces.js";
import { missingScopes, satisfiesCapability, scopesToRequest } from "../../../../live/google/scopes.js";
import {
  GOOGLE_ADMIN_CAPABILITIES,
  GOOGLE_ADMIN_SCOPE_TABLE,
  GOOGLE_ADMIN_SCOPES,
  type GoogleAdminCapability,
} from "../../../../live/googleAdmin/scopes.js";

/** Every method the atlas takes a READ disposition on — the only ones this door's scopes exist to reach. */
const READ_ROWS = GOOGLE_ADMIN_SURFACES.filter(
  (row) => row.disposition === "entity" || row.disposition === "shape-index",
);

/** Every scope any of the eleven pinned documents declares, read or write. */
const DECLARED_SCOPES = new Set(GOOGLE_ADMIN_SURFACES.flatMap((row) => [...row.scopes]));

/** The scope URIs this door requests for everything except the account binding. */
const REQUESTED_ADMIN_SCOPES = GOOGLE_ADMIN_CAPABILITIES.filter((capability) => capability !== "identity").map(
  (capability) => GOOGLE_ADMIN_SCOPES[capability],
);

describe("the requested scope set", () => {
  it("is 26 administrator scopes beside the account binding", () => {
    expect(GOOGLE_ADMIN_CAPABILITIES.length).toBe(27);
    expect(REQUESTED_ADMIN_SCOPES.length).toBe(26);
  });

  it("declares every capability exactly once, with no duplicate scope behind two names", () => {
    expect(new Set(GOOGLE_ADMIN_CAPABILITIES).size).toBe(GOOGLE_ADMIN_CAPABILITIES.length);
    expect(new Set(REQUESTED_ADMIN_SCOPES).size).toBe(26);
  });

  it("asks for a `.readonly` scope every time — this consent screen cannot approve a write", () => {
    expect(REQUESTED_ADMIN_SCOPES.filter((scope) => !scope.endsWith(".readonly"))).toStrictEqual([]);
  });

  it("binds the account with userinfo.email and nothing wider", () => {
    expect(GOOGLE_ADMIN_SCOPES.identity).toBe("https://www.googleapis.com/auth/userinfo.email");
  });

  it("asks only for scopes Google's own pinned documents declare", () => {
    expect(REQUESTED_ADMIN_SCOPES.filter((scope) => !DECLARED_SCOPES.has(scope))).toStrictEqual([]);
  });

  it("lists the capabilities in sorted order, which is the order a consent screen shows them", () => {
    expect([...GOOGLE_ADMIN_CAPABILITIES]).toStrictEqual([...GOOGLE_ADMIN_CAPABILITIES].toSorted());
  });
});

describe("what the requested set reaches", () => {
  it("reaches 132 of the 156 methods the atlas takes a read disposition on", () => {
    expect(READ_ROWS.length).toBe(156);
    const reached = READ_ROWS.filter((row) => row.scopes.some((scope) => REQUESTED_ADMIN_SCOPES.includes(scope)));
    expect(reached.length).toBe(132);
  });

  it("leaves exactly the two classes it cannot reach, and nothing else", () => {
    const unreached = READ_ROWS.filter((row) => !row.scopes.some((scope) => REQUESTED_ADMIN_SCOPES.includes(scope)));
    // Google publishes these with an empty `scopes` array, so no grant can reach them — the atlas's own
    // `undeclared-scope` gap is the finding, and no scope this door could request would close it.
    const scopeless = unreached.filter((row) => row.scopes.length === 0);
    // These declare scopes, and every one of them can WRITE. Reaching them would mean asking a person to
    // approve a scope that creates, deletes or wipes — which this door refuses to do at all.
    const writeOnly = unreached.filter(
      (row) => row.scopes.length > 0 && !row.scopes.some((scope) => scope.endsWith(".readonly")),
    );
    expect(scopeless.length).toBe(8);
    expect(writeOnly.length).toBe(16);
    expect(scopeless.length + writeOnly.length).toBe(unreached.length);
  });

  it("names the write-only remainder, so a reader sees what the readonly rule costs", () => {
    const writeOnly = READ_ROWS.filter(
      (row) =>
        row.scopes.length > 0 &&
        !row.scopes.some((scope) => scope.endsWith(".readonly")) &&
        !row.scopes.some((scope) => REQUESTED_ADMIN_SCOPES.includes(scope)),
    ).map((row) => row.id);
    expect(writeOnly.toSorted()).toStrictEqual([
      "alertcenter.alerts.feedback.list",
      "alertcenter.alerts.get",
      "alertcenter.alerts.getMetadata",
      "alertcenter.alerts.list",
      "alertcenter.getSettings",
      "cloudidentity.devices.deviceUsers.lookup",
      "directory.asps.get",
      "directory.asps.list",
      "directory.tokens.get",
      "directory.tokens.list",
      "directory.verificationCodes.list",
      "groupsSettings.groups.get",
      "licensing.licenseAssignments.get",
      "licensing.licenseAssignments.listForProduct",
      "licensing.licenseAssignments.listForProductAndSku",
      "vault.matters.count",
    ]);
  });
});

describe("the implication table", () => {
  it("carries the write parent for every capability whose parent the registry declares, and nothing else", () => {
    const expected = Object.fromEntries(
      GOOGLE_ADMIN_CAPABILITIES.map((capability): [GoogleAdminCapability, readonly string[]] => {
        const scope = GOOGLE_ADMIN_SCOPES[capability];
        const parent = scope.replace(/\.readonly$/, "");
        const hasParent = parent !== scope && DECLARED_SCOPES.has(parent);
        return [capability, hasParent ? [parent] : []];
      }),
    );
    expect(GOOGLE_ADMIN_SCOPE_TABLE.impliedBy).toStrictEqual(expected);
  });

  it("leaves five capabilities with no implication, because Google publishes them readonly-only", () => {
    const unparented = GOOGLE_ADMIN_CAPABILITIES.filter(
      (capability) => capability !== "identity" && GOOGLE_ADMIN_SCOPE_TABLE.impliedBy[capability].length === 0,
    );
    expect(unparented.toSorted()).toStrictEqual([
      "chrome-app-details",
      "chrome-reports",
      "chrome-telemetry",
      "reports-audit",
      "reports-usage",
    ]);
  });

  it("nothing implies the account binding", () => {
    expect(GOOGLE_ADMIN_SCOPE_TABLE.impliedBy.identity).toStrictEqual([]);
  });
});

describe("satisfiesCapability", () => {
  it("accepts the wider write scope a person may already have approved elsewhere", () => {
    expect(
      satisfiesCapability({
        capability: "directory-users",
        granted: ["https://www.googleapis.com/auth/admin.directory.user"],
        table: GOOGLE_ADMIN_SCOPE_TABLE,
      }),
    ).toBe(true);
  });

  it("does NOT accept one directory scope for another — they are separate consents", () => {
    expect(
      satisfiesCapability({
        capability: "directory-groups",
        granted: [GOOGLE_ADMIN_SCOPES["directory-users"]],
        table: GOOGLE_ADMIN_SCOPE_TABLE,
      }),
    ).toBe(false);
  });

  it("does NOT accept a Drive scope for anything here — the two doors share no grant", () => {
    expect(
      satisfiesCapability({
        capability: "directory-users",
        granted: ["https://www.googleapis.com/auth/drive.readonly"],
        table: GOOGLE_ADMIN_SCOPE_TABLE,
      }),
    ).toBe(false);
  });
});

describe("missingScopes", () => {
  it("names the readonly scope rather than the write parent that would have implied it", () => {
    expect(
      missingScopes({
        capabilities: ["vault-ediscovery"],
        granted: [],
        table: GOOGLE_ADMIN_SCOPE_TABLE,
      }),
    ).toStrictEqual(["https://www.googleapis.com/auth/ediscovery.readonly"]);
  });

  it("is empty for a capability the grant carries", () => {
    expect(
      missingScopes({
        capabilities: ["reports-audit"],
        granted: [GOOGLE_ADMIN_SCOPES["reports-audit"]],
        table: GOOGLE_ADMIN_SCOPE_TABLE,
      }),
    ).toStrictEqual([]);
  });
});

describe("scopesToRequest", () => {
  it("leads with identity, so connect can name the account it bound to", () => {
    expect(scopesToRequest({ capabilities: ["directory-users"], table: GOOGLE_ADMIN_SCOPE_TABLE })).toStrictEqual([
      GOOGLE_ADMIN_SCOPES.identity,
      GOOGLE_ADMIN_SCOPES["directory-users"],
    ]);
  });

  it("asks for 27 scopes on the whole-surface grant, identity included exactly once", () => {
    expect(scopesToRequest({ capabilities: GOOGLE_ADMIN_CAPABILITIES, table: GOOGLE_ADMIN_SCOPE_TABLE })).toHaveLength(
      27,
    );
  });
});
