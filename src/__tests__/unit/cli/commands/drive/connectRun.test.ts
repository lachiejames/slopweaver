/**
 * Unit: the Drive door's own binding of the shared consent shell — the three facts that are this door's
 * and not the shell's, plus the refusal that must happen BEFORE a socket or a browser is opened.
 *
 * The shell's own behaviour is covered in `../google/connectShell.test.ts`; what is asserted here is the
 * wiring, because a door bound to the wrong scope table or the wrong grant file would pass every one of
 * those tests and still consent to the wrong thing.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DRIVE_DOOR, productionDriveConnectDeps } from "../../../../../cli/commands/drive/connectRun.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { DRIVE_SCOPES } from "../../../../../live/drive/scopes.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A state home with no secrets in it at all — the shape a fresh install has. */
function emptyHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-drive-connect-"));
  fixtureDirs.push(dir);
  return dir;
}

describe("DRIVE_DOOR", () => {
  it("names the verb that re-establishes its own grant, not the mail door's", () => {
    expect(DRIVE_DOOR.connectVerb).toBe("slopweaver drive connect");
    expect(DRIVE_DOOR.noun).toBe("drive");
  });

  it("carries the DRIVE scope table, so consent asks for Drive scopes rather than mail ones", () => {
    expect(DRIVE_DOOR.scopeTable.scopes.content).toBe(DRIVE_SCOPES.content);
    expect(DRIVE_DOOR.scopeTable.scopes.metadata).toBe(DRIVE_SCOPES.metadata);
  });

  it("names a consent failure in its own domain's vocabulary", () => {
    expect(DRIVE_DOOR.consentFailed({ message: "the window closed" }).code).toBe("CONSENT_FAILED");
  });
});

describe("productionDriveConnectDeps", () => {
  it("REFUSES before opening a socket when no OAuth client is configured, naming both commands", async () => {
    const result = await productionDriveConnectDeps().consent({
      home: emptyHome(),
      scopes: [DRIVE_SCOPES.metadata],
    });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).code).toBe("CREDENTIAL_UNREADABLE");
    expect(unwrapErr(result).message).toContain("slopweaver secrets set google-client-id");
    expect(unwrapErr(result).message).toContain("slopweaver secrets set google-client-secret");
  });

  it("reports a home with no grant as not connected rather than as an error", () => {
    expect(unwrap(productionDriveConnectDeps().status({ home: emptyHome() }))).toBe(undefined);
  });

  it("writes the grant to the DRIVE file, never the mail door's", () => {
    const home = emptyHome();
    const written = productionDriveConnectDeps().persist({
      grant: {
        account: "me@example.test",
        grantedAtIso: "2026-09-05T12:00:00.000Z",
        refreshToken: "1//rt",
        scopes: [DRIVE_SCOPES.metadata],
      },
      home,
    });
    expect(unwrap(written).endsWith("/secrets/drive-oauth.json")).toBe(true);
    expect(unwrap(productionDriveConnectDeps().status({ home }))!.account).toBe("me@example.test");
  });
});
