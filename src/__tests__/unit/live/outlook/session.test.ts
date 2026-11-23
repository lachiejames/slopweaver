/**
 * The Outlook session in `live/outlook/session.ts`, over a throwaway home and no network: `withOutlookGrantLock`
 * runs the act while the lock is held and releases it afterwards however the act ends, and `resolveOutlookClient`
 * refuses on the stored state alone (no grant, a grant short of a scope, no client id) before any token is bought.
 */
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { operationLockDir } from "../../../../admit/operationLockPath.js";
import { err, ok, unwrap, unwrapErr } from "../../../../lib/result.js";
import { OutlookErrors } from "../../../../live/outlook/errors.js";
import {
  requireOutlookClientId,
  resolveOutlookClient,
  withOutlookGrantLock,
} from "../../../../live/outlook/session.js";
import { writeOutlookGrant } from "../../../../secrets/outlookGrant.js";
import { writeSecretFile } from "../../../../secrets/store.js";

const homes: string[] = [];
let savedClientId: string | undefined;

/** A fresh state home for one test. */
function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "outlook-session-"));
  homes.push(home);
  return home;
}

/** The lock files currently held under a home. */
function heldLocks({ home }: { home: string }): readonly string[] {
  return readdirSync(operationLockDir({ home })).filter((name) => name.endsWith(".lock"));
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
    });

    expect(unwrap(result)).toBe("act value");
    expect(seenDuring.map((held) => held.length)).toEqual([1]);
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
    });
    const second = await withOutlookGrantLock({
      act: async () => {
        order.push("second");
        return ok(2);
      },
      home,
    });

    expect(unwrap(second)).toBe(2);
    expect(order).toEqual(["first", "second"]);
  });

  it("hands back the act's own failure unchanged and still releases the lock", async () => {
    const home = freshHome();

    const result = await withOutlookGrantLock({
      act: async () => err(OutlookErrors.notConnected()),
      home,
    });

    expect(unwrapErr(result)).toEqual(OutlookErrors.notConnected());
    expect(heldLocks({ home })).toEqual([]);
  });

  it("releases the lock when the act throws, and lets the throw through", async () => {
    const home = freshHome();

    const thrown = withOutlookGrantLock({
      act: async () => {
        throw new Error("synthetic act failure");
      },
      home,
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
    const home = freshHome();
    unwrap(writeSecretFile({ home, name: "outlook-client-id", value: "00000000-0000-0000-0000-000000000000" }));

    expect(unwrap(requireOutlookClientId({ home }))).toBe("00000000-0000-0000-0000-000000000000");
  });
});

describe("resolveOutlookClient", () => {
  it("refuses a home with no grant as not connected, before reading a client id", async () => {
    const refused = await resolveOutlookClient({ capabilities: ["read"], home: freshHome() });

    expect(unwrapErr(refused)).toEqual(OutlookErrors.notConnected());
  });

  it("refuses a grant that lacks a capability's permission, naming it", async () => {
    const home = freshHome();
    unwrap(
      writeOutlookGrant({
        grant: {
          account: "owner@example.test",
          grantedAtIso: "2026-10-17T00:00:00.000Z",
          homeAccountId: "uid.tid",
          msalCache: "{}",
          scopes: ["User.Read", "Mail.Read"],
        },
        home,
      }),
    );

    const refused = await resolveOutlookClient({ capabilities: ["read", "send"], home });

    const error = unwrapErr(refused);
    expect(error).toEqual(OutlookErrors.scopeMissing({ granted: ["User.Read", "Mail.Read"], missing: ["Mail.Send"] }));
    // A mail-only refusal names exactly the command it named before the calendar door existed.
    expect(error.message).toBe(
      "the stored Outlook grant is missing Mail.Send — re-run `slopweaver outlook connect --grant full` and approve it",
    );
  });

  it("refuses the calendar door on a mail-only grant, naming the one command that adds the calendar", async () => {
    const home = freshHome();
    unwrap(
      writeOutlookGrant({
        grant: {
          account: "owner@example.test",
          grantedAtIso: "2026-10-17T00:00:00.000Z",
          homeAccountId: "uid.tid",
          msalCache: "{}",
          scopes: ["User.Read", "Mail.Read", "MailboxSettings.Read", "Mail.ReadWrite"],
        },
        home,
      }),
    );

    const refused = await resolveOutlookClient({ capabilities: ["calendar"], home });

    expect(unwrapErr(refused).message).toBe(
      "the stored Outlook grant is missing Calendars.Read — re-run `slopweaver outlook connect --calendar` and approve it",
    );
  });

  it("refuses a sufficient grant when no client id is configured", async () => {
    const home = freshHome();
    unwrap(
      writeOutlookGrant({
        grant: {
          account: "owner@example.test",
          grantedAtIso: "2026-10-17T00:00:00.000Z",
          homeAccountId: "uid.tid",
          msalCache: "{}",
          scopes: ["User.Read", "Mail.Read"],
        },
        home,
      }),
    );

    const refused = await resolveOutlookClient({ capabilities: ["read"], home });

    expect(unwrapErr(refused).code).toBe("CREDENTIAL_UNREADABLE");
    expect(heldLocks({ home })).toEqual([]);
  });
});
