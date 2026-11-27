/**
 * `readClaudePlanSpends` over a real readings ledger in a throwaway home: each monthly-spend plan gets the verdict its
 * newest hour-fresh reading earns under its own usage limit, and a plan with none is named not-measured, never left out.
 */
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";

import type { ClaudeAccount } from "../../../claude/contracts.js";
import { monthlySpendAccount, readClaudePlanSpends } from "../../../claude/spendBudgets.js";
import { recordClaudeSpendReading } from "../../../claude/spendStore.js";
import { readingsInWindow } from "../../../readings/store.js";
import { stateHomePaths } from "../../../stateHome.js";

const NOW = "2026-11-04T10:00:00.000Z";

const MONTHLY = { kind: "monthly-spend" } as const;

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "sw-spend-budgets-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** Record one plan's reading of a 500.00 USD monthly limit, at its own observed instant. */
function record({
  alias,
  observedAtIso,
  usedMinor,
}: {
  alias: string;
  observedAtIso: string;
  usedMinor: number;
}): void {
  unwrap(
    recordClaudeSpendReading({
      home,
      nowIso: observedAtIso,
      reading: {
        alias,
        currency: "USD",
        decimalPlaces: 2,
        isEnabled: true,
        monthlyLimitMinor: 50_000,
        observedAtIso,
        spendLimitReached: false,
        usedMinor,
      },
    }),
  );
}

describe("monthlySpendAccount", () => {
  it("is true of a monthly-spend row only, a row naming no allowance being a weekly one", () => {
    expect(monthlySpendAccount({ account: { allowance: MONTHLY } })).toBe(true);
    expect(monthlySpendAccount({ account: { allowance: { kind: "weekly-window" } } })).toBe(false);
    expect(monthlySpendAccount({ account: {} })).toBe(false);
  });
});

describe("readClaudePlanSpends", () => {
  const ACCOUNTS: readonly ClaudeAccount[] = [
    { alias: "plan-one", storeDir: "/stores/one" },
    { alias: "plan-two", allowance: MONTHLY, storeDir: "/stores/two", usageLimitPercent: 50 },
    { alias: "plan-three", allowance: MONTHLY, storeDir: "/stores/three" },
    { alias: "plan-four", allowance: MONTHLY, storeDir: "/stores/four" },
  ];

  it("judges each monthly plan on its own fresh reading and limit, names the unread one, and skips a weekly plan", () => {
    record({ alias: "plan-two", observedAtIso: "2026-11-04T09:30:00.000Z", usedMinor: 10_000 });
    // Older than the hour, so it is no evidence.
    record({ alias: "plan-four", observedAtIso: "2026-11-04T08:30:00.000Z", usedMinor: 100 });

    const spends = readClaudePlanSpends({ accounts: ACCOUNTS, home, nowIso: NOW });

    expect(spends.map((spend) => [spend.alias, spend.verdict.kind])).toStrictEqual([
      ["plan-two", "open"],
      ["plan-three", "not-measured"],
      ["plan-four", "not-measured"],
    ]);
    // 100.00 of a 50% share of 500.00 is 40% of what the owner permits.
    expect(spends[0]!.verdict).toMatchObject({ kind: "open", usedFraction: 0.4 });
  });

  it("reads a plan at its owner's usage limit as usage-limit, in dollars", () => {
    record({ alias: "plan-two", observedAtIso: "2026-11-04T09:30:00.000Z", usedMinor: 25_000 });

    const [spend] = readClaudePlanSpends({ accounts: [ACCOUNTS[1]!], home, nowIso: NOW });

    expect(spend!.verdict.kind).toBe("usage-limit");
  });

  it("names a plan whose ledger cannot be read not-measured, its reason naming no path of the store it read", () => {
    const paths = stateHomePaths({ home });
    mkdirSync(paths.readings, { recursive: true });
    writeFileSync(paths.readingsIndexJsonl, "");
    chmodSync(paths.readings, 0o000);
    try {
      // The witness that the input carries the path: the ledger's own failure names it.
      const raw = unwrapErr(
        readingsInWindow({ fromIso: "2026-11-04T09:00:00.000Z", home, producer: "claude spend", toIso: NOW }),
      );
      expect(raw.code).toBe("STORE_UNREADABLE");
      expect(raw.message).toContain(home);

      const spends = readClaudePlanSpends({ accounts: [ACCOUNTS[1]!], home, nowIso: NOW });

      expect(spends).toStrictEqual([
        {
          alias: "plan-two",
          verdict: {
            kind: "not-measured",
            reason:
              "its spend readings could not be read — a recorded spend reading could not be read: " +
              "could not read the readings ledger — refusing rather than reporting it empty",
          },
        },
      ]);
      expect(JSON.stringify(spends)).not.toContain(home);
    } finally {
      chmodSync(paths.readings, 0o700);
    }
  });

  it("returns nothing for a fleet with no monthly-spend plan", () => {
    expect(readClaudePlanSpends({ accounts: [ACCOUNTS[0]!], home, nowIso: NOW })).toStrictEqual([]);
  });
});
