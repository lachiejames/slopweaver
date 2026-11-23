/** Unit: the live Outlook connector block `slopweaver onboard` renders beside the five corpus sources. */
import { describe, expect, it } from "vitest";
import { OUTLOOK_REGISTRATION_SETTINGS } from "../../../live/outlook/scopes.js";
import { OUTLOOK_REGISTRATION_PERMISSIONS, outlookConnectorLines } from "../../../onboard/outlook.js";

const text = outlookConnectorLines().join("\n");

describe("outlookConnectorLines", () => {
  it("renders the exact registration settings the preflight's registration row names", () => {
    expect(text).toContain(OUTLOOK_REGISTRATION_SETTINGS);
    expect(OUTLOOK_REGISTRATION_SETTINGS).toContain("admits personal Microsoft accounts");
    expect(OUTLOOK_REGISTRATION_SETTINGS).toContain(
      "Mobile and desktop applications platform with redirect `http://localhost`",
    );
    expect(OUTLOOK_REGISTRATION_SETTINGS).toContain("no client secret");
  });

  it("lists every delegated permission the door asks for", () => {
    expect(OUTLOOK_REGISTRATION_PERMISSIONS).toEqual([
      "User.Read",
      "Mail.Read",
      "MailboxSettings.Read",
      "Mail.ReadWrite",
      "Mail.Send",
      "offline_access",
    ]);
    expect(text).toContain(OUTLOOK_REGISTRATION_PERMISSIONS.join(", "));
  });

  it("says it is live and never crawled, and offers no refresh for it", () => {
    expect(text).toContain("NEVER crawled");
    expect(text).not.toContain("refresh --source outlook");
  });

  it("names the client id capture and the one consent", () => {
    expect(text).toContain("capture as: outlook-client-id");
    expect(text).toContain("`slopweaver outlook connect --grant manage`");
  });

  it("names the credential without spelling its setter, which the ordered command list owns", () => {
    expect(text).toContain("outlook-client-id");
    expect(text).not.toContain("slopweaver secrets set");
  });
});
