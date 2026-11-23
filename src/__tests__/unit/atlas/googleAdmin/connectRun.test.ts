/**
 * The REAL `atlas google-admin connect` verb, with its production seams, over a temporary home — on every path
 * that never opens a browser or a socket: `--status`, the flag refusals, and a `--revoke` the missing admin client
 * must refuse before anything is sent to Google. The consent round trip itself is the shared shell's, covered with
 * this door's own vocabulary in `cli/commands/google/connectShellReadOnly.test.ts`.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap } from "#lib/result.js";
import { runGoogleAdminConnect } from "../../../../cli/commands/atlas/googleAdmin/connectRun.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../cli/exitCodes.js";
import { googleAdminGrantStore } from "../../../../secrets/googleAdminGrant.js";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "google-admin-connect-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** The argv the runtime hands this verb: runtime, script, noun, platform, verb, then the flags. */
const argv = (...flags: string[]): readonly string[] => [
  "node",
  "slopweaver",
  "atlas",
  "google-admin",
  "connect",
  ...flags,
];

describe("runGoogleAdminConnect", () => {
  it("reports NOT connected as an expected-empty status when this home holds no grant", async () => {
    expect(await runGoogleAdminConnect(argv("--status", "--home", home))).toBe(EXIT_EXPECTED_EMPTY);
  });

  it("reports a stored grant as connected, read from this door's own grant file", async () => {
    const path = unwrap(
      googleAdminGrantStore.write({
        grant: {
          account: "admin@example.test",
          grantedAtIso: "2026-10-01T12:00:00.000Z",
          refreshToken: "1//rt",
          scopes: ["https://www.googleapis.com/auth/admin.directory.user.readonly"],
        },
        home,
      }),
    );

    expect(path).toBe(join(home, "secrets", "google-admin-oauth.json"));
    expect(await runGoogleAdminConnect(argv("--status", "--json", "--home", home))).toBe(EXIT_OK);
  });

  it("refuses --status with --revoke as a usage error, since one reports the grant and the other destroys it", async () => {
    expect(await runGoogleAdminConnect(argv("--status", "--revoke", "--home", home))).toBe(EXIT_USAGE);
  });

  it("refuses an unknown flag as a usage error", async () => {
    expect(await runGoogleAdminConnect(argv("--write", "--home", home))).toBe(EXIT_USAGE);
  });

  it("refuses --revoke when this home has no admin OAuth client, before any request reaches Google", async () => {
    expect(await runGoogleAdminConnect(argv("--revoke", "--home", home))).toBe(EXIT_ERROR);
  });
});
