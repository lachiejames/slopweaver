/**
 * The one-draft-per-receipt claim, round-tripped through a throwaway home: claimed, recorded, read back as drafted,
 * refused while held or abandoned, and released. Ids are invented.
 */
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  claimForward,
  draftedForwards,
  expenseKeyOf,
  openPerKeyOf,
  recordForward,
  releaseForward,
} from "../../../../../cli/commands/spend/forwardClaim.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { SpendForwardErrors } from "../../../../../spend/tasks/forwardErrors.js";
import type { TaskAct } from "../../../../../spend/tasks/read.js";
import { stateHomePaths } from "../../../../../stateHome.js";

const KEY = "Vendor|AUD|12000|2027-03-04";
const homes: string[] = [];

/** One open card expense with no invoice; every field the charge key reads is the caller's, defaulting to KEY's. */
function act({
  currency = "AUD",
  day = "2027-03-04",
  merchant = "Vendor",
  minor = 12000,
}: {
  currency?: string;
  day?: string;
  merchant?: string;
  minor?: number;
}): TaskAct {
  return {
    expense: {
      amount: { currency, minor },
      day,
      identity: { kind: "raw", merchant },
      merchant,
    },
    invoice: { kind: "none" },
    query: undefined,
  };
}

describe("expenseKeyOf and openPerKeyOf", () => {
  it("keys a charge by merchant, currency, minor amount and day", () => {
    expect(expenseKeyOf({ act: act({}) })).toBe(KEY);
    expect(expenseKeyOf({ act: act({ currency: "USD", day: "2027-05-06", merchant: "Other", minor: 1 }) })).toBe(
      "Other|USD|1|2027-05-06",
    );
  });

  it("counts two acts answering the same charge under one key, and each field that differs under its own", () => {
    const acts = [
      act({}),
      act({}),
      act({ day: "2027-03-05" }),
      act({ merchant: "Other" }),
      act({ currency: "USD" }),
      act({ minor: 1 }),
    ];
    expect([...openPerKeyOf({ acts })]).toEqual([
      [KEY, 2],
      ["Vendor|AUD|12000|2027-03-05", 1],
      ["Other|AUD|12000|2027-03-04", 1],
      ["Vendor|USD|12000|2027-03-04", 1],
      ["Vendor|AUD|1|2027-03-04", 1],
    ]);
  });

  it("counts nothing for an empty reading", () => {
    expect(openPerKeyOf({ acts: [] }).size).toBe(0);
  });
});

/** A throwaway home, removed after each test. */
function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "sw-forward-claim-"));
  homes.push(home);
  return home;
}

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

describe("claimForward", () => {
  it("claims a receipt once, and after the draft is recorded every later claim names that draft", () => {
    const home = freshHome();
    const claim = (): ReturnType<typeof claimForward> =>
      claimForward({ alive: () => true, expenseKey: KEY, home, pid: 7, receiptId: "r1" });
    expect(unwrap(claim())).toEqual({ kind: "claimed" });
    const draft = { draftId: "d-1", draftMessageId: "m-1", expenseKey: KEY, receiptId: "r1" };
    unwrap(recordForward({ draft, draftedAtIso: "2027-03-06T08:00:00.000Z", home, pid: 7 }));
    expect(unwrap(claim())).toEqual({ kind: "drafted", ...draft });
    expect(draftedForwards({ home })).toEqual([draft]);
  });

  it("refuses a claim another live run holds, and one a dead run abandoned", () => {
    const home = freshHome();
    unwrap(claimForward({ alive: () => true, expenseKey: KEY, home, pid: 7, receiptId: "r1" }));
    const held = unwrapErr(claimForward({ alive: () => true, expenseKey: KEY, home, pid: 8, receiptId: "r1" }));
    expect(held).toEqual(SpendForwardErrors.inFlight({ pid: 7, receiptId: "r1" }));
    const abandoned = unwrapErr(claimForward({ alive: () => false, expenseKey: KEY, home, pid: 8, receiptId: "r1" }));
    const path = join(stateHomePaths({ home }).spendForwards, "r1.json");
    expect(abandoned).toEqual(SpendForwardErrors.claimAbandoned({ path, pid: 7 }));
    expect(draftedForwards({ home })).toEqual([]);
  });

  it("refuses a receipt id that could name a path, and a claim file with no holder in it", () => {
    const home = freshHome();
    const traversal = unwrapErr(claimForward({ alive: () => true, expenseKey: KEY, home, pid: 7, receiptId: "../x" }));
    expect(traversal.code).toBe("FORWARD_RECEIPT_ID_INVALID");
    unwrap(claimForward({ alive: () => true, expenseKey: KEY, home, pid: 7, receiptId: "r2" }));
    writeFileSync(join(stateHomePaths({ home }).spendForwards, "r2.json"), "{", "utf8");
    const torn = unwrapErr(claimForward({ alive: () => true, expenseKey: KEY, home, pid: 7, receiptId: "r2" }));
    expect(torn.code).toBe("FORWARD_CLAIM_UNWRITTEN");
  });

  it("releases a claim so the receipt can be claimed again, and releasing twice is harmless", () => {
    const home = freshHome();
    unwrap(claimForward({ alive: () => true, expenseKey: KEY, home, pid: 7, receiptId: "r1" }));
    releaseForward({ home, receiptId: "r1" });
    releaseForward({ home, receiptId: "r1" });
    expect(readdirSync(stateHomePaths({ home }).spendForwards)).toEqual([]);
    expect(unwrap(claimForward({ alive: () => true, expenseKey: KEY, home, pid: 9, receiptId: "r1" }))).toEqual({
      kind: "claimed",
    });
  });

  it("reads no drafts from a home that never drafted one", () => {
    expect(draftedForwards({ home: freshHome() })).toEqual([]);
  });
});
