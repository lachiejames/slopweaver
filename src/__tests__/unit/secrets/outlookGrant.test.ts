/**
 * The two Outlook grants — mail and calendar — each round-trip through their own owner-only file, refuse a file
 * that is not their shape naming their own connect verb, and never let an MSAL cache into a status view.
 */
import { mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";

import { type OutlookGrant, outlookCalendarGrantStore, outlookMailGrantStore } from "../../../secrets/outlookGrant.js";

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

const CALENDAR_GRANT: OutlookGrant = { ...GRANT, scopes: ["User.Read", "Calendars.Read"] };

describe("the two Outlook grant stores", () => {
  it("binds each product to its own file, lock and connect verb", () => {
    const home = "/home/fixture";

    expect(outlookMailGrantStore.path({ home })).toBe("/home/fixture/secrets/outlook-oauth.json");
    expect(outlookCalendarGrantStore.path({ home })).toBe("/home/fixture/secrets/outlook-calendar-oauth.json");
    expect([outlookMailGrantStore.lockKey, outlookCalendarGrantStore.lockKey]).toEqual([
      "outlook-grant-refresh",
      "outlook-calendar-grant-refresh",
    ]);
    expect([outlookMailGrantStore.connectVerb, outlookCalendarGrantStore.connectVerb]).toEqual([
      "slopweaver outlook connect",
      "slopweaver outlook-calendar connect",
    ]);
    expect([outlookMailGrantStore.product, outlookCalendarGrantStore.product]).toEqual(["mail", "calendar"]);
  });

  it("keeps the two grants apart: writing one leaves the other unconnected", () => {
    const home = freshHome();
    unwrap(outlookCalendarGrantStore.write({ grant: CALENDAR_GRANT, home }));

    expect(unwrap(outlookMailGrantStore.read({ home }))).toBe(undefined);
    expect(unwrap(outlookCalendarGrantStore.read({ home }))).toStrictEqual(CALENDAR_GRANT);
  });
});

describe("the Outlook mail grant store", () => {
  it("reads nothing from a home that was never connected", () => {
    expect(unwrap(outlookMailGrantStore.read({ home: freshHome() }))).toBe(undefined);
  });

  it("writes the grant 0600 and reads it back whole", () => {
    const home = freshHome();
    const path = unwrap(outlookMailGrantStore.write({ grant: GRANT, home }));

    expect(path).toBe(outlookMailGrantStore.path({ home }));
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(unwrap(outlookMailGrantStore.read({ home }))).toStrictEqual(GRANT);
  });

  it("refuses a stored file that is not an Outlook grant, naming the connect verb", () => {
    const home = freshHome();
    unwrap(outlookMailGrantStore.write({ grant: GRANT, home }));
    writeFileSync(outlookMailGrantStore.path({ home }), JSON.stringify({ account: "a", refreshToken: "r" }));

    expect(unwrapErr(outlookMailGrantStore.read({ home })).join("\n")).toContain("slopweaver outlook connect");
  });

  it("refuses a grant path it cannot read rather than reporting the door not connected", () => {
    const home = freshHome();
    mkdirSync(outlookMailGrantStore.path({ home }), { recursive: true });

    const refused = unwrapErr(outlookMailGrantStore.read({ home })).join("\n");

    expect(refused).toContain(`could not read the Outlook grant at ${outlookMailGrantStore.path({ home })}`);
    expect(refused).toContain("EISDIR");
  });

  it("refuses a grant path that is a dangling symlink rather than reporting the door not connected", () => {
    const home = freshHome();
    unwrap(outlookMailGrantStore.write({ grant: GRANT, home }));
    const path = outlookMailGrantStore.path({ home });
    unlinkSync(path);
    symlinkSync(join(home, "gone.json"), path);

    const refused = unwrapErr(outlookMailGrantStore.read({ home })).join("\n");

    expect(refused).toContain(`could not read the Outlook grant at ${path}`);
    expect(refused).toContain("ENOENT");
  });

  it("keeps the MSAL cache out of the status view", () => {
    const home = freshHome();
    const status = outlookMailGrantStore.status({ grant: GRANT, home });

    expect(status).toStrictEqual({
      account: "owner@example.com",
      grantedAtIso: "2026-10-17T00:00:00.000Z",
      path: outlookMailGrantStore.path({ home }),
      scopes: ["User.Read", "Mail.ReadWrite", "Mail.Send"],
    });
    expect(JSON.stringify(status)).not.toContain("synthetic-refresh");
  });

  it("removes the local grant", () => {
    const home = freshHome();
    unwrap(outlookMailGrantStore.write({ grant: GRANT, home }));
    unwrap(outlookMailGrantStore.remove({ home }));

    expect(unwrap(outlookMailGrantStore.read({ home }))).toBe(undefined);
  });
});

describe("the Outlook calendar grant store", () => {
  it("refuses a stored file that is not an Outlook grant, naming the calendar's own connect verb", () => {
    const home = freshHome();
    unwrap(outlookCalendarGrantStore.write({ grant: CALENDAR_GRANT, home }));
    writeFileSync(outlookCalendarGrantStore.path({ home }), JSON.stringify({ account: "a", refreshToken: "r" }));

    const refused = unwrapErr(outlookCalendarGrantStore.read({ home })).join("\n");

    expect(refused).toContain("slopweaver outlook-calendar connect");
    expect(refused).not.toContain("slopweaver outlook connect");
  });

  it("removes only its own grant", () => {
    const home = freshHome();
    unwrap(outlookMailGrantStore.write({ grant: GRANT, home }));
    unwrap(outlookCalendarGrantStore.write({ grant: CALENDAR_GRANT, home }));
    unwrap(outlookCalendarGrantStore.remove({ home }));

    expect(unwrap(outlookCalendarGrantStore.read({ home }))).toBe(undefined);
    expect(unwrap(outlookMailGrantStore.read({ home }))).toStrictEqual(GRANT);
  });
});
