/**
 * Unit: which Google scopes are provably read-only — the classification `secrets status` labels a grant by
 * and the Google Admin door refuses to store a grant over.
 */
import { describe, expect, it } from "vitest";

import { DRIVE_SCOPES } from "../../../../live/drive/scopes.js";
import { notReadOnlyScopes } from "../../../../live/google/scopes.js";
import { GOOGLE_ADMIN_SCOPES } from "../../../../live/googleAdmin/scopes.js";

const AUTH = "https://www.googleapis.com/auth/";

describe("notReadOnlyScopes", () => {
  it("names the Gmail writes a merged grant would carry, and none of its readonly scopes", () => {
    expect(
      notReadOnlyScopes({
        scopes: [
          `${AUTH}userinfo.email`,
          "openid",
          `${AUTH}admin.directory.user.readonly`,
          `${AUTH}drive.metadata.readonly`,
          `${AUTH}gmail.readonly`,
          `${AUTH}gmail.send`,
          `${AUTH}gmail.compose`,
          `${AUTH}gmail.modify`,
        ],
      }),
    ).toStrictEqual([`${AUTH}gmail.send`, `${AUTH}gmail.compose`, `${AUTH}gmail.modify`]);
  });

  it("finds nothing in every scope the Google Admin door asks for", () => {
    const requested = Object.values(GOOGLE_ADMIN_SCOPES);
    expect(requested.length).toBeGreaterThan(0);
    expect(notReadOnlyScopes({ scopes: requested })).toStrictEqual([]);
  });

  it("counts the Drive door's per-file write, which carries no readonly suffix", () => {
    expect(notReadOnlyScopes({ scopes: Object.values(DRIVE_SCOPES) })).toContain(`${AUTH}drive.file`);
  });

  it("accepts Google's hyphenated read-only spelling", () => {
    expect(notReadOnlyScopes({ scopes: [`${AUTH}cloud-platform.read-only`] })).toStrictEqual([]);
  });

  it("counts a scope it cannot classify, so an unknown is never assumed read-only", () => {
    expect(notReadOnlyScopes({ scopes: ["https://mail.google.com/"] })).toStrictEqual(["https://mail.google.com/"]);
  });

  it("reads Microsoft Graph's read scopes as read-only and its write scopes as writes", () => {
    expect(
      notReadOnlyScopes({
        scopes: [
          "User.Read",
          "https://graph.microsoft.com/Mail.Read",
          "Mail.ReadBasic",
          "offline_access",
          "Mail.ReadWrite",
          "https://graph.microsoft.com/Mail.Send",
        ],
      }),
    ).toStrictEqual(["Mail.ReadWrite", "https://graph.microsoft.com/Mail.Send"]);
  });

  it("finds nothing in an empty grant", () => {
    expect(notReadOnlyScopes({ scopes: [] })).toStrictEqual([]);
  });
});
