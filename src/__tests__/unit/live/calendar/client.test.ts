/**
 * Binding the Calendar SDK to a stored grant, in an explicit temp home with no network call: an empty home is
 * NOT_CONNECTED, a grant without the scope a verb needs is SCOPE_MISSING naming that scope, a grant with no
 * OAuth client configured is CREDENTIAL_UNREADABLE, and a complete one yields a Calendar v3 surface on the
 * grant's own refresh credential whose refreshed token is written back to the same home.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { calendar_v3 } from "@googleapis/calendar";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { resolveCalendarClient } from "../../../../live/calendar/client.js";
import { CalendarErrors } from "../../../../live/calendar/errors.js";
import { calendarGrantStore } from "../../../../secrets/calendarGrant.js";
import { secretFilePath } from "../../../../stateHome.js";

const EVENTS = "https://www.googleapis.com/auth/calendar.events.readonly";
const CALENDARS = "https://www.googleapis.com/auth/calendar.readonly";
const ENV_NAMES = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"] as const;

let home: string;
const savedEnv = new Map<string, string | undefined>();

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "calendar-client-"));
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

/** Store a Calendar grant carrying exactly these scopes. */
function storeGrant({ scopes }: { scopes: readonly string[] }): void {
  unwrap(
    calendarGrantStore.write({
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

describe("resolveCalendarClient", () => {
  it("is NOT_CONNECTED on a home with no Calendar grant, naming the connect verb", () => {
    const error = unwrapErr(resolveCalendarClient({ capabilities: ["events"], home }));

    expect(error.code).toBe("NOT_CONNECTED");
    expect(error.message).toBe("no Google Calendar grant stored for this home — run `slopweaver calendar connect`");
    expect(error).toEqual(CalendarErrors.notConnected());
  });

  it("is SCOPE_MISSING naming calendar.readonly when an events-only grant is asked to list calendars", () => {
    storeGrant({ scopes: [EVENTS] });

    const error = unwrapErr(resolveCalendarClient({ capabilities: ["calendars"], home }));

    expect(error.code).toBe("SCOPE_MISSING");
    expect(error).toEqual(CalendarErrors.scopeMissing({ missing: [CALENDARS] }));
  });

  it("is CREDENTIAL_UNREADABLE when the grant is fine but no OAuth client is configured", () => {
    storeGrant({ scopes: [EVENTS] });

    const error = unwrapErr(resolveCalendarClient({ capabilities: ["events"], home }));

    expect(error.code).toBe("CREDENTIAL_UNREADABLE");
    expect(error.message).toBe(
      "the Google OAuth client id/secret are not configured — run `slopweaver secrets set google-client-id` " +
        "and `slopweaver secrets set google-client-secret`",
    );
  });

  it("binds a Calendar v3 surface to the grant's account, scopes and refresh credential", () => {
    storeGrant({ scopes: [EVENTS] });
    storeClient();

    const bound = unwrap(resolveCalendarClient({ capabilities: ["events"], home }));

    expect(bound.account).toBe("owner@example.com");
    expect(bound.scopes).toEqual([EVENTS]);
    expect(bound.auth.credentials).toEqual({ refresh_token: "rt-1" });
    expect(bound.client).toBeInstanceOf(calendar_v3.Calendar);
    // googleapis declares the bound auth on its request context's `_options`; matched structurally rather
    // than read as a member, so this pins the binding without reaching past the typed surface.
    expect(bound.client.context).toMatchObject({ _options: { auth: bound.auth } });
  });

  it("writes a refreshed access token back to the same home's Calendar grant", () => {
    storeGrant({ scopes: [EVENTS] });
    storeClient();
    const bound = unwrap(resolveCalendarClient({ capabilities: ["events"], home }));

    bound.auth.emit("tokens", { access_token: "at-2", expiry_date: 1_800_000_000_000 });

    expect(unwrap(calendarGrantStore.read({ home }))).toEqual({
      accessToken: "at-2",
      account: "owner@example.com",
      expiryMs: 1_800_000_000_000,
      grantedAtIso: "2026-10-01T00:00:00.000Z",
      refreshToken: "rt-1",
      scopes: [EVENTS],
    });
  });
});
