/**
 * {@link activeBrowserPageWaiver} and the journal it reads — the RECORDED escape hatch for a read-only page.
 *
 * The properties worth failing over are the ones an environment variable cannot have: a waiver stops
 * applying on its own, a waiver issued to one session never covers another, and a grant naming no page
 * waives nothing.
 */
import { describe, expect, it } from "vitest";

import {
  activeBrowserPageWaiver,
  BROWSER_BREAK_GLASS_WINDOW_MS,
  type BrowserBreakGlassGrant,
  browserBreakGlassCountFor,
  parseBrowserBreakGlassJournal,
  parseBrowserBreakGlassLine,
} from "../../../browser/breakGlass.js";
import { buildBrowserBreakGlassGrant } from "../../../browser/breakGlassStore.js";

const ISSUED = "2026-09-08T09:00:00.000Z";
const SESSION = "f0bae6e5-0386-4bdc-9863-d25b38f0635e";

/** One grant, defaulted to the session and instant every test here uses. */
function grant(over: Partial<BrowserBreakGlassGrant> = {}): BrowserBreakGlassGrant {
  return { ...buildBrowserBreakGlassGrant({ issuedAtIso: ISSUED, reason: "why", sessionId: SESSION }), ...over };
}

describe("buildBrowserBreakGlassGrant", () => {
  it("expires thirty minutes after it is issued", () => {
    const built = buildBrowserBreakGlassGrant({ issuedAtIso: ISSUED, reason: "why", sessionId: SESSION });
    expect(BROWSER_BREAK_GLASS_WINDOW_MS).toBe(1800000);
    expect(built.expiresAtIso).toBe("2026-09-08T09:30:00.000Z");
    expect(built.reason).toBe("why");
    expect(built.sessionId).toBe(SESSION);
  });
});

describe("activeBrowserPageWaiver", () => {
  const PAGE = "https://console.jumpcloud.com/#/users";

  it("finds a live grant scoped to that exact page, for the session that took it", () => {
    const found = activeBrowserPageWaiver({
      grants: [grant({ page: PAGE })],
      nowIso: "2026-09-08T09:29:59.000Z",
      sessionId: SESSION,
      url: PAGE,
    })!;
    expect(found.reason).toBe("why");
  });

  it("waives nothing with a session-wide grant that names no page", () => {
    expect(activeBrowserPageWaiver({ grants: [grant()], nowIso: ISSUED, sessionId: SESSION, url: PAGE })).toBe(
      undefined,
    );
  });

  it("does not cover a different page", () => {
    expect(
      activeBrowserPageWaiver({
        grants: [grant({ page: PAGE })],
        nowIso: ISSUED,
        sessionId: SESSION,
        url: "https://console.jumpcloud.com/#/devices",
      }),
    ).toBe(undefined);
  });

  it("never covers another session", () => {
    expect(
      activeBrowserPageWaiver({ grants: [grant({ page: PAGE })], nowIso: ISSUED, sessionId: "other", url: PAGE }),
    ).toBe(undefined);
  });

  it("stops applying the moment it expires", () => {
    expect(
      activeBrowserPageWaiver({
        grants: [grant({ page: PAGE })],
        nowIso: "2026-09-08T09:30:00.000Z",
        sessionId: SESSION,
        url: PAGE,
      }),
    ).toBe(undefined);
  });

  it("answers nothing on an unparseable instant rather than treating it as live", () => {
    expect(
      activeBrowserPageWaiver({ grants: [grant({ page: PAGE })], nowIso: "not-a-time", sessionId: SESSION, url: PAGE }),
    ).toBe(undefined);
  });
});

describe("browserBreakGlassCountFor", () => {
  it("counts expired grants too, so a repeat is visible", () => {
    const count = browserBreakGlassCountFor({
      grants: [grant(), grant({ expiresAtIso: "1999-01-01T00:00:00.000Z" }), grant({ sessionId: "other" })],
      sessionId: SESSION,
    });
    expect(count).toBe(2);
  });
});

describe("parseBrowserBreakGlassLine", () => {
  it("round-trips a grant and drops an incomplete one", () => {
    const back = parseBrowserBreakGlassLine({ line: JSON.stringify(grant()) })!;
    expect(back.sessionId).toBe(SESSION);
    expect(parseBrowserBreakGlassLine({ line: '{"sessionId":"s","reason":"r"}' })).toBe(undefined);
    expect(parseBrowserBreakGlassLine({ line: "   " })).toBe(undefined);
  });

  it("keeps the rows either side of a torn write", () => {
    const rows = parseBrowserBreakGlassJournal({
      text: `${JSON.stringify(grant())}\n{oops\n${JSON.stringify(grant({ reason: "second" }))}\n`,
    });
    expect(rows.length).toBe(2);
    expect(rows[1]!.reason).toBe("second");
  });
});
