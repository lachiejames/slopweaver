/**
 * Binding the Drive SDK to a stored grant, in an explicit temp home with no network call: an empty home is
 * NOT_CONNECTED, the metadata/content line is drawn (a content grant satisfies a metadata verb, a metadata
 * grant is SCOPE_MISSING for a content one), a grant with no OAuth client configured is CREDENTIAL_UNREADABLE,
 * and a complete one yields a Drive v3 surface whose refreshed token is written back to the same home.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { drive_v3 } from "@googleapis/drive";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { resolveDriveClient } from "../../../../live/drive/client.js";
import { DriveErrors } from "../../../../live/drive/errors.js";
import { driveGrantStore } from "../../../../secrets/driveGrant.js";
import { secretFilePath } from "../../../../stateHome.js";

const METADATA = "https://www.googleapis.com/auth/drive.metadata.readonly";
const CONTENT = "https://www.googleapis.com/auth/drive.readonly";
const ENV_NAMES = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"] as const;

let home: string;
const savedEnv = new Map<string, string | undefined>();

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "drive-client-"));
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

/** Store a Drive grant carrying exactly these scopes. */
function storeGrant({ scopes }: { scopes: readonly string[] }): void {
  unwrap(
    driveGrantStore.write({
      grant: { account: "owner@example.com", grantedAtIso: "2026-10-01T00:00:00.000Z", refreshToken: "rt-1", scopes },
      home,
    }),
  );
}

/** Configure the user-data OAuth client id and secret as home secret files. */
function storeClient(): void {
  for (const [name, value] of [
    ["google-client-id", "client-id"],
    ["google-client-secret", "client-secret"],
  ] as const) {
    const path = secretFilePath({ home, name });
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, value, { mode: 0o600 });
  }
}

describe("resolveDriveClient", () => {
  it("is NOT_CONNECTED on a home with no Drive grant, naming the connect verb", () => {
    const error = unwrapErr(resolveDriveClient({ capabilities: ["metadata"], home }));

    expect(error.code).toBe("NOT_CONNECTED");
    expect(error.message).toBe("no Google Drive grant stored for this home — run `slopweaver drive connect`");
    expect(error).toEqual(DriveErrors.notConnected());
  });

  it("is SCOPE_MISSING naming drive.readonly for a content verb on a metadata grant, but admits a metadata verb on a content grant", () => {
    storeGrant({ scopes: [METADATA] });
    const error = unwrapErr(resolveDriveClient({ capabilities: ["content"], home }));

    expect(error.code).toBe("SCOPE_MISSING");
    expect(error).toEqual(DriveErrors.scopeMissing({ missing: [CONTENT] }));

    storeGrant({ scopes: [CONTENT] });
    storeClient();
    expect(unwrap(resolveDriveClient({ capabilities: ["metadata"], home })).scopes).toEqual([CONTENT]);
  });

  it("is CREDENTIAL_UNREADABLE when the grant is fine but no OAuth client is configured", () => {
    storeGrant({ scopes: [METADATA] });

    const error = unwrapErr(resolveDriveClient({ capabilities: ["metadata"], home }));

    expect(error.code).toBe("CREDENTIAL_UNREADABLE");
    expect(error.message).toBe(
      "the Google OAuth client id/secret are not configured — run `slopweaver secrets set google-client-id` " +
        "and `slopweaver secrets set google-client-secret`",
    );
  });

  it("binds a Drive v3 surface to the grant's account, scopes and refresh credential", () => {
    storeGrant({ scopes: [METADATA] });
    storeClient();

    const bound = unwrap(resolveDriveClient({ capabilities: ["metadata"], home }));

    expect(bound.account).toBe("owner@example.com");
    expect(bound.scopes).toEqual([METADATA]);
    expect(bound.auth.credentials).toEqual({ refresh_token: "rt-1" });
    expect(bound.client).toBeInstanceOf(drive_v3.Drive);
    // googleapis declares the bound auth on its request context's `_options`; matched structurally rather
    // than read as a member, so this pins the binding without reaching past the typed surface.
    expect(bound.client.context).toMatchObject({ _options: { auth: bound.auth } });
  });

  it("writes a refreshed access token back to the same home's Drive grant", () => {
    storeGrant({ scopes: [METADATA] });
    storeClient();
    const bound = unwrap(resolveDriveClient({ capabilities: ["metadata"], home }));

    bound.auth.emit("tokens", { access_token: "at-2", expiry_date: 1_800_000_000_000 });

    expect(unwrap(driveGrantStore.read({ home }))).toEqual({
      accessToken: "at-2",
      account: "owner@example.com",
      expiryMs: 1_800_000_000_000,
      grantedAtIso: "2026-10-01T00:00:00.000Z",
      refreshToken: "rt-1",
      scopes: [METADATA],
    });
  });
});
