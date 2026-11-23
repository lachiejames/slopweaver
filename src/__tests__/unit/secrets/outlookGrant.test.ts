/**
 * The Outlook grant round-trips through its owner-only file, refuses a file that is not its shape, and never
 * lets its MSAL cache into a status view.
 */
import { mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";

import {
  type OutlookGrant,
  outlookGrantPath,
  outlookGrantStatus,
  readOutlookGrant,
  removeOutlookGrant,
  writeOutlookGrant,
} from "../../../secrets/outlookGrant.js";

const homes: string[] = [];

/** A fresh state home for one test. */
function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "outlook-grant-"));
  homes.push(home);
  return home;
}

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

const GRANT: OutlookGrant = {
  account: "owner@example.com",
  grantedAtIso: "2026-10-17T00:00:00.000Z",
  homeAccountId: "uid.tid",
  msalCache: '{"RefreshToken":{"k":{"secret":"synthetic-refresh"}}}',
  scopes: ["User.Read", "Mail.ReadWrite", "Mail.Send"],
};

describe("the Outlook grant store", () => {
  it("reads nothing from a home that was never connected", () => {
    expect(unwrap(readOutlookGrant({ home: freshHome() }))).toBe(undefined);
  });

  it("writes the grant 0600 and reads it back whole", () => {
    const home = freshHome();
    const path = unwrap(writeOutlookGrant({ grant: GRANT, home }));

    expect(path).toBe(outlookGrantPath({ home }));
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(unwrap(readOutlookGrant({ home }))).toStrictEqual(GRANT);
  });

  it("refuses a stored file that is not an Outlook grant, naming the connect verb", () => {
    const home = freshHome();
    unwrap(writeOutlookGrant({ grant: GRANT, home }));
    writeFileSync(outlookGrantPath({ home }), JSON.stringify({ account: "a", refreshToken: "r" }));

    expect(unwrapErr(readOutlookGrant({ home })).join("\n")).toContain("slopweaver outlook connect");
  });

  it("refuses a grant path it cannot read rather than reporting the door not connected", () => {
    const home = freshHome();
    mkdirSync(outlookGrantPath({ home }), { recursive: true });

    const refused = unwrapErr(readOutlookGrant({ home })).join("\n");

    expect(refused).toContain(`could not read the Outlook grant at ${outlookGrantPath({ home })}`);
    expect(refused).toContain("EISDIR");
  });

  it("refuses a grant path that is a dangling symlink rather than reporting the door not connected", () => {
    const home = freshHome();
    unwrap(writeOutlookGrant({ grant: GRANT, home }));
    const path = outlookGrantPath({ home });
    unlinkSync(path);
    symlinkSync(join(home, "gone.json"), path);

    const refused = unwrapErr(readOutlookGrant({ home })).join("\n");

    expect(refused).toContain(`could not read the Outlook grant at ${path}`);
    expect(refused).toContain("ENOENT");
  });

  it("reads a grant path with no entry at all as not connected", () => {
    expect(unwrap(readOutlookGrant({ home: freshHome() }))).toBeUndefined();
  });

  it("keeps the MSAL cache out of the status view", () => {
    const home = freshHome();
    const status = outlookGrantStatus({ grant: GRANT, home });

    expect(status).toStrictEqual({
      account: "owner@example.com",
      grantedAtIso: "2026-10-17T00:00:00.000Z",
      path: outlookGrantPath({ home }),
      scopes: ["User.Read", "Mail.ReadWrite", "Mail.Send"],
    });
    expect(JSON.stringify(status)).not.toContain("synthetic-refresh");
  });

  it("removes the local grant", () => {
    const home = freshHome();
    unwrap(writeOutlookGrant({ grant: GRANT, home }));
    unwrap(removeOutlookGrant({ home }));

    expect(unwrap(readOutlookGrant({ home }))).toBe(undefined);
  });
});
