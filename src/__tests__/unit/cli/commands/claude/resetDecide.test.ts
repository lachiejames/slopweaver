/**
 * The claim decision over a real claims journal in a throwaway home: which claim a run sends and under which id,
 * or the exit it ends on without sending. The property that costs a reset when wrong is that nothing is journalled
 * as an intent unless the claim is actually about to be sent.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap } from "#lib/result.js";

import { readClaudeResetJournal } from "../../../../../claude/resetJournalStore.js";
import type { ClaudeResetBlock } from "../../../../../claude/resetStatus.js";
import { type ClaimContext, claimToSend } from "../../../../../cli/commands/claude/resetDecide.js";

const ORG = "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0";

const BLOCK: ClaudeResetBlock = {
  atLimit: true,
  eligible: true,
  exhausted: ["seven_day"],
  grants: [
    { clears: ["seven_day"], id: "welcome-1", paused: false, resetsLeft: 2, usableNow: true, useRequiresLimit: true },
  ],
  nextGrantId: "welcome-1",
};

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "sw-claude-reset-decide-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** A context over the throwaway home, at a limit, with the given overrides. */
function contextOf({
  block = BLOCK,
  requestedGrant,
}: {
  block?: ClaudeResetBlock;
  requestedGrant?: string;
}): ClaimContext {
  return {
    alias: "plan-five",
    assertion: { alias: "plan-five", assertedAtIso: "2026-09-01T00:00:00.000Z", organizationId: ORG },
    block,
    earlyAllowed: false,
    home,
    newRequestId: () => "req-new",
    readAtIso: "2026-09-30T08:00:00.000Z",
    requestedGrant,
  };
}

describe("claimToSend", () => {
  it("journals a fresh intent and hands back the claim it covers", () => {
    expect(claimToSend({ context: contextOf({}) })).toEqual({
      body: JSON.stringify({ grant_id: "welcome-1", program: "cedar_ember", request_id: "req-new" }),
      grantId: "welcome-1",
      requestId: "req-new",
      resend: false,
      url: `https://api.anthropic.com/api/organizations/${ORG}/reset_rate_limits`,
    });
    expect(unwrap(readClaudeResetJournal({ home })).map((row) => [row.kind, row.requestId])).toEqual([
      ["intent", "req-new"],
    ]);
  });

  it("defers during a cooldown and journals nothing", () => {
    const block = { ...BLOCK, cooldownUntilIso: "2026-09-30T09:00:00.000Z" };

    expect(claimToSend({ context: contextOf({ block }) })).toBe(4);
    expect(unwrap(readClaudeResetJournal({ home }))).toEqual([]);
  });

  it("ends a --grant the read does not list as nothing to redeem, journalling nothing", () => {
    expect(claimToSend({ context: contextOf({ requestedGrant: "nope" }) })).toBe(3);
    expect(unwrap(readClaudeResetJournal({ home }))).toEqual([]);
  });
});
