/**
 * Unit: the Calendar door's own binding of the shared consent shell — the three facts that are this door's
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
import { CALENDAR_DOOR, productionCalendarConnectDeps } from "../../../../../cli/commands/calendar/connectRun.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { CALENDAR_SCOPES } from "../../../../../live/calendar/scopes.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A state home with no secrets in it at all — the shape a fresh install has. */
function emptyHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-calendar-connect-"));
  fixtureDirs.push(dir);
  return dir;
}

describe("CALENDAR_DOOR", () => {
  it("names the verb that re-establishes its own grant, not another Google door's", () => {
    expect(CALENDAR_DOOR.connectVerb).toBe("slopweaver calendar connect");
    expect(CALENDAR_DOOR.noun).toBe("calendar");
  });

  it("carries the CALENDAR scope table, so consent asks for calendar scopes rather than mail or Drive ones", () => {
    expect(CALENDAR_DOOR.scopeTable.scopes.events).toBe(CALENDAR_SCOPES.events);
    expect(CALENDAR_DOOR.scopeTable.scopes.calendars).toBe(CALENDAR_SCOPES.calendars);
  });

  it("treats the wider calendar.readonly as satisfying an events requirement, and never the reverse", () => {
    expect(CALENDAR_DOOR.scopeTable.impliedBy.events).toStrictEqual([CALENDAR_SCOPES.calendars]);
    expect(CALENDAR_DOOR.scopeTable.impliedBy.calendars).toStrictEqual([]);
  });

  it("names a consent failure in its own domain's vocabulary", () => {
    expect(CALENDAR_DOOR.consentFailed({ message: "the window closed" }).code).toBe("CONSENT_FAILED");
  });
});

describe("productionCalendarConnectDeps", () => {
  it("REFUSES before opening a socket when no OAuth client is configured, naming both commands", async () => {
    const result = await productionCalendarConnectDeps().consent({
      home: emptyHome(),
      scopes: [CALENDAR_SCOPES.events],
    });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).code).toBe("CREDENTIAL_UNREADABLE");
    expect(unwrapErr(result).message).toContain("slopweaver secrets set google-client-id");
    expect(unwrapErr(result).message).toContain("slopweaver secrets set google-client-secret");
  });

  it("names the Calendar API in that refusal, because enabling it is a separate step from the client", async () => {
    const result = await productionCalendarConnectDeps().consent({
      home: emptyHome(),
      scopes: [CALENDAR_SCOPES.events],
    });
    expect(unwrapErr(result).message).toContain("Calendar API enabled");
  });

  it("reports a home with no grant as not connected rather than as an error", () => {
    expect(unwrap(productionCalendarConnectDeps().status({ home: emptyHome() }))).toBe(undefined);
  });

  it("writes the grant to the CALENDAR file, never another Google door's", () => {
    const home = emptyHome();
    const written = productionCalendarConnectDeps().persist({
      grant: {
        account: "me@example.test",
        grantedAtIso: "2026-09-05T12:00:00.000Z",
        refreshToken: "1//rt",
        scopes: [CALENDAR_SCOPES.events],
      },
      home,
    });
    expect(unwrap(written).endsWith("/secrets/calendar-oauth.json")).toBe(true);
    expect(unwrap(productionCalendarConnectDeps().status({ home }))!.account).toBe("me@example.test");
  });
});
