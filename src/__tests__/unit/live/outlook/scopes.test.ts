/**
 * The Outlook permission table in `live/outlook/scopes.ts`: what a request for each capability asks Microsoft
 * for, which permissions satisfy a verb (a manage grant covers every read, a send is its own grant), and which
 * scopes a stored grant records. Pure functions and constants, asserted on their exact values.
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_OUTLOOK_GRANT,
  grantedOutlookScopes,
  missingOutlookScopes,
  OUTLOOK_GRANTS,
  OUTLOOK_VERB_CAPABILITIES,
  outlookReconnectCommand,
  outlookRequestScopes,
} from "../../../../live/outlook/scopes.js";

describe("outlookRequestScopes", () => {
  it("names each capability's own permission in capability order and ends with offline_access", () => {
    expect(outlookRequestScopes({ capabilities: ["identity", "read", "settings", "modify", "send"] })).toEqual([
      "User.Read",
      "Mail.Read",
      "MailboxSettings.Read",
      "Mail.ReadWrite",
      "Mail.Send",
      "offline_access",
    ]);
  });

  it("deduplicates a repeated capability", () => {
    expect(outlookRequestScopes({ capabilities: ["read", "read"] })).toEqual(["Mail.Read", "offline_access"]);
  });

  it("asks only for the refresh token when no capability is wanted", () => {
    expect(outlookRequestScopes({ capabilities: [] })).toEqual(["offline_access"]);
  });
});

describe("missingOutlookScopes", () => {
  it("is empty when every capability's permission is granted", () => {
    expect(missingOutlookScopes({ capabilities: ["read", "send"], granted: ["Mail.Read", "Mail.Send"] })).toEqual([]);
  });

  it("lets Mail.ReadWrite satisfy a read", () => {
    expect(missingOutlookScopes({ capabilities: ["read"], granted: ["Mail.ReadWrite"] })).toEqual([]);
  });

  it("lets MailboxSettings.ReadWrite satisfy the settings capability", () => {
    expect(missingOutlookScopes({ capabilities: ["settings"], granted: ["MailboxSettings.ReadWrite"] })).toEqual([]);
  });

  it("does not let Mail.ReadWrite satisfy a send, or Mail.Read satisfy a modify", () => {
    expect(missingOutlookScopes({ capabilities: ["send"], granted: ["Mail.ReadWrite"] })).toEqual(["Mail.Send"]);
    expect(missingOutlookScopes({ capabilities: ["modify"], granted: ["Mail.Read"] })).toEqual(["Mail.ReadWrite"]);
  });

  it("compares scopes case-insensitively and ignores the Graph origin prefix", () => {
    expect(
      missingOutlookScopes({
        capabilities: ["read", "identity"],
        granted: ["https://graph.microsoft.com/MAIL.READ", "user.read"],
      }),
    ).toEqual([]);
  });

  it("names each missing capability by its own permission, in the order given", () => {
    expect(missingOutlookScopes({ capabilities: ["send", "modify", "read"], granted: [] })).toEqual([
      "Mail.Send",
      "Mail.ReadWrite",
      "Mail.Read",
    ]);
  });

  it("never asks for offline_access to be reported", () => {
    expect(missingOutlookScopes({ capabilities: ["identity"], granted: ["User.Read"] })).toEqual([]);
  });
});

describe("grantedOutlookScopes", () => {
  it("drops the OpenID scopes MSAL adds, whatever their case", () => {
    expect(grantedOutlookScopes({ reported: ["openid", "Profile", "EMAIL", "offline_access", "Mail.Read"] })).toEqual([
      "Mail.Read",
    ]);
  });

  it("shortens Graph-origin scopes, deduplicates, and keeps the reported order", () => {
    expect(
      grantedOutlookScopes({
        reported: ["https://graph.microsoft.com/Mail.ReadWrite", "User.Read", "Mail.ReadWrite"],
      }),
    ).toEqual(["Mail.ReadWrite", "User.Read"]);
  });

  it("answers nothing for nothing reported", () => {
    expect(grantedOutlookScopes({ reported: [] })).toEqual([]);
  });
});

describe("the connect grants and verb capabilities", () => {
  it("offers three grants, narrowest first, with manage as the default", () => {
    expect(OUTLOOK_GRANTS).toEqual({
      full: ["identity", "read", "settings", "modify", "send"],
      manage: ["identity", "read", "settings", "modify"],
      read: ["identity", "read", "settings"],
    });
    expect(DEFAULT_OUTLOOK_GRANT).toBe("manage");
  });

  it("asks for the calendar's read only when named, and lets the existing Calendars.ReadWrite satisfy it", () => {
    expect(outlookRequestScopes({ capabilities: ["calendar"] })).toEqual(["Calendars.Read", "offline_access"]);
    expect(missingOutlookScopes({ capabilities: ["calendar"], granted: ["Calendars.ReadWrite"] })).toEqual([]);
    expect(missingOutlookScopes({ capabilities: ["calendar"], granted: ["Mail.ReadWrite"] })).toEqual([
      "Calendars.Read",
    ]);
  });

  it("names a reconnect that adds what is missing and drops nothing the grant already holds", () => {
    const manage = ["User.Read", "Mail.Read", "MailboxSettings.Read", "Mail.ReadWrite"];
    expect(outlookReconnectCommand({ granted: manage, missing: ["Calendars.Read"] })).toBe(
      "slopweaver outlook connect --calendar",
    );
    expect(outlookReconnectCommand({ granted: [...manage, "Mail.Send"], missing: ["Calendars.Read"] })).toBe(
      "slopweaver outlook connect --grant full --calendar",
    );
    expect(outlookReconnectCommand({ granted: manage, missing: ["Mail.Send"] })).toBe(
      "slopweaver outlook connect --grant full",
    );
    expect(outlookReconnectCommand({ granted: [...manage, "Calendars.ReadWrite"], missing: ["Mail.Send"] })).toBe(
      "slopweaver outlook connect --grant full --calendar",
    );
  });

  it("declares each verb's minimum capabilities", () => {
    expect(OUTLOOK_VERB_CAPABILITIES).toEqual({
      archive: ["modify"],
      attachment: ["read"],
      categories: ["settings"],
      category: ["modify", "settings"],
      draft: ["modify"],
      folders: ["read"],
      list: ["read"],
      mark: ["modify"],
      measure: ["read"],
      read: ["read"],
      send: ["send", "read"],
      triage: ["read"],
    });
  });

  it("lets the full grant run every verb", () => {
    const refused = Object.entries(OUTLOOK_VERB_CAPABILITIES).filter(
      ([, capabilities]) =>
        missingOutlookScopes({
          capabilities,
          granted: outlookRequestScopes({ capabilities: OUTLOOK_GRANTS["full"]! }),
        }).length > 0,
    );

    expect(refused.map(([verb]) => verb)).toEqual([]);
  });

  it("lets the manage grant run every verb but send", () => {
    const refused = Object.entries(OUTLOOK_VERB_CAPABILITIES).filter(
      ([, capabilities]) =>
        missingOutlookScopes({
          capabilities,
          granted: outlookRequestScopes({ capabilities: OUTLOOK_GRANTS["manage"]! }),
        }).length > 0,
    );

    expect(refused.map(([verb]) => verb)).toEqual(["send"]);
  });

  it("lets the read grant run only the reads and the category list", () => {
    const refused = Object.entries(OUTLOOK_VERB_CAPABILITIES).filter(
      ([, capabilities]) =>
        missingOutlookScopes({
          capabilities,
          granted: outlookRequestScopes({ capabilities: OUTLOOK_GRANTS["read"]! }),
        }).length > 0,
    );

    expect(refused.map(([verb]) => verb)).toEqual(["archive", "category", "draft", "mark", "send"]);
  });
});
