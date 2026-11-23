/**
 * Unit: `outlook connect` over plain fake effects — the three modes, what a consent persists, and the two
 * statements the verb owes the owner: that a disconnect leaves Microsoft's consent in place, and that a grant
 * short of what was asked will make some verbs refuse.
 */
import { describe, expect, it } from "vitest";
import type { OutlookConnectDeps } from "../../../../../cli/commands/outlook/connectRun.js";
import { OUTLOOK_CONSENT_MANAGE_URL, runOutlookConnect } from "../../../../../cli/commands/outlook/connectRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { err, ok } from "../../../../../lib/result.js";
import { OutlookErrors } from "../../../../../live/outlook/errors.js";
import type { OutlookGrant } from "../../../../../secrets/outlookGrant.js";

/** A home the fakes never touch; `--home` keeps the verb off the ambient one. */
const HOME = "/nonexistent/outlook-connect-home";

const GRANT: OutlookGrant = {
  account: "owner@example.test",
  grantedAtIso: "2026-10-01T00:00:00.000Z",
  homeAccountId: "home-1",
  msalCache: "{}",
  scopes: ["User.Read", "Mail.ReadWrite", "MailboxSettings.Read"],
};

/** Fake effects over an in-memory grant slot. */
function fakeConnect({
  stored,
  granted = ["User.Read", "Mail.ReadWrite", "MailboxSettings.Read", "Mail.Read"],
  consentFails = false,
}: {
  stored?: OutlookGrant;
  granted?: readonly string[];
  consentFails?: boolean;
}): { deps: OutlookConnectDeps; out: string[]; warn: string[]; slot: (OutlookGrant | undefined)[]; asked: string[][] } {
  const out: string[] = [];
  const warn: string[] = [];
  const slot: (OutlookGrant | undefined)[] = [stored];
  const asked: string[][] = [];
  const deps: OutlookConnectDeps = {
    consent: async ({ scopes }) => {
      asked.push([...scopes]);
      if (consentFails) {
        return err(OutlookErrors.consentFailed({ message: "Microsoft refused the consent (access_denied)" }));
      }
      return ok({
        account: "owner@example.test",
        expiryMs: undefined,
        homeAccountId: "home-1",
        msalCache: "{}",
        scopes: granted,
      });
    },
    nowIso: () => "2026-10-17T00:00:00.000Z",
    out: (line) => {
      out.push(line);
    },
    read: () => ok(slot[0]),
    remove: async () => {
      slot[0] = undefined;
      return ok(`${HOME}/secrets/outlook-oauth.json`);
    },
    warn: (line) => {
      warn.push(line);
    },
    write: async ({ grant }) => {
      slot[0] = grant;
      return ok(`${HOME}/secrets/outlook-oauth.json`);
    },
  };
  return { asked, deps, out, slot, warn };
}

describe("outlook connect", () => {
  it("asks for the default manage grant, persists what Microsoft granted, and warns of nothing", async () => {
    const fake = fakeConnect({});
    const code = await runOutlookConnect({ deps: fake.deps, rest: ["--home", HOME] });
    expect(code).toBe(EXIT_OK);
    expect(fake.asked).toEqual([
      ["User.Read", "Mail.Read", "MailboxSettings.Read", "Mail.ReadWrite", "offline_access"],
    ]);
    expect(fake.slot[0]!.grantedAtIso).toBe("2026-10-17T00:00:00.000Z");
    expect(fake.out[0]).toBe("connected: owner@example.test");
    expect(fake.warn).toEqual([]);
  });

  it("warns by permission name when Microsoft granted less than --grant full asked for", async () => {
    const fake = fakeConnect({});
    const code = await runOutlookConnect({ deps: fake.deps, rest: ["--grant", "full", "--home", HOME] });
    expect(code).toBe(EXIT_OK);
    expect(fake.warn.join("\n")).toContain("missing Mail.Send");
  });

  it("asks for Calendars.Read only when --calendar names it, on top of the mail grant", async () => {
    const fake = fakeConnect({});
    const code = await runOutlookConnect({ deps: fake.deps, rest: ["--calendar", "--home", HOME] });
    expect(code).toBe(EXIT_OK);
    expect(fake.asked).toEqual([
      ["User.Read", "Mail.Read", "MailboxSettings.Read", "Mail.ReadWrite", "Calendars.Read", "offline_access"],
    ]);
    expect(fake.warn.join("\n")).toContain("missing Calendars.Read");
  });

  it("stores nothing when consent fails", async () => {
    const fake = fakeConnect({ consentFails: true });
    const code = await runOutlookConnect({ deps: fake.deps, rest: ["--home", HOME] });
    expect(code).toBe(EXIT_ERROR);
    expect(fake.slot).toEqual([undefined]);
    expect(fake.warn).toEqual(["Microsoft refused the consent (access_denied)"]);
  });

  it("--status reports an absent grant without consenting", async () => {
    const fake = fakeConnect({});
    const code = await runOutlookConnect({ deps: fake.deps, rest: ["--status", "--json", "--home", HOME] });
    expect(code).toBe(EXIT_OK);
    expect(JSON.parse(fake.out[0]!)).toEqual({ connected: false });
    expect(fake.asked).toEqual([]);
  });

  it("--status reports a stored grant's account and scopes", async () => {
    const fake = fakeConnect({ stored: GRANT });
    await runOutlookConnect({ deps: fake.deps, rest: ["--status", "--home", HOME] });
    expect(fake.out.slice(0, 2)).toEqual([
      "connected: owner@example.test",
      "scopes: User.Read Mail.ReadWrite MailboxSettings.Read",
    ]);
  });

  it("--disconnect removes the local grant and always names where Microsoft's consent is withdrawn", async () => {
    const fake = fakeConnect({ stored: GRANT });
    const code = await runOutlookConnect({ deps: fake.deps, rest: ["--disconnect", "--home", HOME] });
    expect(code).toBe(EXIT_OK);
    expect(fake.slot).toEqual([undefined]);
    expect(fake.out).toEqual([
      `removed the local grant: ${HOME}/secrets/outlook-oauth.json`,
      `Microsoft still holds this app's consent until you withdraw it at ${OUTLOOK_CONSENT_MANAGE_URL}`,
    ]);
  });

  it("--disconnect with nothing stored says so, and still names the consent page", async () => {
    const fake = fakeConnect({});
    await runOutlookConnect({ deps: fake.deps, rest: ["--disconnect", "--home", HOME] });
    expect(fake.out[0]).toBe("no local grant to remove");
    expect(fake.out[1]).toContain(OUTLOOK_CONSENT_MANAGE_URL);
  });

  it.each([
    [["--status", "--disconnect"], "--status"],
    [["--grant", "everything"], "unknown --grant: everything"],
  ])("refuses %j as a usage error, consenting to nothing", async (rest, fragment) => {
    const fake = fakeConnect({});
    const code = await runOutlookConnect({ deps: fake.deps, rest: [...rest, "--home", HOME] });
    expect(code).toBe(EXIT_USAGE);
    expect(fake.warn.join("\n")).toContain(fragment);
    expect(fake.asked).toEqual([]);
  });
});
