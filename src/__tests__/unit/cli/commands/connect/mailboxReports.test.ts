/**
 * Unit: the mailbox branches of `connect --check` over a real temp home. Every case here stops before the
 * network by construction — no client id, no grant, or an unreadable grant — so the live `/me` is never sent.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { gmailReport, outlookReport } from "../../../../../cli/commands/connect/mailboxReports.js";
import { outlookCalendarGrantStore, outlookMailGrantStore } from "../../../../../secrets/outlookGrant.js";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "slop-connect-mailbox-"));
});
afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("outlookReport", () => {
  it("names both missing halves on a fresh home", async () => {
    const report = await outlookReport({ home });
    expect(report.ok).toBe(false);
    expect(report.source).toBe("outlook");
    expect(report.capabilities.map((capability) => [capability.id, capability.status])).toEqual([
      ["registration", "missing"],
      ["auth", "missing"],
    ]);
  });

  it("reads a stored grant's account and tiers, and fails only on the missing registration", async () => {
    expect(
      outlookMailGrantStore
        .write({
          grant: {
            account: "me@example.test",
            grantedAtIso: "2026-11-01T00:00:00.000Z",
            homeAccountId: "home-account-fixture",
            msalCache: "{}",
            scopes: ["User.Read", "Mail.Read", "MailboxSettings.Read"],
          },
          home,
        })
        .isOk(),
    ).toBe(true);

    const report = await outlookReport({ home });

    expect(report.ok).toBe(false);
    expect(report.tokenPresent).toBe(true);
    expect(report.capabilities.map((capability) => [capability.id, capability.status])).toEqual([
      ["registration", "missing"],
      ["auth", "ok"],
      ["scope:read", "ok"],
      ["scope:manage", "warning"],
      ["scope:send", "warning"],
    ]);
    expect(report.capabilities[1]!.detail).toBe("a grant is stored for me@example.test");
  });

  it("reads only the mail grant: a calendar grant alone leaves the mail preflight not connected", async () => {
    expect(
      outlookCalendarGrantStore
        .write({
          grant: {
            account: "me@example.test",
            grantedAtIso: "2026-11-01T00:00:00.000Z",
            homeAccountId: "home-account-fixture",
            msalCache: "{}",
            scopes: ["User.Read", "Calendars.Read"],
          },
          home,
        })
        .isOk(),
    ).toBe(true);

    const report = await outlookReport({ home });

    expect(report.tokenPresent).toBe(false);
    expect(report.capabilities.map((capability) => [capability.id, capability.status])).toEqual([
      ["registration", "missing"],
      ["auth", "missing"],
    ]);
  });

  it("reports an unreadable grant as itself, never as not connected", async () => {
    const path = outlookMailGrantStore.path({ home });
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "FIXTURE_REFRESH_TOKEN_VALUE", { mode: 0o600 });

    const report = await outlookReport({ home });

    // The witness that this input WOULD leak through a parser message: V8 quotes it.
    expect(() => JSON.parse("FIXTURE_REFRESH_TOKEN_VALUE")).toThrow("FIXTURE_RE");
    expect(report.ok).toBe(false);
    expect(report.capabilities.map((capability) => [capability.id, capability.status])).toEqual([
      ["registration", "missing"],
      ["auth", "missing"],
    ]);
    expect(report.capabilities[1]!.detail).toContain("the stored Outlook grant is unreadable");
    expect(JSON.stringify(report)).not.toContain("FIXTURE_RE");
  });
});

describe("gmailReport", () => {
  it("answers a fresh home with a not-ready gmail report and no network call", async () => {
    const report = await gmailReport({ home });
    expect(report.ok).toBe(false);
    expect(report.source).toBe("gmail");
    expect(report.capabilities.map((capability) => [capability.id, capability.status])).toEqual([["auth", "missing"]]);
  });
});
