import { describe, expect, it } from "vitest";

import { codexConnectDestinations, codexConnectRegistration } from "../../../plans/connectPlan.js";
import { row, snapshotOf } from "../cli/commands/plans/plansRunFixtures.js";

const HOME = "/sw";
const codexOne = row({ alias: "codex-1", provider: "codex", storeDir: "/x" });

describe("codexConnectDestinations", () => {
  it("offers codex-1 first on a fresh install whose derived register holds no Codex row", () => {
    const snapshot = snapshotOf({ plans: [], source: "derived" });
    const destinations = codexConnectDestinations({ home: HOME, snapshot });
    expect(destinations[0]).toEqual({ alias: "codex-1", storeDir: "/sw/codex-accounts/codex-1" });
    expect(destinations.length).toBe(99);
  });

  it("offers numbered aliases, skipping one a row holds and one the removal history holds", () => {
    const snapshot = snapshotOf({ plans: [codexOne] });
    const withRemoved = {
      ...snapshot,
      document: {
        ...snapshot.document,
        removed: [{ alias: "codex-2", provider: "codex", removedAtIso: "2026-11-01T00:00:00.000Z", storeDir: "/y" }],
      },
    };
    const destinations = codexConnectDestinations({ home: HOME, snapshot: withRemoved });
    expect(destinations.slice(0, 2)).toEqual([
      { alias: "codex-3", storeDir: "/sw/codex-accounts/codex-3" },
      { alias: "codex-4", storeDir: "/sw/codex-accounts/codex-4" },
    ]);
    expect(destinations.length).toBe(97);
  });

  it("skips a store a row spells another way, so a trailing slash or a `..` never frees its directory", () => {
    const snapshot = snapshotOf({
      plans: [
        row({ alias: "legacy", provider: "codex", storeDir: "/sw/codex-accounts/codex-1/" }),
        row({ alias: "older", provider: "codex", storeDir: "/sw/codex-accounts/x/../codex-2" }),
      ],
    });
    const destinations = codexConnectDestinations({ home: HOME, snapshot });
    expect(destinations[0]).toEqual({ alias: "codex-3", storeDir: "/sw/codex-accounts/codex-3" });
  });
});

describe("codexConnectRegistration", () => {
  const fresh = { alias: "codex-3", storeDir: "/sw/codex-accounts/codex-3" };
  const addedRow = {
    alias: "codex-3",
    allowance: { kind: "weekly-window" },
    email: "b@example.com",
    provider: "codex",
    storeDir: "/sw/codex-accounts/codex-3",
    usageLimitPercent: 100,
  };

  it("adds a weekly-window row at no usage limit, adopting a derived register first", () => {
    const snapshot = snapshotOf({ plans: [row()], source: "derived" });
    expect(codexConnectRegistration({ destination: fresh, email: "b@example.com", snapshot })).toEqual({
      adopt: true,
      change: { kind: "add", row: addedRow },
      kind: "register",
    });
  });

  it("adds without adopting once the register is written", () => {
    const snapshot = snapshotOf({ plans: [codexOne], source: "registered" });
    expect(codexConnectRegistration({ destination: fresh, email: "b@example.com", snapshot })).toEqual({
      adopt: false,
      change: { kind: "add", row: addedRow },
      kind: "register",
    });
  });

  it("refuses an account already connected under another alias, whatever its case", () => {
    const snapshot = snapshotOf({ plans: [{ ...codexOne, email: "A@Example.com" }] });
    expect(codexConnectRegistration({ destination: fresh, email: "a@example.com", snapshot })).toEqual({
      detail: "a@example.com is already connected as codex-1; a second copy of one account adds no capacity",
      failure: "DUPLICATE_ACCOUNT",
      kind: "refuse",
    });
  });

  it("refuses a sign-in that named no account, since it cannot be checked for a twin", () => {
    const snapshot = snapshotOf({ plans: [codexOne] });
    expect(codexConnectRegistration({ destination: fresh, email: undefined, snapshot })).toEqual({
      detail: "Codex finished the sign-in without naming the account, so it was not added",
      failure: "ACCOUNT_UNKNOWN",
      kind: "refuse",
    });
  });
});
