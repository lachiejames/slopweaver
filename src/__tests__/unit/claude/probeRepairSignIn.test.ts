/*
 * `renderRepair`'s skip line where only the owner's sign-in restores the store: the line names why no refresh can,
 * and the one verb that does. Split from `probeRepair.test.ts`, which covers the probe-and-repair sweep itself.
 */
import { describe, expect, it } from "vitest";

import type { ClaudeAccount } from "../../../claude/contracts.js";
import { ClaudeRotationErrors } from "../../../claude/errors.js";
import { renderRepair } from "../../../claude/probeRepair.js";
import type { ClaudeProbeResult } from "../../../claude/probeStore.js";
import { err } from "../../../lib/result.js";

const accountFor = ({ alias }: { alias: string }): ClaudeAccount => ({ alias, storeDir: `/stores/${alias}` });
const TWO = accountFor({ alias: "plan-two" });
const THREE = accountFor({ alias: "plan-three" });

const refusedProbe = ({ alias }: { alias: string }): ClaudeProbeResult => ({
  life: {
    alias,
    expiresAtIso: "2026-09-12T14:00:00.000Z",
    hasCredential: true,
    hasRefreshToken: true,
    refreshExpiresAtIso: "2026-10-11T12:00:12.000Z",
  },
  outcome: { alias, problem: "refused" },
  reading: err(ClaudeRotationErrors.credentialRejected({ alias, status: 401 })),
});

describe("renderRepair names the sign-in where no refresh can repair the store", () => {
  it("names the sign-in for a token refused with hours of life left, from either speaker", () => {
    const repair = {
      account: THREE,
      decision: { kind: "skip", reason: "access-not-expired" },
      first: refusedProbe({ alias: "plan-three" }),
    } as const;
    const tail =
      "plan-three was refused and NOT repaired — access-not-expired: a refusal on an unexpired token is a " +
      "superseded or revoked login, which no refresh repairs; sign in again with " +
      "`slopweaver claude signin --plan plan-three`";
    expect(renderRepair({ repair })).toBe(`claude routing: ${tail}`);
    expect(renderRepair({ repair, speaker: "claude watch" })).toBe(`claude watch: ${tail}`);
  });

  it("names the sign-in for a signed-out store and for an expired refresh grant", () => {
    const skip = ({ reason }: { reason: "no-credential" | "refresh-expired" }): string | undefined =>
      renderRepair({
        repair: { account: TWO, decision: { kind: "skip", reason }, first: refusedProbe({ alias: "plan-two" }) },
      });
    expect(skip({ reason: "no-credential" })).toBe(
      "claude routing: plan-two was refused and NOT repaired — no-credential: this store is signed out, which no " +
        "refresh repairs; sign in again with `slopweaver claude signin --plan plan-two`",
    );
    expect(skip({ reason: "refresh-expired" })).toBe(
      "claude routing: plan-two was refused and NOT repaired — refresh-expired: this store's refresh grant has " +
        "expired, which no refresh repairs; sign in again with `slopweaver claude signin --plan plan-two`",
    );
  });

  it("prescribes no sign-in where the reading does not establish one is the repair", () => {
    const repair = {
      account: TWO,
      decision: { kind: "skip", reason: "unknown-refresh-expiry" },
      first: refusedProbe({ alias: "plan-two" }),
    } as const;
    expect(renderRepair({ repair })).toBe(
      "claude routing: plan-two was refused and NOT repaired — unknown-refresh-expiry",
    );
  });
});
