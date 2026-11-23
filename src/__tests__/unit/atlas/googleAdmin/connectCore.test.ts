/**
 * Unit: `atlas google-admin connect`'s pure argument handling — what each `--grant` name asks Google for,
 * and that a malformed tail is refused before any socket could be opened.
 */
import { describe, expect, it } from "vitest";

import {
  adminClientAbsent,
  adminClientPair,
  GOOGLE_ADMIN_CONNECT_FLAG_NAMES,
  GOOGLE_ADMIN_CONNECT_USAGE,
  parseGoogleAdminConnectArgs,
} from "../../../../cli/commands/atlas/googleAdmin/connectCore.js";
import { GoogleAdminErrors, googleAdminConnectErrorLines } from "../../../../cli/commands/atlas/googleAdmin/errors.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { GOOGLE_ADMIN_CAPABILITIES, GOOGLE_ADMIN_SCOPES } from "../../../../live/googleAdmin/scopes.js";

describe("parseGoogleAdminConnectArgs", () => {
  it("defaults to the whole readonly surface, because a partial grant makes a half-filled atlas", () => {
    const parsed = parseGoogleAdminConnectArgs({ rest: [] });
    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed).capabilities).toStrictEqual(GOOGLE_ADMIN_CAPABILITIES);
  });

  it("narrows to the twelve Admin SDK directory areas on --grant directory", () => {
    const parsed = parseGoogleAdminConnectArgs({ rest: ["--grant", "directory"] });
    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed).capabilities).toStrictEqual([
      "datatransfer",
      "directory-calendar-resources",
      "directory-chromeos-devices",
      "directory-customer",
      "directory-domains",
      "directory-groups",
      "directory-mobile-devices",
      "directory-orgunits",
      "directory-printers",
      "directory-roles",
      "directory-schemas",
      "directory-users",
    ]);
  });

  it("narrows to the one Vault area on --grant vault", () => {
    const parsed = parseGoogleAdminConnectArgs({ rest: ["--grant", "vault"] });
    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed).capabilities).toStrictEqual(["vault-ediscovery"]);
  });

  it("names cloud-identity rather than identity, which is the account-binding capability", () => {
    const parsed = parseGoogleAdminConnectArgs({ rest: ["--grant", "cloud-identity"] });
    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed).capabilities).toStrictEqual([
      "identity-allowlisted-domains",
      "identity-devices",
      "identity-groups",
      "identity-inbound-sso",
      "identity-policies",
    ]);
  });

  it("requests no scope that can write, whichever grant name is chosen", () => {
    const names = ["all", "directory", "reports", "chrome", "cloud-identity", "vault"];
    const writeable = names.flatMap((name) =>
      unwrap(parseGoogleAdminConnectArgs({ rest: ["--grant", name] }))
        .capabilities.map((capability) => GOOGLE_ADMIN_SCOPES[capability])
        .filter((scope) => scope !== GOOGLE_ADMIN_SCOPES.identity && !scope.endsWith(".readonly")),
    );
    expect(writeable).toStrictEqual([]);
  });

  it("refuses an unknown --grant and names every choice it does take", () => {
    const parsed = parseGoogleAdminConnectArgs({ rest: ["--grant", "everything"] });
    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed).message).toBe(
      "unknown --grant: everything (expected all | directory | reports | chrome | cloud-identity | vault)",
    );
  });

  it("puts the usage block after the reason, so a refusal reads as a correction", () => {
    const parsed = parseGoogleAdminConnectArgs({ rest: ["--grant", "everything"] });
    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed).usage).toBe(GOOGLE_ADMIN_CONNECT_USAGE);
  });

  it("reads --status, which is the path that opens no browser and no socket", () => {
    const parsed = parseGoogleAdminConnectArgs({ rest: ["--status"] });
    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed).statusOnly).toBe(true);
    expect(unwrap(parsed).json).toBe(false);
  });

  it("reads --home and --json together", () => {
    const parsed = parseGoogleAdminConnectArgs({ rest: ["--home", "/tmp/example-home", "--json"] });
    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed).home).toBe("/tmp/example-home");
    expect(unwrap(parsed).json).toBe(true);
  });

  it("leaves home undefined when the flag is absent, so the caller resolves the ambient one", () => {
    const parsed = parseGoogleAdminConnectArgs({ rest: [] });
    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed).home).toBeUndefined();
  });

  it("refuses an unknown flag rather than ignoring it", () => {
    const parsed = parseGoogleAdminConnectArgs({ rest: ["--force"] });
    expect(unwrapErr(parsed).message).toBe("unknown flag: --force");
  });
});

describe("--without, the flag Google's own refusal put here", () => {
  it("drops the named capability and keeps every other one", () => {
    const parsed = parseGoogleAdminConnectArgs({ rest: ["--without", "identity-devices"] });
    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed).capabilities).toHaveLength(GOOGLE_ADMIN_CAPABILITIES.length - 1);
    expect(unwrap(parsed).capabilities).not.toContain("identity-devices");
  });

  it("keeps the account binding, which is what names the grant", () => {
    const parsed = parseGoogleAdminConnectArgs({ rest: ["--without", "identity-devices"] });
    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed).capabilities).toContain("identity");
  });

  it("drops several at once", () => {
    const parsed = parseGoogleAdminConnectArgs({ rest: ["--without", "identity-devices,vault-ediscovery"] });
    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed).capabilities).toHaveLength(GOOGLE_ADMIN_CAPABILITIES.length - 2);
  });

  it("tolerates the spaces a person pastes around a comma", () => {
    const parsed = parseGoogleAdminConnectArgs({ rest: ["--without", " identity-devices , vault-ediscovery "] });
    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed).capabilities).toHaveLength(GOOGLE_ADMIN_CAPABILITIES.length - 2);
  });

  it("narrows a narrow grant too", () => {
    const parsed = parseGoogleAdminConnectArgs({
      rest: ["--grant", "cloud-identity", "--without", "identity-devices"],
    });
    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed).capabilities).toStrictEqual([
      "identity-allowlisted-domains",
      "identity-groups",
      "identity-inbound-sso",
      "identity-policies",
    ]);
  });

  it("refuses a capability name that does not exist rather than ignoring it", () => {
    const parsed = parseGoogleAdminConnectArgs({ rest: ["--without", "devices"] });
    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed).message).toContain("unknown --without capability: devices");
  });

  it("refuses to drop the account binding, and says what it is for", () => {
    const parsed = parseGoogleAdminConnectArgs({ rest: ["--without", "identity"] });
    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed).message).toContain("what binds the grant to an account");
    expect(unwrapErr(parsed)).toEqual(GoogleAdminErrors.identityExcluded({ usage: GOOGLE_ADMIN_CONNECT_USAGE }));
  });

  it("refuses an exclusion that would leave nothing to consent to", () => {
    const parsed = parseGoogleAdminConnectArgs({ rest: ["--grant", "vault", "--without", "vault-ediscovery"] });
    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed).message).toContain("nothing to consent to");
    expect(unwrapErr(parsed)).toEqual(
      GoogleAdminErrors.nothingToConsent({ grant: "vault", usage: GOOGLE_ADMIN_CONNECT_USAGE }),
    );
  });
});

describe("the help-truth contract", () => {
  it("has at least one entry in GOOGLE_ADMIN_CONNECT_FLAG_NAMES, so the guards below are not vacuously green", () => {
    expect(GOOGLE_ADMIN_CONNECT_FLAG_NAMES.length).toBeGreaterThan(0);
  });

  it("advertises exactly the flags the parser takes", () => {
    for (const flag of GOOGLE_ADMIN_CONNECT_FLAG_NAMES) {
      expect(GOOGLE_ADMIN_CONNECT_USAGE).toContain(flag);
    }
  });

  it("says plainly that nothing it requests can write", () => {
    expect(GOOGLE_ADMIN_CONNECT_USAGE).toContain("cannot approve a write");
  });

  it("explains what --without is for, since a reader meeting it has just hit a refused consent", () => {
    expect(GOOGLE_ADMIN_CONNECT_USAGE).toContain("Google refuses a WHOLE consent when one scope");
  });
});

describe("adminClientPair", () => {
  it("hands back the admin pair when it is configured and is a client of its own", () => {
    const pair = adminClientPair({
      adminClientId: "admin-client.apps.googleusercontent.com",
      adminClientSecret: "admin-secret",
      sharesUserDataClient: false,
    });
    expect(pair.isOk()).toBe(true);
    expect(unwrap(pair)).toStrictEqual({
      clientId: "admin-client.apps.googleusercontent.com",
      clientSecret: "admin-secret",
    });
  });

  it("refuses an admin id that names the user-data client", () => {
    const error = unwrapErr(
      adminClientPair({
        adminClientId: "shared-client.apps.googleusercontent.com",
        adminClientSecret: "a-second-secret-on-the-same-client",
        sharesUserDataClient: true,
      }),
    );
    expect(error.code).toBe("CREDENTIAL_UNREADABLE");
    expect(error.message).toContain("names the SAME OAuth client as `google-client-id`");
  });

  it("refuses a missing admin secret with the not-configured text, before comparing anything", () => {
    const error = unwrapErr(
      adminClientPair({
        adminClientId: "admin-client.apps.googleusercontent.com",
        adminClientSecret: undefined,
        sharesUserDataClient: true,
      }),
    );
    expect(error.message).toBe(adminClientAbsent().message);
  });
});

describe("googleAdminConnectErrorLines", () => {
  it("prints the tokeniser's list as that list, one record per reason, and leaves the usage to the caller", () => {
    const reasons = ["unknown flag: --force", "unexpected argument: extra"];
    const error = GoogleAdminErrors.flagsInvalid({ reasons, usage: GOOGLE_ADMIN_CONNECT_USAGE });
    expect(googleAdminConnectErrorLines({ error })).toEqual(reasons);
    expect(error.message).toBe("unknown flag: --force\nunexpected argument: extra");
  });

  it("prints every other refusal as its one message", () => {
    expect(
      googleAdminConnectErrorLines({
        error: GoogleAdminErrors.nothingToConsent({ grant: "vault", usage: GOOGLE_ADMIN_CONNECT_USAGE }),
      }),
    ).toEqual([
      "--without excluded every capability --grant vault would have requested, so there is nothing to consent to",
    ]);
  });
});
