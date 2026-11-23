/**
 * `googleCredentialErrors`: the four grant-lifecycle variants every Google door shares, bound to one door's
 * product name and connect verb — each variant's literal code and exact message, the whole missing-scope
 * list, and a `cause` carried by identity when supplied and omitted entirely when not.
 */
import { describe, expect, it } from "vitest";

import {
  type GoogleCredentialError,
  type GoogleCredentialErrorFactories,
  googleCredentialErrors,
} from "../../../../live/google/credentialErrors.js";

const drive: GoogleCredentialErrorFactories = googleCredentialErrors({
  connectVerb: "slopweaver drive connect",
  productName: "Google Drive",
});

describe("googleCredentialErrors", () => {
  it("notConnected is NOT_CONNECTED and names the verb that establishes the grant", () => {
    const error: GoogleCredentialError = drive.notConnected();
    expect(error).toEqual({
      code: "NOT_CONNECTED",
      message: "no Google Drive grant stored for this home — run `slopweaver drive connect`",
    });
  });

  it("scopeMissing is SCOPE_MISSING, carries the whole missing list and names every scope in order", () => {
    const missing = [
      "https://www.googleapis.com/auth/drive.readonly",
      "https://www.googleapis.com/auth/drive.metadata.readonly",
    ];
    const error: GoogleCredentialError = drive.scopeMissing({ missing });
    expect(error).toEqual({
      code: "SCOPE_MISSING",
      message:
        "the stored Google Drive grant is missing https://www.googleapis.com/auth/drive.readonly, " +
        "https://www.googleapis.com/auth/drive.metadata.readonly — re-run `slopweaver drive connect` and approve it",
      missing: [
        "https://www.googleapis.com/auth/drive.readonly",
        "https://www.googleapis.com/auth/drive.metadata.readonly",
      ],
    });
  });

  it("credentialUnreadable is CREDENTIAL_UNREADABLE, keeps the message and carries the cause by identity", () => {
    const cause = new Error("EACCES: permission denied");
    const error = drive.credentialUnreadable({ cause, message: "grant file unreadable" });
    expect(error).toEqual({ cause, code: "CREDENTIAL_UNREADABLE", message: "grant file unreadable" });
    expect(error.cause).toBe(cause);
  });

  it("credentialUnreadable is CREDENTIAL_UNREADABLE and omits the cause key when none is given", () => {
    const error = drive.credentialUnreadable({ message: "no OAuth client configured" });
    expect(error).toStrictEqual({ code: "CREDENTIAL_UNREADABLE", message: "no OAuth client configured" });
    expect(Object.keys(error)).toEqual(["code", "message"]);
  });

  it("consentFailed is CONSENT_FAILED, keeps the message and carries the cause by identity", () => {
    const cause = { reason: "access_denied" };
    const error = drive.consentFailed({ cause, message: "the user declined consent" });
    expect(error).toEqual({ cause, code: "CONSENT_FAILED", message: "the user declined consent" });
    expect(error.cause).toBe(cause);
  });

  it("consentFailed is CONSENT_FAILED and omits the cause key when none is given", () => {
    const error = drive.consentFailed({ message: "state mismatch" });
    expect(Object.keys(error)).toEqual(["code", "message"]);
    expect(error).toStrictEqual({ code: "CONSENT_FAILED", message: "state mismatch" });
  });

  it("binds each door's own vocabulary, so two doors' NOT_CONNECTED messages differ", () => {
    const gmail = googleCredentialErrors({ connectVerb: "slopweaver gmail connect", productName: "Gmail" });
    expect(gmail.notConnected().message).toBe("no Gmail grant stored for this home — run `slopweaver gmail connect`");
    expect(drive.notConnected().message).toBe(
      "no Google Drive grant stored for this home — run `slopweaver drive connect`",
    );
  });
});
