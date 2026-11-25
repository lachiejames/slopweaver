/**
 * Unit: the two Microsoft consent verbs over plain fake effects — `outlook connect` (mail) and
 * `outlook-calendar connect` (calendar). The three modes, what each consent ASKS Microsoft for (its own product's
 * permissions only), what it persists, and the statements each verb owes the owner: that a disconnect leaves
 * Microsoft's consent in place, that a grant short of what was asked will make some verbs refuse, that a mail
 * re-consent which cut off a calendar reading over the old mail grant names the calendar's own connect, that the
 * calendar's status and disconnect say when a covering mail grant still serves its reads, and that `--calendar` is
 * no longer a mail option.
 */
import { describe, expect, it } from "vitest";
import type { OutlookConnectDeps } from "../../../../../cli/commands/outlook/connectDeps.js";
import {
  OUTLOOK_CALENDAR_CONNECT_DOOR,
  OUTLOOK_CONSENT_MANAGE_URL,
  OUTLOOK_MAIL_CONNECT_DOOR,
  runOutlookConnect,
} from "../../../../../cli/commands/outlook/connectRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { err, ok } from "../../../../../lib/result.js";
import { OutlookErrors } from "../../../../../live/outlook/errors.js";
import type { OutlookGrant } from "../../../../../secrets/outlookGrant.js";

/** A home the fakes never touch; `--home` keeps the verb off the ambient one. */
const HOME = "/nonexistent/outlook-connect-home";

const MAIL_PATH = `${HOME}/secrets/outlook-oauth.json`;
const CALENDAR_PATH = `${HOME}/secrets/outlook-calendar-oauth.json`;

const GRANT: OutlookGrant = {
  account: "owner@example.test",
  grantedAtIso: "2026-10-01T00:00:00.000Z",
  homeAccountId: "home-1",
  msalCache: "{}",
  scopes: ["User.Read", "Mail.ReadWrite", "MailboxSettings.Read"],
};

/** A mail grant consented before the calendar had a consent of its own, carrying the calendar's read. */
const WIDER_MAIL_GRANT: OutlookGrant = { ...GRANT, scopes: [...GRANT.scopes, "Calendars.Read"] };

/** Fake effects over an in-memory grant slot for ONE door's grant file. */
function fakeConnect({
  stored,
  granted = ["User.Read", "Mail.ReadWrite", "MailboxSettings.Read", "Mail.Read"],
  consentFails = false,
  calendarGrantStored = false,
  mailCovering,
  path = MAIL_PATH,
}: {
  stored?: OutlookGrant;
  granted?: readonly string[];
  consentFails?: boolean;
  calendarGrantStored?: boolean;
  /** The account of a mail grant the calendar would read over, when one is stored. */
  mailCovering?: string;
  path?: string;
}): { deps: OutlookConnectDeps; out: string[]; warn: string[]; slot: (OutlookGrant | undefined)[]; asked: string[][] } {
  const out: string[] = [];
  const warn: string[] = [];
  const slot: (OutlookGrant | undefined)[] = [stored];
  const asked: string[][] = [];
  const deps: OutlookConnectDeps = {
    calendarGrantStored: () => calendarGrantStored,
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
    mailGrantCoveringCalendar: () => mailCovering,
    nowIso: () => "2026-10-17T00:00:00.000Z",
    out: (line) => {
      out.push(line);
    },
    path: () => path,
    read: () => ok(slot[0]),
    remove: async () => {
      slot[0] = undefined;
      return ok(path);
    },
    replace: async ({ grant }) => {
      const previous = slot[0];
      slot[0] = grant;
      return ok({ path, previous });
    },
    warn: (line) => {
      warn.push(line);
    },
  };
  return { asked, deps, out, slot, warn };
}

describe("outlook connect", () => {
  it("asks for the default manage grant — mail permissions only — persists what Microsoft granted, and warns of nothing", async () => {
    const fake = fakeConnect({});
    const code = await runOutlookConnect({ deps: fake.deps, door: OUTLOOK_MAIL_CONNECT_DOOR, rest: ["--home", HOME] });
    expect(code).toBe(EXIT_OK);
    expect(fake.asked).toEqual([
      ["User.Read", "Mail.Read", "MailboxSettings.Read", "Mail.ReadWrite", "offline_access"],
    ]);
    expect(fake.slot[0]!.grantedAtIso).toBe("2026-10-17T00:00:00.000Z");
    expect(fake.out).toEqual([
      "connected: owner@example.test",
      "scopes: User.Read Mail.ReadWrite MailboxSettings.Read Mail.Read",
      "granted: 2026-10-17T00:00:00.000Z",
      `grant file: ${MAIL_PATH}`,
    ]);
    expect(fake.warn).toEqual([]);
  });

  it("warns by permission name when Microsoft granted less than --grant full asked for, naming the mail connect", async () => {
    const fake = fakeConnect({});
    const code = await runOutlookConnect({
      deps: fake.deps,
      door: OUTLOOK_MAIL_CONNECT_DOOR,
      rest: ["--grant", "full", "--home", HOME],
    });
    expect(code).toBe(EXIT_OK);
    expect(fake.warn).toEqual([
      "Microsoft granted less than was asked for — missing Mail.Send. Verbs needing those will refuse; re-run " +
        "`slopweaver outlook connect` and approve every permission to widen it",
    ]);
  });

  it("no longer accepts --calendar, and names the calendar's own connect instead of consenting", async () => {
    const fake = fakeConnect({});
    const code = await runOutlookConnect({
      deps: fake.deps,
      door: OUTLOOK_MAIL_CONNECT_DOOR,
      rest: ["--calendar", "--home", HOME],
    });
    expect(code).toBe(EXIT_USAGE);
    expect(fake.warn[0]).toBe(
      "--calendar is not an `outlook connect` option: the calendar is its own integration with its own consent — " +
        "run `slopweaver outlook-calendar connect`",
    );
    expect(fake.asked).toEqual([]);
    expect(fake.slot).toEqual([undefined]);
  });

  it("warns when a re-consent replaced a mail grant the calendar was reading over, and no calendar grant is stored", async () => {
    const fake = fakeConnect({ stored: WIDER_MAIL_GRANT });
    const code = await runOutlookConnect({ deps: fake.deps, door: OUTLOOK_MAIL_CONNECT_DOOR, rest: ["--home", HOME] });
    expect(code).toBe(EXIT_OK);
    expect(fake.warn).toEqual([
      "the Outlook calendar was reading over the mail grant this consent replaced, and the new grant does not " +
        "cover it — run `slopweaver outlook-calendar connect` to connect the calendar on its own",
    ]);
  });

  it("stays quiet about the calendar on that re-consent when the calendar has its own grant", async () => {
    const fake = fakeConnect({ calendarGrantStored: true, stored: WIDER_MAIL_GRANT });
    await runOutlookConnect({ deps: fake.deps, door: OUTLOOK_MAIL_CONNECT_DOOR, rest: ["--home", HOME] });
    expect(fake.warn).toEqual([]);
  });

  it("stores nothing when consent fails", async () => {
    const fake = fakeConnect({ consentFails: true });
    const code = await runOutlookConnect({ deps: fake.deps, door: OUTLOOK_MAIL_CONNECT_DOOR, rest: ["--home", HOME] });
    expect(code).toBe(EXIT_ERROR);
    expect(fake.slot).toEqual([undefined]);
    expect(fake.warn).toEqual(["Microsoft refused the consent (access_denied)"]);
  });

  it("--status reports an absent grant without consenting", async () => {
    const fake = fakeConnect({});
    const code = await runOutlookConnect({
      deps: fake.deps,
      door: OUTLOOK_MAIL_CONNECT_DOOR,
      rest: ["--status", "--json", "--home", HOME],
    });
    expect(code).toBe(EXIT_OK);
    expect(JSON.parse(fake.out[0]!)).toEqual({ connected: false });
    expect(fake.asked).toEqual([]);
  });

  it("--status in words names the mail connect when nothing is stored", async () => {
    const fake = fakeConnect({});
    await runOutlookConnect({ deps: fake.deps, door: OUTLOOK_MAIL_CONNECT_DOOR, rest: ["--status", "--home", HOME] });
    expect(fake.out).toEqual(["not connected — run `slopweaver outlook connect`"]);
  });

  it("--status reports a stored grant's account and scopes", async () => {
    const fake = fakeConnect({ stored: GRANT });
    await runOutlookConnect({ deps: fake.deps, door: OUTLOOK_MAIL_CONNECT_DOOR, rest: ["--status", "--home", HOME] });
    expect(fake.out.slice(0, 2)).toEqual([
      "connected: owner@example.test",
      "scopes: User.Read Mail.ReadWrite MailboxSettings.Read",
    ]);
  });

  it("--disconnect removes the local grant and always names where Microsoft's consent is withdrawn", async () => {
    const fake = fakeConnect({ stored: GRANT });
    const code = await runOutlookConnect({
      deps: fake.deps,
      door: OUTLOOK_MAIL_CONNECT_DOOR,
      rest: ["--disconnect", "--home", HOME],
    });
    expect(code).toBe(EXIT_OK);
    expect(fake.slot).toEqual([undefined]);
    expect(fake.out).toEqual([
      `removed the local grant: ${MAIL_PATH}`,
      `Microsoft still holds this app's consent until you withdraw it at ${OUTLOOK_CONSENT_MANAGE_URL}`,
    ]);
  });

  it("--disconnect with nothing stored says so, and still names the consent page", async () => {
    const fake = fakeConnect({});
    await runOutlookConnect({
      deps: fake.deps,
      door: OUTLOOK_MAIL_CONNECT_DOOR,
      rest: ["--disconnect", "--home", HOME],
    });
    expect(fake.out[0]).toBe("no local grant to remove");
    expect(fake.out[1]).toContain(OUTLOOK_CONSENT_MANAGE_URL);
  });

  it.each([
    [["--status", "--disconnect"], "--status"],
    [["--grant", "everything"], "unknown --grant: everything"],
  ])("refuses %j as a usage error, consenting to nothing", async (rest, fragment) => {
    const fake = fakeConnect({});
    const code = await runOutlookConnect({
      deps: fake.deps,
      door: OUTLOOK_MAIL_CONNECT_DOOR,
      rest: [...rest, "--home", HOME],
    });
    expect(code).toBe(EXIT_USAGE);
    expect(fake.warn.join("\n")).toContain(fragment);
    expect(fake.asked).toEqual([]);
  });
});

describe("outlook-calendar connect", () => {
  const CALENDAR_SCOPES = ["User.Read", "Calendars.Read"];

  it("asks for exactly User.Read, Calendars.Read and offline_access — nothing of the mailbox — and stores its own grant", async () => {
    const fake = fakeConnect({ granted: CALENDAR_SCOPES, path: CALENDAR_PATH });
    const code = await runOutlookConnect({
      deps: fake.deps,
      door: OUTLOOK_CALENDAR_CONNECT_DOOR,
      rest: ["--home", HOME],
    });
    expect(code).toBe(EXIT_OK);
    expect(fake.asked).toEqual([["User.Read", "Calendars.Read", "offline_access"]]);
    expect(fake.slot[0]!.scopes).toEqual(CALENDAR_SCOPES);
    expect(fake.out.at(-1)).toBe(`grant file: ${CALENDAR_PATH}`);
    expect(fake.warn).toEqual([]);
  });

  it("warns, naming its own connect, when Microsoft withheld the calendar's read", async () => {
    const fake = fakeConnect({ granted: ["User.Read"], path: CALENDAR_PATH });
    await runOutlookConnect({ deps: fake.deps, door: OUTLOOK_CALENDAR_CONNECT_DOOR, rest: ["--home", HOME] });
    expect(fake.warn).toEqual([
      "Microsoft granted less than was asked for — missing Calendars.Read. Verbs needing those will refuse; re-run " +
        "`slopweaver outlook-calendar connect` and approve every permission to widen it",
    ]);
  });

  it("never owes the mail door's narrowing warning, whatever it replaced", async () => {
    const fake = fakeConnect({ granted: CALENDAR_SCOPES, path: CALENDAR_PATH, stored: WIDER_MAIL_GRANT });
    await runOutlookConnect({ deps: fake.deps, door: OUTLOOK_CALENDAR_CONNECT_DOOR, rest: ["--home", HOME] });
    expect(fake.warn).toEqual([]);
  });

  it("--status in words names the calendar's own connect when nothing is stored", async () => {
    const fake = fakeConnect({ path: CALENDAR_PATH });
    await runOutlookConnect({
      deps: fake.deps,
      door: OUTLOOK_CALENDAR_CONNECT_DOOR,
      rest: ["--status", "--home", HOME],
    });
    expect(fake.out).toEqual(["not connected — run `slopweaver outlook-calendar connect`"]);
  });

  it("--status says when the calendar reads over a mail grant carrying its permission, in words and in JSON", async () => {
    const words = fakeConnect({ mailCovering: "owner@example.test", path: CALENDAR_PATH });
    await runOutlookConnect({
      deps: words.deps,
      door: OUTLOOK_CALENDAR_CONNECT_DOOR,
      rest: ["--status", "--home", HOME],
    });
    const json = fakeConnect({ mailCovering: "owner@example.test", path: CALENDAR_PATH });
    await runOutlookConnect({
      deps: json.deps,
      door: OUTLOOK_CALENDAR_CONNECT_DOOR,
      rest: ["--status", "--json", "--home", HOME],
    });
    const uncovered = fakeConnect({ path: CALENDAR_PATH });
    await runOutlookConnect({
      deps: uncovered.deps,
      door: OUTLOOK_CALENDAR_CONNECT_DOOR,
      rest: ["--status", "--json", "--home", HOME],
    });

    expect(words.out).toEqual([
      "no grant of its own — reading over the Outlook mail grant for owner@example.test, which carries a calendar " +
        "permission; run `slopweaver outlook-calendar connect` to give the calendar its own grant",
    ]);
    expect(JSON.parse(json.out[0]!)).toEqual({ connected: false, readsOverMailGrant: true });
    expect(JSON.parse(uncovered.out[0]!)).toEqual({ connected: false, readsOverMailGrant: false });
    expect([words.asked, json.asked]).toEqual([[], []]);
  });

  it("--status of its own stored grant never mentions the mail grant", async () => {
    const fake = fakeConnect({
      mailCovering: "owner@example.test",
      path: CALENDAR_PATH,
      stored: { ...GRANT, scopes: CALENDAR_SCOPES },
    });
    await runOutlookConnect({
      deps: fake.deps,
      door: OUTLOOK_CALENDAR_CONNECT_DOOR,
      rest: ["--status", "--home", HOME],
    });
    expect(fake.out[0]).toBe("connected: owner@example.test");
    expect(fake.out.length).toBe(4);
  });

  it("--disconnect says calendar reads still work over a covering mail grant, in words and in JSON", async () => {
    const stored = { ...GRANT, scopes: CALENDAR_SCOPES };
    const words = fakeConnect({ mailCovering: "owner@example.test", path: CALENDAR_PATH, stored });
    await runOutlookConnect({
      deps: words.deps,
      door: OUTLOOK_CALENDAR_CONNECT_DOOR,
      rest: ["--disconnect", "--home", HOME],
    });
    const json = fakeConnect({ mailCovering: "owner@example.test", path: CALENDAR_PATH, stored });
    await runOutlookConnect({
      deps: json.deps,
      door: OUTLOOK_CALENDAR_CONNECT_DOOR,
      rest: ["--disconnect", "--json", "--home", HOME],
    });

    expect(words.out).toEqual([
      `removed the local grant: ${CALENDAR_PATH}`,
      `Microsoft still holds this app's consent until you withdraw it at ${OUTLOOK_CONSENT_MANAGE_URL}`,
      "calendar reads still work over the Outlook mail grant for owner@example.test, which carries a calendar " +
        "permission, until mail is reconnected without one",
    ]);
    expect(JSON.parse(json.out[0]!)).toEqual({
      connected: false,
      readsOverMailGrant: true,
      removed: CALENDAR_PATH,
      serverConsent: OUTLOOK_CONSENT_MANAGE_URL,
    });
  });

  it("--disconnect removes only its own grant file and names the consent page", async () => {
    const fake = fakeConnect({ path: CALENDAR_PATH, stored: { ...GRANT, scopes: CALENDAR_SCOPES } });
    await runOutlookConnect({
      deps: fake.deps,
      door: OUTLOOK_CALENDAR_CONNECT_DOOR,
      rest: ["--disconnect", "--home", HOME],
    });
    expect(fake.out).toEqual([
      `removed the local grant: ${CALENDAR_PATH}`,
      `Microsoft still holds this app's consent until you withdraw it at ${OUTLOOK_CONSENT_MANAGE_URL}`,
    ]);
  });

  it("refuses --calendar as an unknown flag: the calendar door has no product option to add", async () => {
    const fake = fakeConnect({ path: CALENDAR_PATH });
    const code = await runOutlookConnect({
      deps: fake.deps,
      door: OUTLOOK_CALENDAR_CONNECT_DOOR,
      rest: ["--calendar", "--home", HOME],
    });
    expect(code).toBe(EXIT_USAGE);
    expect(fake.warn[0]).toBe("unknown flag: --calendar");
    expect(fake.asked).toEqual([]);
  });

  it.each([
    [["--grant", "full"], "--grant"],
    [["--status", "--disconnect"], "--status"],
  ])("refuses %j as a usage error, consenting to nothing", async (rest, fragment) => {
    const fake = fakeConnect({ path: CALENDAR_PATH });
    const code = await runOutlookConnect({
      deps: fake.deps,
      door: OUTLOOK_CALENDAR_CONNECT_DOOR,
      rest: [...rest, "--home", HOME],
    });
    expect(code).toBe(EXIT_USAGE);
    expect(fake.warn.join("\n")).toContain(fragment);
    expect(fake.asked).toEqual([]);
  });
});
