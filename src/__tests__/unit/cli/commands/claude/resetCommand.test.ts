/**
 * `slopweaver claude reset` over injected effects and a throwaway home. What is under test is the decision the verb
 * makes and what it leaves in the claims journal: a read never claims; a claim journals its intent BEFORE sending;
 * an unsettled attempt is resent under its OWN request id; an attempt the status shows is over is closed and nothing
 * is sent; and a claim with no window at its limit is refused unless the hatch is open.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { err, ok, unwrap } from "#lib/result.js";

import type { DoorLedgerPort } from "../../../../../admit/doorLedgerPort.js";
import { ClaudeRotationErrors } from "../../../../../claude/errors.js";
import type { ClaudeIdentityAssertion } from "../../../../../claude/identityAssertions.js";
import type { ClaudeResetIntentRow } from "../../../../../claude/resetAttempt.js";
import type { ResetResponse } from "../../../../../claude/resetExchange.js";
import { appendClaudeResetJournal, readClaudeResetJournal } from "../../../../../claude/resetJournalStore.js";
import {
  CLAUDE_RESET_FLAG_NAMES,
  type ClaudeResetDeps,
  runClaudeResetWith,
} from "../../../../../cli/commands/claude/resetRun.js";
import { claudeManifest } from "../../../../../cli/manifests/claude.js";
import { memoryDoorLedger, unreachableDoorLedger } from "../../../../doorLedgerFixture.js";

const ORG = "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0";
const NOW = "2026-09-30T08:00:00.000Z";

const ASSERTION: ClaudeIdentityAssertion = {
  alias: "plan-five",
  assertedAtIso: "2026-09-01T00:00:00.000Z",
  email: "five@example.test",
  organizationId: ORG,
};

/** A status answer body with one grant, at a limit or not. */
function statusBody({
  atLimit,
  resetsLeft = 2,
  useRequiresLimit = true,
}: {
  atLimit: boolean;
  resetsLeft?: number;
  useRequiresLimit?: boolean;
}): string {
  return JSON.stringify({
    cedar_ember: {
      at_limit: atLimit,
      eligible: true,
      exhausted: atLimit ? ["seven_day"] : [],
      grants: [
        {
          clears: ["seven_day"],
          id: "welcome-1",
          resets_left: resetsLeft,
          usable_now: true,
          use_requires_limit: useRequiresLimit,
        },
      ],
      next_grant_id: "welcome-1",
    },
  });
}

/** Everything one run did through its effects. */
interface Recorded {
  readonly claims: { url: string; body: unknown }[];
  statusReads: number;
}

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "sw-claude-reset-run-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** Deps over a bound default-slot login, a status body and a claim answer, recording every request. */
function depsOf({
  assertions = [ASSERTION],
  doorLedger = memoryDoorLedger().port,
  claim = { bodyText: JSON.stringify({ cleared: ["seven_day"], resets_left: 1, result: "reset" }), status: 200 },
  earlyAllowed = false,
  status,
}: {
  assertions?: readonly ClaudeIdentityAssertion[];
  doorLedger?: DoorLedgerPort;
  claim?: ResetResponse;
  earlyAllowed?: boolean;
  status: ResetResponse;
}): { readonly deps: ClaudeResetDeps; readonly recorded: Recorded } {
  const recorded: Recorded = { claims: [], statusReads: 0 };
  const deps: ClaudeResetDeps = {
    doorLedger,
    earlyAllowed,
    login: {
      probe: async () => ({ organizationId: ORG, status: 200 }),
      read: ({ storeDir }) =>
        storeDir === undefined
          ? {
              claudeAiOauth: {
                accessToken: "fake-access",
                expiresAt: Date.parse("2026-09-30T16:00:00Z"),
                scopes: ["user:profile"],
              },
            }
          : undefined,
    },
    newRequestId: () => "req-new",
    nowIso: () => NOW,
    readAccounts: async () => ok([{ alias: "plan-five", storeDir: join(home, "store-five") }]),
    readAssertions: () => assertions,
    requestClaim: async ({ body, url }) => {
      recorded.claims.push({ body: JSON.parse(body), url });
      return claim;
    },
    requestStatus: async () => {
      recorded.statusReads += 1;
      return status;
    },
  };
  return { deps, recorded };
}

/** The argv a dispatched `claude reset` sees. */
function argvOf({ flags }: { flags: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "claude", "reset", "--home", home, ...flags];
}

const INTENT: ClaudeResetIntentRow = {
  alias: "plan-five",
  atIso: "2026-09-30T07:00:00.000Z",
  atLimitAtIntent: true,
  grantId: "welcome-1",
  kind: "intent",
  requestId: "req-open",
  resetsLeftAtIntent: 2,
  v: 1,
};

describe("the claude reset verb", () => {
  it("is reachable through the claude manifest as a door-routed external write", () => {
    expect(claudeManifest["reset"]!.meta.effect).toBe("external-write");
    expect(claudeManifest["reset"]!.meta.doorRouted).toBe(true);
    expect(CLAUDE_RESET_FLAG_NAMES).toEqual(["--claim", "--grant", "--home", "--json", "--plan"]);
  });

  it("refuses an unknown plan as a caller mistake before reading anything", async () => {
    const { deps, recorded } = depsOf({ status: { bodyText: statusBody({ atLimit: true }), status: 200 } });

    expect(await runClaudeResetWith({ argv: argvOf({ flags: ["--plan", "plan-nine"] }), deps })).toBe(2);
    expect(recorded.statusReads).toBe(0);
  });

  it("reads no status and claims nothing when the plans register does not read, however --claim is set", async () => {
    const { deps, recorded } = depsOf({ status: { bodyText: statusBody({ atLimit: true }), status: 200 } });
    const unread: ClaudeResetDeps = {
      ...deps,
      readAccounts: async () => err(ClaudeRotationErrors.accountConfigUnreadable({ path: join(home, "plans.json") })),
    };

    expect(
      await runClaudeResetWith({ argv: argvOf({ flags: ["--plan", "plan-five", "--claim"] }), deps: unread }),
    ).toBe(1);
    expect([recorded.statusReads, recorded.claims, unwrap(readClaudeResetJournal({ home }))]).toEqual([0, [], []]);
  });

  it("refuses --grant without --claim as a caller mistake", async () => {
    const { deps } = depsOf({ status: { bodyText: statusBody({ atLimit: true }), status: 200 } });

    expect(await runClaudeResetWith({ argv: argvOf({ flags: ["--plan", "plan-five", "--grant", "g"] }), deps })).toBe(
      2,
    );
  });

  it("ends a plan with no enrollment as nothing to read", async () => {
    const { deps, recorded } = depsOf({
      assertions: [],
      status: { bodyText: statusBody({ atLimit: true }), status: 200 },
    });

    expect(await runClaudeResetWith({ argv: argvOf({ flags: ["--plan", "plan-five"] }), deps })).toBe(3);
    expect(recorded.statusReads).toBe(0);
  });

  it("reads without claiming when --claim is absent", async () => {
    const { deps, recorded } = depsOf({ status: { bodyText: statusBody({ atLimit: true }), status: 200 } });

    expect(await runClaudeResetWith({ argv: argvOf({ flags: ["--plan", "plan-five"] }), deps })).toBe(0);
    expect(recorded.statusReads).toBe(1);
    expect(recorded.claims).toEqual([]);
    expect(unwrap(readClaudeResetJournal({ home }))).toEqual([]);
  });

  it("defers a throttled status read and claims nothing", async () => {
    const { deps, recorded } = depsOf({ status: { bodyText: "", retryAfterSeconds: 60, status: 429 } });

    expect(await runClaudeResetWith({ argv: argvOf({ flags: ["--plan", "plan-five", "--claim"] }), deps })).toBe(4);
    expect(recorded.claims).toEqual([]);
  });

  it("sends no claim and exits 1 when the store cannot record the door decision", async () => {
    const { deps, recorded } = depsOf({
      doorLedger: unreachableDoorLedger(),
      status: { bodyText: statusBody({ atLimit: true }), status: 200 },
    });

    expect(await runClaudeResetWith({ argv: argvOf({ flags: ["--plan", "plan-five", "--claim"] }), deps })).toBe(1);
    expect(recorded.claims).toEqual([]);
  });

  it("claims at a limit: journals the intent, sends the provider's own body, journals the reset", async () => {
    const { deps, recorded } = depsOf({ status: { bodyText: statusBody({ atLimit: true }), status: 200 } });

    expect(await runClaudeResetWith({ argv: argvOf({ flags: ["--plan", "plan-five", "--claim"] }), deps })).toBe(0);
    expect(recorded.claims).toEqual([
      {
        body: { grant_id: "welcome-1", program: "cedar_ember", request_id: "req-new" },
        url: `https://api.anthropic.com/api/organizations/${ORG}/reset_rate_limits`,
      },
    ]);
    expect(unwrap(readClaudeResetJournal({ home })).map((row) => [row.kind, row.requestId])).toEqual([
      ["intent", "req-new"],
      ["outcome", "req-new"],
    ]);
  });

  it("refuses a spend with no window at its limit unless the hatch is open", async () => {
    const status = { bodyText: statusBody({ atLimit: false, useRequiresLimit: false }), status: 200 };
    const shut = depsOf({ status });

    expect(
      await runClaudeResetWith({ argv: argvOf({ flags: ["--plan", "plan-five", "--claim"] }), deps: shut.deps }),
    ).toBe(1);
    expect(shut.recorded.claims).toEqual([]);

    const open = depsOf({ earlyAllowed: true, status });

    expect(
      await runClaudeResetWith({ argv: argvOf({ flags: ["--plan", "plan-five", "--claim"] }), deps: open.deps }),
    ).toBe(0);
    expect(open.recorded.claims.length).toBe(1);
  });

  it("leaves the intent open and defers when the claim's answer never comes back", async () => {
    const { deps } = depsOf({
      claim: { reason: "the request failed before an answer came back" },
      status: { bodyText: statusBody({ atLimit: true }), status: 200 },
    });

    expect(await runClaudeResetWith({ argv: argvOf({ flags: ["--plan", "plan-five", "--claim"] }), deps })).toBe(4);
    expect(unwrap(readClaudeResetJournal({ home })).map((row) => row.kind)).toEqual(["intent"]);
  });

  it("resends an unsettled attempt under its OWN request id, never a new one", async () => {
    expect(appendClaudeResetJournal({ home, row: INTENT }).isOk()).toBe(true);
    const { deps, recorded } = depsOf({ status: { bodyText: statusBody({ atLimit: true }), status: 200 } });

    expect(await runClaudeResetWith({ argv: argvOf({ flags: ["--plan", "plan-five", "--claim"] }), deps })).toBe(0);
    expect(recorded.claims.map((claim) => claim.body)).toEqual([
      { grant_id: "welcome-1", program: "cedar_ember", request_id: "req-open" },
    ]);
  });

  it("closes an attempt the status shows landed, and sends nothing", async () => {
    expect(appendClaudeResetJournal({ home, row: INTENT }).isOk()).toBe(true);
    const { deps, recorded } = depsOf({
      status: { bodyText: statusBody({ atLimit: true, resetsLeft: 1 }), status: 200 },
    });

    expect(await runClaudeResetWith({ argv: argvOf({ flags: ["--plan", "plan-five", "--claim"] }), deps })).toBe(0);
    expect(recorded.claims).toEqual([]);
    expect(unwrap(readClaudeResetJournal({ home })).at(-1)).toEqual({
      alias: "plan-five",
      atIso: NOW,
      kind: "closed",
      reason: "grant welcome-1 holds 1 reset(s), down from 2",
      requestId: "req-open",
      v: 1,
    });
  });
});
