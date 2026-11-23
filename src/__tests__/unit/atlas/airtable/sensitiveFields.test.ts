import { describe, expect, it } from "vitest";

import { AIRTABLE_ATLAS_KINDS } from "../../../../atlas/airtable/kinds.js";
import { AIRTABLE_FIELD_DENIALS, airtableFieldIsWithheld } from "../../../../atlas/airtable/sensitiveFields.js";

describe("withholding a credential-bearing field", () => {
  it("withholds a webhook's signing secret under the webhook kind", () => {
    expect(airtableFieldIsWithheld({ field: "macSecretBase64", kind: "webhook" })?.field).toBe("macSecretBase64");
  });

  // The denial is scoped to a KIND, so the same name under another kind is not silently swept up.
  it("does not withhold that name under a kind it cannot appear on", () => {
    expect(airtableFieldIsWithheld({ field: "macSecretBase64", kind: "base" })).toBe(null);
  });

  // A bare-name denylist on `key` or `token` would drop all of these, and keep nothing extra.
  it("stores the identifiers and data-table keys a substring rule would wrongly deny", () => {
    expect(airtableFieldIsWithheld({ field: "primaryKey", kind: "record" })).toBe(null);
    expect(airtableFieldIsWithheld({ field: "foreignKey", kind: "record" })).toBe(null);
    expect(airtableFieldIsWithheld({ field: "tokenId", kind: "credential" })).toBe(null);
    expect(airtableFieldIsWithheld({ field: "personalAccessTokenId", kind: "credential" })).toBe(null);
    expect(airtableFieldIsWithheld({ field: "isPasswordProtected", kind: "share" })).toBe(null);
  });

  it("withholds both halves of an export's signed download capability", () => {
    expect(airtableFieldIsWithheld({ field: "csvZipDownloadUrl", kind: "export-request" })?.field).toBe(
      "csvZipDownloadUrl",
    );
    expect(airtableFieldIsWithheld({ field: "jsonDownloadUrl", kind: "export-request" })?.field).toBe(
      "jsonDownloadUrl",
    );
  });

  it("scopes every denial to kinds this atlas actually holds", () => {
    const strangers = AIRTABLE_FIELD_DENIALS.flatMap((denial) =>
      denial.kinds.filter((kind) => !AIRTABLE_ATLAS_KINDS.includes(kind)),
    );

    expect(strangers).toEqual([]);
  });

  it("gives every denial a reason a reader can disagree with", () => {
    const unexplained = AIRTABLE_FIELD_DENIALS.filter((denial) => denial.reason.length < 40);

    expect(unexplained.map((denial) => denial.field)).toEqual([]);
  });
});
