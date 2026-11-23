/**
 * Unit: the SecOps door's own grant file, its declared door vocabulary, and the refusal texts its read code raises.
 */
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { GOOGLE_SECOPS_DOOR } from "../../../../cli/commands/atlas/googleSecops/connectRun.js";
import { unwrap } from "../../../../lib/result.js";
import { GoogleSecopsDoorErrors, GoogleSecopsReadErrors } from "../../../../live/googleSecops/errors.js";
import { GOOGLE_SECOPS_SCOPE_TABLE } from "../../../../live/googleSecops/scopes.js";
import { googleSecopsGrantStore } from "../../../../secrets/googleSecopsGrant.js";

const homes: string[] = [];

/** A throwaway state home this file owns and removes. */
function scratchHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-secops-grant-"));
  homes.push(home);
  return home;
}

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

const GRANT = {
  account: "someone@example.com",
  grantedAtIso: "2026-10-02T00:00:00.000Z",
  refreshToken: "refresh-token-fixture",
  scopes: ["https://www.googleapis.com/auth/userinfo.email", "https://www.googleapis.com/auth/chronicle.readonly"],
} as const;

describe("googleSecopsGrantStore", () => {
  it("writes its own owner-only file and reads the same grant back", () => {
    const home = scratchHome();
    const path = unwrap(googleSecopsGrantStore.write({ grant: GRANT, home }));
    expect(path).toBe(join(home, "secrets", "google-secops-oauth.json"));
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(unwrap(googleSecopsGrantStore.read({ home }))).toStrictEqual(GRANT);
  });

  it("reads nothing from a home that never connected", () => {
    expect(unwrap(googleSecopsGrantStore.read({ home: scratchHome() }))).toBe(undefined);
  });
});

describe("GOOGLE_SECOPS_DOOR", () => {
  it("is read-only, names its own connect verb, and carries the two-scope table", () => {
    expect(GOOGLE_SECOPS_DOOR.readOnly).toBe(true);
    expect(GOOGLE_SECOPS_DOOR.connectVerb).toBe("slopweaver atlas google-secops connect");
    expect(GOOGLE_SECOPS_DOOR.scopeTable).toBe(GOOGLE_SECOPS_SCOPE_TABLE);
  });
});

describe("the SecOps error factories", () => {
  it("names the connect verb when no grant is stored", () => {
    expect(GoogleSecopsDoorErrors.notConnected().message).toContain("slopweaver atlas google-secops connect");
  });

  it("says which host was refused and which one the door reads", () => {
    const error = GoogleSecopsReadErrors.hostRefused({
      expected: "https://australia-southeast1-chronicle.googleapis.com",
      origin: "https://example.com",
    });
    expect(error.code).toBe("HOST_REFUSED");
    expect(error.message).toBe(
      "refused https://example.com: this door reads https://australia-southeast1-chronicle.googleapis.com and no other host",
    );
  });

  it("carries Google's status on a failed call, and null when none was reached", () => {
    expect(GoogleSecopsReadErrors.transportFailed({ message: "forbidden", status: 403 }).status).toBe(403);
    expect(GoogleSecopsReadErrors.transportFailed({ message: "reset", status: null }).status).toBe(null);
  });
});
