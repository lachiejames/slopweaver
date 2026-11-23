/**
 * Unit: the Drive door's scope table read through the shared Google helpers — the per-verb mapping, and the
 * one implication rule Google's own model has here.
 */
import { describe, expect, it } from "vitest";
import { DRIVE_SCOPE_TABLE, DRIVE_SCOPES, VERB_CAPABILITIES } from "../../../../live/drive/scopes.js";
import { missingScopes, satisfiesCapability, scopesToRequest } from "../../../../live/google/scopes.js";

describe("satisfiesCapability", () => {
  it("accepts drive.readonly for a metadata requirement, because readonly subsumes metadata", () => {
    expect(
      satisfiesCapability({ capability: "metadata", granted: [DRIVE_SCOPES.content], table: DRIVE_SCOPE_TABLE }),
    ).toBe(true);
  });

  it("does NOT accept drive.metadata.readonly for a content requirement — it cannot read a byte", () => {
    expect(
      satisfiesCapability({ capability: "content", granted: [DRIVE_SCOPES.metadata], table: DRIVE_SCOPE_TABLE }),
    ).toBe(false);
  });

  it("accepts the capability's own scope", () => {
    expect(
      satisfiesCapability({ capability: "content", granted: [DRIVE_SCOPES.content], table: DRIVE_SCOPE_TABLE }),
    ).toBe(true);
  });

  it("does NOT accept a Gmail scope for anything here — the two doors share no grant", () => {
    expect(
      satisfiesCapability({
        capability: "metadata",
        granted: ["https://www.googleapis.com/auth/gmail.readonly"],
        table: DRIVE_SCOPE_TABLE,
      }),
    ).toBe(false);
  });
});

describe("missingScopes", () => {
  it("names drive.readonly when a metadata-only grant is asked to read content", () => {
    expect(
      missingScopes({ capabilities: ["content"], granted: [DRIVE_SCOPES.metadata], table: DRIVE_SCOPE_TABLE }),
    ).toStrictEqual([DRIVE_SCOPES.content]);
  });

  it("is empty when the wider grant covers both", () => {
    expect(
      missingScopes({
        capabilities: ["metadata", "content"],
        granted: [DRIVE_SCOPES.content],
        table: DRIVE_SCOPE_TABLE,
      }),
    ).toStrictEqual([]);
  });

  it("names every capability when nothing was granted", () => {
    expect(
      missingScopes({ capabilities: ["metadata", "content"], granted: [], table: DRIVE_SCOPE_TABLE }),
    ).toStrictEqual([DRIVE_SCOPES.metadata, DRIVE_SCOPES.content]);
  });
});

describe("scopesToRequest", () => {
  it("always leads with identity, so connect can name the account it bound to", () => {
    expect(scopesToRequest({ capabilities: ["metadata"], table: DRIVE_SCOPE_TABLE })).toStrictEqual([
      DRIVE_SCOPES.identity,
      DRIVE_SCOPES.metadata,
    ]);
  });

  it("asks for BOTH scopes on the read grant, so a narrowed consent is still reported per scope", () => {
    expect(scopesToRequest({ capabilities: ["metadata", "content"], table: DRIVE_SCOPE_TABLE })).toStrictEqual([
      DRIVE_SCOPES.identity,
      DRIVE_SCOPES.metadata,
      DRIVE_SCOPES.content,
    ]);
  });
});

describe("VERB_CAPABILITIES", () => {
  it("keeps the two enumerating verbs on the narrow grant that cannot read a file", () => {
    expect(VERB_CAPABILITIES["list"]).toStrictEqual(["metadata"]);
    expect(VERB_CAPABILITIES["drives"]).toStrictEqual(["metadata"]);
  });

  it("puts the only content-reading verb on the content grant", () => {
    expect(VERB_CAPABILITIES["read"]).toStrictEqual(["content"]);
  });
});
