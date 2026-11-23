/**
 * `slopweaver claude spend` over injected effects and a throwaway home. What is under test is what the verb records:
 * a successful strict read is recorded and read back; a throttle, a drifted field, an absent block, an unknown plan or
 * an unbound one records nothing — so a good reading is never overwritten by a zero.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ok, unwrap } from "#lib/result.js";

import type { ClaudeIdentityAssertion } from "../../../../../claude/identityAssertions.js";
import type { ResetResponse } from "../../../../../claude/resetExchange.js";
import { claudeSpendVerdict } from "../../../../../claude/spendPolicy.js";
import { latestClaudeSpendReading, recordClaudeSpendReading } from "../../../../../claude/spendStore.js";
import {
  CLAUDE_SPEND_FLAG_NAMES,
  type ClaudeSpendDeps,
  runClaudeSpendWith,
} from "../../../../../cli/commands/claude/spendRun.js";
import { EXIT_DEFERRED, EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { claudeManifest } from "../../../../../cli/manifests/claude.js";

const ORG = "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0";
const NOW = "2026-11-04T10:00:00.000Z";

const ASSERTION: ClaudeIdentityAssertion = {
  alias: "plan-six",
  assertedAtIso: "2026-11-01T00:00:00.000Z",
  email: "six@example.test",
  organizationId: ORG,
};

/** An answer carrying a 500.00 USD month with `usedMinor` spent. */
function spendAnswer({ usedMinor }: { usedMinor: number }): { readonly bodyText: string; readonly status: number } {
  return {
    bodyText: JSON.stringify({
      extra_usage: {
        currency: "USD",
        decimal_places: 2,
        is_enabled: true,
        monthly_limit: 50_000,
        spend_limit_reached: false,
        used_credits: usedMinor,
      },
    }),
    status: 200,
  };
}

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "sw-claude-spend-run-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** Deps over a bound default-slot login and one answer, counting reads. */
function depsOf({
  assertions = [ASSERTION],
  status,
}: {
  assertions?: readonly ClaudeIdentityAssertion[];
  status: ResetResponse;
}): { readonly deps: ClaudeSpendDeps; readonly reads: { count: number } } {
  const reads = { count: 0 };
  const deps: ClaudeSpendDeps = {
    login: {
      probe: async () => ({ organizationId: ORG, status: 200 }),
      read: ({ storeDir }) =>
        storeDir === undefined
          ? {
              claudeAiOauth: {
                accessToken: "fake-access",
                expiresAt: Date.parse("2026-11-04T16:00:00Z"),
                scopes: ["user:profile"],
              },
            }
          : undefined,
    },
    nowIso: () => NOW,
    readAccounts: async () =>
      ok([
        {
          alias: "plan-six",
          allowance: { kind: "monthly-spend" },
          storeDir: join(home, "store-six"),
          usageLimitPercent: 50,
        },
      ]),
    readAssertions: () => assertions,
    record: recordClaudeSpendReading,
    requestStatus: async () => {
      reads.count += 1;
      return status;
    },
  };
  return { deps, reads };
}

/** The argv a dispatched `claude spend` sees. */
function argvOf({ flags }: { flags: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "claude", "spend", "--home", home, ...flags];
}

/** The plan's recorded reading, read back at NOW. */
function recorded(): ReturnType<typeof unwrap<unknown, unknown>> {
  return unwrap(latestClaudeSpendReading({ alias: "plan-six", home, nowIso: NOW }));
}

describe("claude spend", () => {
  it("records a successful read, which routing then reads back", async () => {
    const { deps, reads } = depsOf({ status: spendAnswer({ usedMinor: 12_345 }) });
    const code = await runClaudeSpendWith({ argv: argvOf({ flags: ["--plan", "plan-six"] }), deps });
    expect(code).toBe(EXIT_OK);
    expect(reads.count).toBe(1);
    expect(recorded()).toEqual({
      alias: "plan-six",
      currency: "USD",
      decimalPlaces: 2,
      isEnabled: true,
      monthlyLimitMinor: 50_000,
      observedAtIso: NOW,
      spendLimitReached: false,
      usedMinor: 12_345,
    });
  });

  it("exits 4 on a throttle and records nothing", async () => {
    const { deps } = depsOf({ status: { bodyText: "", retryAfterSeconds: 3600, status: 429 } });
    const code = await runClaudeSpendWith({ argv: argvOf({ flags: ["--plan", "plan-six"] }), deps });
    expect(code).toBe(EXIT_DEFERRED);
    expect(recorded()).toBeUndefined();
  });

  it("exits 4 when no answer came back, and records nothing", async () => {
    const { deps } = depsOf({ status: { reason: "the request failed before an answer came back" } });
    const code = await runClaudeSpendWith({ argv: argvOf({ flags: ["--plan", "plan-six"] }), deps });
    expect(code).toBe(EXIT_DEFERRED);
    expect(recorded()).toBeUndefined();
  });

  it("exits 3 on an answer with no spend block, and records nothing rather than a zero", async () => {
    const { deps } = depsOf({ status: { bodyText: JSON.stringify({ seven_day: null }), status: 200 } });
    const code = await runClaudeSpendWith({ argv: argvOf({ flags: ["--plan", "plan-six"] }), deps });
    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(recorded()).toBeUndefined();
  });

  it("exits 3 on an enabled block with a null spend, and records nothing", async () => {
    const answer = spendAnswer({ usedMinor: 0 });
    const bodyText = answer.bodyText.replace('"used_credits":0', '"used_credits":null');
    const { deps } = depsOf({ status: { bodyText, status: 200 } });
    const code = await runClaudeSpendWith({ argv: argvOf({ flags: ["--plan", "plan-six"] }), deps });
    expect(bodyText).toContain('"used_credits":null');
    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(recorded()).toBeUndefined();
  });

  it("records a limit-reached block with a null spend, and its verdict is the refusal, never headroom", async () => {
    const bodyText = JSON.stringify({
      extra_usage: {
        currency: "USD",
        decimal_places: 2,
        is_enabled: true,
        monthly_limit: 50_000,
        spend_limit_reached: true,
        used_credits: null,
      },
    });
    const { deps } = depsOf({ status: { bodyText, status: 200 } });
    const code = await runClaudeSpendWith({ argv: argvOf({ flags: ["--plan", "plan-six"] }), deps });
    expect(code).toBe(EXIT_OK);
    const reading = unwrap(latestClaudeSpendReading({ alias: "plan-six", home, nowIso: NOW }));
    expect(reading).toEqual(expect.objectContaining({ spendLimitReached: true, usedMinor: null }));
    const verdict = claudeSpendVerdict({ alias: "plan-six", nowIso: NOW, reading, usageLimitPercent: 50 });
    expect(verdict.kind).toBe("provider-refused");
  });

  it("exits 1 on a drifted answer, and records nothing", async () => {
    const { deps } = depsOf({
      status: { bodyText: JSON.stringify({ extra_usage: { is_enabled: true } }), status: 200 },
    });
    const code = await runClaudeSpendWith({ argv: argvOf({ flags: ["--plan", "plan-six"] }), deps });
    expect(code).toBe(EXIT_ERROR);
    expect(recorded()).toBeUndefined();
  });

  it("keeps an earlier good reading when a later read is throttled", async () => {
    const good = depsOf({ status: spendAnswer({ usedMinor: 700 }) });
    expect(await runClaudeSpendWith({ argv: argvOf({ flags: ["--plan", "plan-six"] }), deps: good.deps })).toBe(
      EXIT_OK,
    );
    const throttled = depsOf({ status: { bodyText: "", status: 429 } });
    expect(await runClaudeSpendWith({ argv: argvOf({ flags: ["--plan", "plan-six"] }), deps: throttled.deps })).toBe(
      EXIT_DEFERRED,
    );
    expect(recorded()).toEqual(expect.objectContaining({ usedMinor: 700 }));
  });

  it("refuses an unknown plan before any read", async () => {
    const { deps, reads } = depsOf({ status: spendAnswer({ usedMinor: 1 }) });
    const code = await runClaudeSpendWith({ argv: argvOf({ flags: ["--plan", "plan-nine"] }), deps });
    expect(code).toBe(EXIT_USAGE);
    expect(reads.count).toBe(0);
  });

  it("refuses a plan no enrolment binds before any read", async () => {
    const { deps, reads } = depsOf({ assertions: [], status: spendAnswer({ usedMinor: 1 }) });
    const code = await runClaudeSpendWith({ argv: argvOf({ flags: ["--plan", "plan-six"] }), deps });
    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(reads.count).toBe(0);
  });

  it("refuses a missing --plan as a caller mistake", async () => {
    const { deps, reads } = depsOf({ status: spendAnswer({ usedMinor: 1 }) });
    const code = await runClaudeSpendWith({ argv: argvOf({ flags: [] }), deps });
    expect(code).toBe(EXIT_USAGE);
    expect(reads.count).toBe(0);
  });

  it("advertises the flags its parser accepts", () => {
    expect(CLAUDE_SPEND_FLAG_NAMES).toEqual(["--home", "--json", "--plan"]);
    expect(claudeManifest["spend"]!.meta.usage).toBe(
      "usage: slopweaver claude spend --plan <alias> [--json] [--home <dir>]",
    );
  });
});
