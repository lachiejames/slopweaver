/**
 * Binding the Google Admin door to a stored grant, in an explicit temp home with no network call: an empty
 * home is NOT_CONNECTED, a grant file that will not parse or lacks its fields is CREDENTIAL_UNREADABLE naming
 * why, a grant missing a requested capability is SCOPE_MISSING before any OAuth client is looked for, a grant
 * with no ADMIN client configured is CREDENTIAL_UNREADABLE naming the admin pair, and a complete one yields an
 * OAuth client on the grant's own refresh credential.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { resolveGoogleAdminClient } from "../../../../live/googleAdmin/client.js";
import { GoogleAdminDoorErrors } from "../../../../live/googleAdmin/errors.js";
import { googleAdminGrantStore } from "../../../../secrets/googleAdminGrant.js";
import { secretFilePath } from "../../../../stateHome.js";

const IDENTITY = "https://www.googleapis.com/auth/userinfo.email";
const USERS = "https://www.googleapis.com/auth/admin.directory.user.readonly";
const ENV_NAMES = ["GOOGLE_ADMIN_CLIENT_ID", "GOOGLE_ADMIN_CLIENT_SECRET"] as const;

let home: string;
const savedEnv = new Map<string, string | undefined>();

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "google-admin-client-"));
  for (const name of ENV_NAMES) {
    savedEnv.set(name, process.env[name]);
    delete process.env[name];
  }
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
  for (const name of ENV_NAMES) {
    const value = savedEnv.get(name);
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
});

/** Store an Admin grant carrying exactly these scopes. */
function storeGrant({ scopes }: { scopes: readonly string[] }): void {
  unwrap(
    googleAdminGrantStore.write({
      grant: { account: "admin@example.com", grantedAtIso: "2026-10-01T00:00:00.000Z", refreshToken: "rt-1", scopes },
      home,
    }),
  );
}

/** Write raw bytes where the Admin grant lives. */
function writeRawGrant({ text }: { text: string }): void {
  const path = googleAdminGrantStore.path({ home });
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, { mode: 0o600 });
}

/** Configure the ADMIN OAuth client id and secret as home secret files. */
function storeAdminClient(): void {
  for (const [name, value] of [
    ["google-admin-client-id", "admin-client-id"],
    ["google-admin-client-secret", "admin-client-secret"],
  ] as const) {
    const path = secretFilePath({ home, name });
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, value, { mode: 0o600 });
  }
}

describe("resolveGoogleAdminClient", () => {
  it("is NOT_CONNECTED on a home with no Admin grant, naming the atlas connect verb", () => {
    const error = unwrapErr(resolveGoogleAdminClient({ capabilities: ["directory-users"], home }));

    expect(error.code).toBe("NOT_CONNECTED");
    expect(error.message).toBe(
      "no Google Workspace Admin grant stored for this home — run `slopweaver atlas google-admin connect`",
    );
    expect(error).toEqual(GoogleAdminDoorErrors.notConnected());
  });

  it("is CREDENTIAL_UNREADABLE naming the parse failure when the stored grant is not JSON", () => {
    writeRawGrant({ text: "{not json" });

    const error = unwrapErr(resolveGoogleAdminClient({ capabilities: ["directory-users"], home }));

    expect(error.code).toBe("CREDENTIAL_UNREADABLE");
    expect(error.message).toContain("the stored Google Workspace Admin grant is not valid JSON");
  });

  it("is CREDENTIAL_UNREADABLE naming the missing fields when the stored grant has the wrong shape", () => {
    writeRawGrant({ text: '{"account":"admin@example.com"}' });

    const error = unwrapErr(resolveGoogleAdminClient({ capabilities: ["directory-users"], home }));

    expect(error.code).toBe("CREDENTIAL_UNREADABLE");
    expect(error.message).toBe(
      "the stored Google Workspace Admin grant is missing account, scopes or refreshToken, or holds a field of the " +
        "wrong shape — re-run " +
        "`slopweaver atlas google-admin connect`",
    );
  });

  it("is SCOPE_MISSING naming admin.directory.user.readonly before any OAuth client is looked for", () => {
    storeGrant({ scopes: [IDENTITY] });

    const error = unwrapErr(resolveGoogleAdminClient({ capabilities: ["identity", "directory-users"], home }));

    expect(error.code).toBe("SCOPE_MISSING");
    expect(error).toEqual(GoogleAdminDoorErrors.scopeMissing({ missing: [USERS] }));
    expect(error).toEqual({
      code: "SCOPE_MISSING",
      message:
        "the stored Google Workspace Admin grant is missing " +
        "https://www.googleapis.com/auth/admin.directory.user.readonly — re-run " +
        "`slopweaver atlas google-admin connect` and approve it",
      missing: ["https://www.googleapis.com/auth/admin.directory.user.readonly"],
    });
  });

  it("is CREDENTIAL_UNREADABLE naming the admin client pair when the grant is fine but no admin client is configured", () => {
    storeGrant({ scopes: [IDENTITY, USERS] });

    const error = unwrapErr(resolveGoogleAdminClient({ capabilities: ["directory-users"], home }));

    expect(error.code).toBe("CREDENTIAL_UNREADABLE");
    expect(error.message).toBe(
      "the Google Admin OAuth client id/secret are not configured — run `slopweaver secrets set " +
        "google-admin-client-id` and `slopweaver secrets set google-admin-client-secret`. This door has its " +
        "OWN client, separate from `google-client-id`, so that no admin consent can carry a write scope",
    );
  });

  it("binds an OAuth client to the grant's account, scopes and refresh credential", () => {
    storeGrant({ scopes: [IDENTITY, USERS] });
    storeAdminClient();

    const bound = unwrap(resolveGoogleAdminClient({ capabilities: ["directory-users"], home }));

    expect(bound.account).toBe("admin@example.com");
    expect(bound.scopes).toEqual([IDENTITY, USERS]);
    expect(bound.client.credentials).toEqual({ refresh_token: "rt-1" });
  });
});
