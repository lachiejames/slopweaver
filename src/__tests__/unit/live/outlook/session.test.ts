/**
 * The Outlook session in `live/outlook/session.ts`, over a throwaway home and no network: `withOutlookGrantLock`
 * runs the act while its store's lock is held and releases it afterwards however the act ends;
 * `resolveOutlookClient` refuses the MAIL grant on the stored state alone (no grant, a grant short of a scope, no
 * client id) before any token is bought; and `resolveOutlookCalendarGraph` picks the calendar's own grant over a
 * mail grant, falls back to a mail grant only when no calendar grant is stored AND the mail grant carries the
 * calendar's read, and writes the refreshed cache back into the file it read, while every refusal on the fallback
 * names the calendar's connect. The token purchase is a plain fake passed in, so no MSAL cache and no Microsoft
 * call is involved.
 */
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { operationLockDir } from "../../../../admit/operationLockPath.js";
import { err, ok, unwrap, unwrapErr } from "../../../../lib/result.js";
import { OutlookErrors } from "../../../../live/outlook/errors.js";
import {
  type OutlookTokenAcquire,
  requireOutlookClientId,
  resolveOutlookCalendarGraph,
  resolveOutlookClient,
  withOutlookGrantLock,
} from "../../../../live/outlook/session.js";
import {
  type OutlookGrant,
  outlookCalendarGrantStore,
  outlookMailGrantStore,
} from "../../../../secrets/outlookGrant.js";
import { writeSecretFile } from "../../../../secrets/store.js";

const homes: string[] = [];
let savedClientId: string | undefined;

/** A fresh state home for one test. */
function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "outlook-session-"));
  homes.push(home);
  return home;
}

/** A fresh home with the synthetic client id stored, so a sufficient grant reaches the token purchase. */
function homeWithClient(): string {
  const home = freshHome();
  unwrap(writeSecretFile({ home, name: "outlook-client-id", value: "00000000-0000-0000-0000-000000000000" }));
  return home;
}

/** The lock files currently held under a home. */
function heldLocks({ home }: { home: string }): readonly string[] {
  return readdirSync(operationLockDir({ home })).filter((name) => name.endsWith(".lock"));
}

/** A synthetic grant for one account, carrying the given scopes. */
function grantOf({ account, scopes }: { account: string; scopes: readonly string[] }): OutlookGrant {
  return {
    account,
    grantedAtIso: "2026-10-17T00:00:00.000Z",
    homeAccountId: `${account}.uid`,
    msalCache: `original-cache-${account}`,
    scopes,
  };
}

const MAIL_WITH_CALENDAR = grantOf({
  account: "mail@example.test",
  scopes: ["User.Read", "Mail.ReadWrite", "Calendars.Read"],
});
const MAIL_ONLY = grantOf({ account: "mail@example.test", scopes: ["User.Read", "Mail.ReadWrite"] });
const CALENDAR = grantOf({ account: "calendar@example.test", scopes: ["User.Read", "Calendars.Read"] });

/**
 * A token purchase that records which grant it was handed and answers a rotated cache naming that grant, so a
 * test can see both which grant was bound and which file the rotation landed in.
 */
function recordingAcquire(): { readonly seen: string[]; readonly acquire: OutlookTokenAcquire } {
  const seen: string[] = [];
  return {
    acquire: async ({ homeAccountId, scopes }) => {
      seen.push(homeAccountId);
      return ok({
        accessToken: "synthetic-access",
        expiryMs: 1_800_000_000_000,
        homeAccountId,
        msalCache: `rotated-cache-${homeAccountId}`,
        scopes,
      });
    },
    seen,
  };
}

/**
 * A token purchase Microsoft refuses the way an expired consent is refused: it answers `INTERACTION_REQUIRED` for
 * whichever product it was handed, as the real MSAL call does, and records `<cache grant>:<remedy product>`.
 */
function refusingAcquire(): { readonly asked: string[]; readonly acquire: OutlookTokenAcquire } {
  const asked: string[] = [];
  return {
    acquire: async ({ cacheGrant, product }) => {
      asked.push(`${cacheGrant}:${product}`);
      return err(OutlookErrors.interactionRequired({ product }));
    },
    asked,
  };
}

// The client id resolves from this variable before it reads the home, so a developer's own would defeat the tests.
beforeEach(() => {
  savedClientId = process.env["OUTLOOK_CLIENT_ID"];
  delete process.env["OUTLOOK_CLIENT_ID"];
});

afterEach(() => {
  if (savedClientId === undefined) {
    delete process.env["OUTLOOK_CLIENT_ID"];
  } else {
    process.env["OUTLOOK_CLIENT_ID"] = savedClientId;
  }
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

describe("withOutlookGrantLock", () => {
  it("holds the lock while the act runs, returns its value and releases it after", async () => {
    const home = freshHome();
    const seenDuring: (readonly string[])[] = [];

    const result = await withOutlookGrantLock({
      act: async () => {
        seenDuring.push(heldLocks({ home }));
        return ok("act value");
      },
      home,
      store: outlookMailGrantStore,
    });

    expect(unwrap(result)).toBe("act value");
    expect(seenDuring.map((held) => held.length)).toEqual([1]);
    expect(heldLocks({ home })).toEqual([]);
  });

  it("takes a different lock for each product, so both can be held at once", async () => {
    const home = freshHome();
    const seenDuring: (readonly string[])[] = [];

    await withOutlookGrantLock({
      act: () =>
        withOutlookGrantLock({
          act: async () => {
            seenDuring.push(heldLocks({ home }));
            return ok(true);
          },
          home,
          store: outlookMailGrantStore,
        }),
      home,
      store: outlookCalendarGrantStore,
    });

    expect(seenDuring.map((held) => held.length)).toEqual([2]);
    expect(heldLocks({ home })).toEqual([]);
  });

  it("runs a second act once the first has released", async () => {
    const home = freshHome();
    const order: string[] = [];

    await withOutlookGrantLock({
      act: async () => {
        order.push("first");
        return ok(1);
      },
      home,
      store: outlookMailGrantStore,
    });
    const second = await withOutlookGrantLock({
      act: async () => {
        order.push("second");
        return ok(2);
      },
      home,
      store: outlookMailGrantStore,
    });

    expect(unwrap(second)).toBe(2);
    expect(order).toEqual(["first", "second"]);
  });

  it("hands back the act's own failure unchanged and still releases the lock", async () => {
    const home = freshHome();

    const result = await withOutlookGrantLock({
      act: async () => err(OutlookErrors.notConnected({ product: "mail" })),
      home,
      store: outlookMailGrantStore,
    });

    expect(unwrapErr(result)).toEqual(OutlookErrors.notConnected({ product: "mail" }));
    expect(heldLocks({ home })).toEqual([]);
  });

  it("releases the lock when the act throws, and lets the throw through", async () => {
    const home = freshHome();

    const thrown = withOutlookGrantLock({
      act: async () => {
        throw new Error("synthetic act failure");
      },
      home,
      store: outlookMailGrantStore,
    });

    await expect(thrown).rejects.toThrow("synthetic act failure");
    expect(heldLocks({ home })).toEqual([]);
  });
});

describe("requireOutlookClientId", () => {
  it("names the registration's settings and the one command that sets the id when none is configured", () => {
    const refused = unwrapErr(requireOutlookClientId({ home: freshHome() }));

    expect(refused.code).toBe("CREDENTIAL_UNREADABLE");
    expect(refused.message).toBe(
      "the Outlook app registration's client id is not configured — create or reuse a Microsoft Entra app " +
        "registration that admits personal Microsoft accounts, add the Mobile and desktop applications platform " +
        "with redirect `http://localhost` (a public client using PKCE, so no client secret), see " +
        "`skills/outlook/reference/connecting.md`, then run `slopweaver secrets set outlook-client-id`",
    );
  });

  it("answers the id stored under the home", () => {
    expect(unwrap(requireOutlookClientId({ home: homeWithClient() }))).toBe("00000000-0000-0000-0000-000000000000");
  });
});

describe("resolveOutlookClient", () => {
  it("refuses a home with no mail grant as not connected, naming the mail connect", async () => {
    const refused = await resolveOutlookClient({ capabilities: ["read"], home: freshHome() });

    expect(unwrapErr(refused).message).toBe("no Outlook grant stored for this home — run `slopweaver outlook connect`");
  });

  it("reads only the mail grant, so a calendar grant alone is still not connected for mail", async () => {
    const home = freshHome();
    unwrap(outlookCalendarGrantStore.write({ grant: CALENDAR, home }));

    const refused = await resolveOutlookClient({ capabilities: ["identity"], home });

    expect(unwrapErr(refused)).toEqual(OutlookErrors.notConnected({ product: "mail" }));
  });

  it("refuses a grant that lacks a capability's permission, naming the mail remedy", async () => {
    const home = freshHome();
    unwrap(
      outlookMailGrantStore.write({
        grant: grantOf({ account: "a@example.test", scopes: ["User.Read", "Mail.Read"] }),
        home,
      }),
    );

    const refused = await resolveOutlookClient({ capabilities: ["read", "send"], home });

    expect(unwrapErr(refused).message).toBe(
      "the stored Outlook grant is missing Mail.Send — re-run `slopweaver outlook connect --grant full` and approve it",
    );
  });

  it("refuses a sufficient grant when no client id is configured", async () => {
    const home = freshHome();
    unwrap(
      outlookMailGrantStore.write({
        grant: grantOf({ account: "a@example.test", scopes: ["User.Read", "Mail.Read"] }),
        home,
      }),
    );

    const refused = await resolveOutlookClient({ capabilities: ["read"], home });

    expect(unwrapErr(refused).code).toBe("CREDENTIAL_UNREADABLE");
    expect(heldLocks({ home })).toEqual([]);
  });

  it("names the mail connect when Microsoft refuses the mail grant's silent refresh", async () => {
    const home = homeWithClient();
    unwrap(outlookMailGrantStore.write({ grant: MAIL_WITH_CALENDAR, home }));
    const { acquire, asked } = refusingAcquire();

    const refused = await resolveOutlookClient({ acquire, capabilities: ["identity"], home });

    expect(asked).toEqual(["mail:mail"]);
    expect(unwrapErr(refused).message).toBe(
      "Microsoft will not refresh this grant silently any more — run `slopweaver outlook connect` again",
    );
  });
});

describe("resolveOutlookCalendarGraph", () => {
  it("binds the calendar's own grant over a mail grant that also covers the calendar, and writes back to it", async () => {
    const home = homeWithClient();
    unwrap(outlookMailGrantStore.write({ grant: MAIL_WITH_CALENDAR, home }));
    unwrap(outlookCalendarGrantStore.write({ grant: CALENDAR, home }));
    const { acquire, seen } = recordingAcquire();

    const bound = unwrap(await resolveOutlookCalendarGraph({ acquire, home }));

    expect(bound.account).toBe("calendar@example.test");
    expect(seen).toEqual(["calendar@example.test.uid"]);
    expect(unwrap(outlookCalendarGrantStore.read({ home }))!.msalCache).toBe("rotated-cache-calendar@example.test.uid");
    expect(unwrap(outlookMailGrantStore.read({ home }))!.msalCache).toBe("original-cache-mail@example.test");
    expect(heldLocks({ home })).toEqual([]);
  });

  it("falls back to a mail grant carrying the calendar's read when no calendar grant is stored, writing back to the mail file", async () => {
    const home = homeWithClient();
    unwrap(outlookMailGrantStore.write({ grant: MAIL_WITH_CALENDAR, home }));
    const { acquire, seen } = recordingAcquire();

    const bound = unwrap(await resolveOutlookCalendarGraph({ acquire, home }));

    expect(bound.account).toBe("mail@example.test");
    expect(seen).toEqual(["mail@example.test.uid"]);
    expect(unwrap(outlookMailGrantStore.read({ home }))!.msalCache).toBe("rotated-cache-mail@example.test.uid");
    expect(unwrap(outlookCalendarGrantStore.read({ home }))).toBe(undefined);
    expect(heldLocks({ home })).toEqual([]);
  });

  it("never falls back to a mail grant without the calendar's read: not connected, naming the calendar's connect", async () => {
    const home = homeWithClient();
    unwrap(outlookMailGrantStore.write({ grant: MAIL_ONLY, home }));
    const { acquire, seen } = recordingAcquire();

    const refused = await resolveOutlookCalendarGraph({ acquire, home });

    expect(unwrapErr(refused).message).toBe(
      "no Outlook Calendar grant stored for this home — run `slopweaver outlook-calendar connect`",
    );
    expect(seen).toEqual([]);
  });

  it("refuses its own grant short of the calendar's read rather than passing over it to the mail grant", async () => {
    const home = homeWithClient();
    unwrap(outlookMailGrantStore.write({ grant: MAIL_WITH_CALENDAR, home }));
    unwrap(
      outlookCalendarGrantStore.write({
        grant: grantOf({ account: "calendar@example.test", scopes: ["User.Read"] }),
        home,
      }),
    );
    const { acquire, seen } = recordingAcquire();

    const refused = await resolveOutlookCalendarGraph({ acquire, home });

    expect(unwrapErr(refused).message).toBe(
      "the stored Outlook Calendar grant is missing Calendars.Read — re-run `slopweaver outlook-calendar connect` and approve it",
    );
    expect(seen).toEqual([]);
    expect(heldLocks({ home })).toEqual([]);
  });

  it("names the calendar's connect when Microsoft refuses the mail grant it fell back to, and writes nothing back", async () => {
    const home = homeWithClient();
    unwrap(outlookMailGrantStore.write({ grant: MAIL_WITH_CALENDAR, home }));
    const { acquire, asked } = refusingAcquire();

    const refused = await resolveOutlookCalendarGraph({ acquire, home });

    // The cache is the mail grant's, so a refusal of the cache names Outlook; the remedy is still the calendar's.
    expect(asked).toEqual(["mail:calendar"]);
    expect(unwrapErr(refused).message).toBe(
      "Microsoft will not refresh this grant silently any more — run `slopweaver outlook-calendar connect` again",
    );
    expect(unwrap(outlookMailGrantStore.read({ home }))!.msalCache).toBe("original-cache-mail@example.test");
    expect(heldLocks({ home })).toEqual([]);
  });

  it("refuses an unreadable calendar grant file as itself and never falls through to the mail grant", async () => {
    const home = homeWithClient();
    unwrap(outlookMailGrantStore.write({ grant: MAIL_WITH_CALENDAR, home }));
    const path = outlookCalendarGrantStore.path({ home });
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "not a grant", { mode: 0o600 });
    const { acquire, seen } = recordingAcquire();

    const refused = unwrapErr(await resolveOutlookCalendarGraph({ acquire, home }));

    expect(refused.code).toBe("CREDENTIAL_UNREADABLE");
    // The shared grant-file reader's own words, naming the CALENDAR grant: the file refused is the calendar's.
    expect(refused.message).toBe(
      "the stored Outlook Calendar grant is not valid JSON (the parser's detail is withheld: it quotes the file)",
    );
    expect(seen).toEqual([]);
    expect(unwrap(outlookMailGrantStore.read({ home }))!.msalCache).toBe("original-cache-mail@example.test");
    expect(heldLocks({ home })).toEqual([]);
  });

  it("refuses a home with no grant at all as the calendar not connected", async () => {
    const { acquire } = recordingAcquire();

    const refused = await resolveOutlookCalendarGraph({ acquire, home: freshHome() });

    expect(unwrapErr(refused)).toEqual(OutlookErrors.notConnected({ product: "calendar" }));
  });
});
