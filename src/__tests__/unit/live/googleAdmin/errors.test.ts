/**
 * The Google Admin door's error factories carry the Admin door's OWN product name and connect verb, so a failure
 * never tells the operator to re-run the mail or Drive door's consent.
 */
import { describe, expect, it } from "vitest";

import { GoogleAdminDoorErrors } from "../../../../live/googleAdmin/errors.js";

describe("GoogleAdminDoorErrors", () => {
  it("names the Admin product and the Admin connect verb when nothing is connected", () => {
    expect(GoogleAdminDoorErrors.notConnected()).toEqual({
      code: "NOT_CONNECTED",
      message: "no Google Workspace Admin grant stored for this home — run `slopweaver atlas google-admin connect`",
    });
  });

  it("names every missing scope and the verb that re-grants them", () => {
    const error = GoogleAdminDoorErrors.scopeMissing({
      missing: ["admin.directory.user.readonly", "admin.reports.audit.readonly"],
    });

    expect(error.code).toBe("SCOPE_MISSING");
    expect(error.message).toBe(
      "the stored Google Workspace Admin grant is missing admin.directory.user.readonly, admin.reports.audit.readonly — " +
        "re-run `slopweaver atlas google-admin connect` and approve it",
    );
  });

  it("carries a consent failure's own message and code", () => {
    const error = GoogleAdminDoorErrors.consentFailed({ message: "the browser was closed before consent" });

    expect(error.code).toBe("CONSENT_FAILED");
    expect(error.message).toBe("the browser was closed before consent");
  });
});
