/** Unit: the Outlook mailbox's onboarding spec — one of the corpus sources, connected once by registration and consent. */
import { describe, expect, it } from "vitest";
import { OUTLOOK_REGISTRATION_SETTINGS } from "../../../live/outlook/scopes.js";
import { OUTLOOK_REGISTRATION_PERMISSIONS, OUTLOOK_SOURCE_SPEC } from "../../../onboard/outlook.js";
import { connectSourceLines } from "../../../onboard/sources.js";

const registration = OUTLOOK_SOURCE_SPEC.credentials[0]!;
const consent = OUTLOOK_SOURCE_SPEC.credentials[1]!;

describe("OUTLOOK_SOURCE_SPEC", () => {
  it("names the exact registration settings the preflight's registration row names", () => {
    expect(registration.action).toContain(OUTLOOK_REGISTRATION_SETTINGS);
    expect(OUTLOOK_REGISTRATION_SETTINGS).toContain("admits personal Microsoft accounts");
    expect(OUTLOOK_REGISTRATION_SETTINGS).toContain(
      "Mobile and desktop applications platform with redirect `http://localhost`",
    );
    expect(OUTLOOK_REGISTRATION_SETTINGS).toContain("no client secret");
  });

  it("lists every delegated permission the mail door asks for, and no calendar one", () => {
    expect(OUTLOOK_REGISTRATION_PERMISSIONS).toEqual([
      "User.Read",
      "Mail.Read",
      "MailboxSettings.Read",
      "Mail.ReadWrite",
      "Mail.Send",
      "offline_access",
    ]);
    expect(registration.action).toContain(OUTLOOK_REGISTRATION_PERMISSIONS.join(", "));
  });

  it("captures the client id, which is no secret, then takes the one consent", () => {
    expect(registration.secret).toBe("outlook-client-id");
    expect(registration.warning).toBeUndefined();
    expect(consent.secret).toBeUndefined();
    expect(consent.action).toContain("`slopweaver outlook connect --grant manage`");
  });

  it("is refreshed by naming it, never by --all-sources, and proved by its own preflight", () => {
    expect(OUTLOOK_SOURCE_SPEC.refreshArgv).toEqual(["refresh", "--source", "outlook"]);
    expect(OUTLOOK_SOURCE_SPEC.inAllSources).toBe(false);
    expect(OUTLOOK_SOURCE_SPEC.preflight).toBe("slopweaver connect outlook --check --json");
  });

  it("renders once among the corpus sources, naming the credential without spelling its setter", () => {
    const text = connectSourceLines({ hasBot: true }).join("\n");
    expect(text.split("\n").filter((line) => line.startsWith("  outlook")).length).toBe(1);
    expect(text).toContain("capture as: outlook-client-id");
    expect(text).not.toContain("slopweaver secrets set outlook-client-id");
  });
});
