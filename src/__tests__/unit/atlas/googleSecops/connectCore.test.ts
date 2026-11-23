/**
 * Unit: `atlas google-secops connect`'s pure argument handling, and the client pair it consents through.
 */
import { describe, expect, it } from "vitest";

import {
  GOOGLE_SECOPS_CONNECT_FLAG_NAMES,
  GOOGLE_SECOPS_CONNECT_USAGE,
  parseGoogleSecopsConnectArgs,
} from "../../../../cli/commands/atlas/googleSecops/connectCore.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { secopsClientAbsent, secopsClientPair } from "../../../../live/googleSecops/client.js";
import { secopsScopesOutsideTable } from "../../../../live/googleSecops/scopes.js";

describe("parseGoogleSecopsConnectArgs", () => {
  it("asks for the one capability this door has, whatever else the tail says", () => {
    expect(unwrap(parseGoogleSecopsConnectArgs({ rest: [] }))).toStrictEqual({
      capabilities: ["chronicle"],
      home: undefined,
      json: false,
      revoke: false,
      statusOnly: false,
    });
  });

  it("reads --status, --json and --home together", () => {
    const parsed = unwrap(parseGoogleSecopsConnectArgs({ rest: ["--status", "--json", "--home", "/tmp/h"] }));
    expect(parsed.statusOnly).toBe(true);
    expect(parsed.json).toBe(true);
    expect(parsed.home).toBe("/tmp/h");
  });

  it("reads --revoke", () => {
    expect(unwrap(parseGoogleSecopsConnectArgs({ rest: ["--revoke"] })).revoke).toBe(true);
  });

  it("refuses --grant, because there is nothing to narrow and a wider scope is never a flag", () => {
    expect(unwrapErr(parseGoogleSecopsConnectArgs({ rest: ["--grant", "all"] }))).toStrictEqual([
      "unknown flag: --grant",
      "unexpected argument: all",
      GOOGLE_SECOPS_CONNECT_USAGE,
    ]);
  });
});

describe("the help-truth contract", () => {
  it("has at least one flag name, so the guard below is not vacuously green", () => {
    expect(GOOGLE_SECOPS_CONNECT_FLAG_NAMES.length).toBeGreaterThan(0);
  });

  it("advertises exactly the flags the parser takes", () => {
    const missing = GOOGLE_SECOPS_CONNECT_FLAG_NAMES.filter((flag) => !GOOGLE_SECOPS_CONNECT_USAGE.includes(flag));
    expect(missing).toStrictEqual([]);
  });

  it("says plainly that its consent screen cannot approve a write", () => {
    expect(GOOGLE_SECOPS_CONNECT_USAGE).toContain("cannot approve a write");
  });
});

describe("secopsScopesOutsideTable", () => {
  it("passes exactly what the door asks for, plus the openid Google adds beside an email scope", () => {
    expect(
      secopsScopesOutsideTable({
        scopes: [
          "openid",
          "https://www.googleapis.com/auth/userinfo.email",
          "https://www.googleapis.com/auth/chronicle.readonly",
        ],
      }),
    ).toStrictEqual([]);
  });

  it("names a READ scope wider than the table, which the shell's write check alone would store", () => {
    expect(
      secopsScopesOutsideTable({
        scopes: [
          "https://www.googleapis.com/auth/chronicle.readonly",
          "https://www.googleapis.com/auth/cloud-platform.read-only",
          "https://www.googleapis.com/auth/drive.readonly",
        ],
      }),
    ).toStrictEqual([
      "https://www.googleapis.com/auth/cloud-platform.read-only",
      "https://www.googleapis.com/auth/drive.readonly",
    ]);
  });
});

describe("secopsClientPair", () => {
  it("hands back the SecOps pair when it is configured and is a client of its own", () => {
    const pair = secopsClientPair({
      clientId: "secops-client.apps.googleusercontent.com",
      clientSecret: "secops-secret",
      sharesAnotherClient: false,
    });
    expect(unwrap(pair)).toStrictEqual({
      clientId: "secops-client.apps.googleusercontent.com",
      clientSecret: "secops-secret",
    });
  });

  it("refuses an id that names the admin or user-data client, so a consent cannot merge into its grant", () => {
    const error = unwrapErr(
      secopsClientPair({
        clientId: "shared-client.apps.googleusercontent.com",
        clientSecret: "a-second-secret-on-the-same-client",
        sharesAnotherClient: true,
      }),
    );
    expect(error.code).toBe("CREDENTIAL_UNREADABLE");
    expect(error.message).toContain("names the SAME OAuth client as `google-client-id` or `google-admin-client-id`");
  });

  it("refuses a missing secret with the not-configured text, before comparing anything", () => {
    const error = unwrapErr(
      secopsClientPair({
        clientId: "secops-client.apps.googleusercontent.com",
        clientSecret: undefined,
        sharesAnotherClient: true,
      }),
    );
    expect(error.message).toBe(secopsClientAbsent().message);
  });
});
