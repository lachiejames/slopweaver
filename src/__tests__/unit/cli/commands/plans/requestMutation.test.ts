/**
 * What a parsed `plans` request asks the register to change, and the words a successful change reports.
 */
import { describe, expect, it } from "vitest";

import { didWord, mutationFor } from "../../../../../cli/commands/plans/requestMutation.js";

const NOW = "2026-11-04T00:00:00.000Z";

describe("mutationFor", () => {
  it("asks for a usage limit with the allowance it is a share of", () => {
    const mutation = mutationFor({
      nowIso: NOW,
      request: {
        alias: "plan-a",
        allowance: { kind: "weekly-window" },
        provider: "claude",
        usageLimitPercent: 40,
        verb: "set-usage-limit",
      },
    });
    expect(mutation).toStrictEqual({
      alias: "plan-a",
      allowance: { kind: "weekly-window" },
      kind: "set-usage-limit",
      provider: "claude",
      usageLimitPercent: 40,
    });
  });

  it("stamps a pause with the instant it was asked", () => {
    const mutation = mutationFor({
      nowIso: NOW,
      request: { alias: "plan-a", provider: "codex", reason: "resting", verb: "pause" },
    });
    expect(mutation).toStrictEqual({
      alias: "plan-a",
      kind: "pause",
      paused: { reason: "resting", sinceIso: NOW },
      provider: "codex",
    });
  });

  it("asks for a lapse with the instant the command line gave", () => {
    const mutation = mutationFor({
      nowIso: NOW,
      request: { alias: "plan-a", lapsesAtIso: "2026-11-17T00:00:00Z", provider: "claude", verb: "lapse" },
    });
    expect(mutation).toStrictEqual({
      alias: "plan-a",
      kind: "set-lapse",
      lapsesAtIso: "2026-11-17T00:00:00Z",
      provider: "claude",
    });
  });

  it("asks a re-home for the new store path under the same alias", () => {
    const mutation = mutationFor({
      nowIso: NOW,
      request: { alias: "plan-a", provider: "claude", storeDir: "/new/a", verb: "set-store-dir" },
    });
    expect(mutation).toStrictEqual({ alias: "plan-a", kind: "set-store-dir", provider: "claude", storeDir: "/new/a" });
  });

  it("asks for nothing on a read-only verb", () => {
    expect(mutationFor({ nowIso: NOW, request: { provider: undefined, verb: "list" } })).toBeUndefined();
  });

  it("asks a validate for a projection repair only when told to repair", () => {
    expect([
      mutationFor({ nowIso: NOW, request: { repairProjection: true, verb: "validate" } }),
      mutationFor({ nowIso: NOW, request: { repairProjection: false, verb: "validate" } }),
    ]).toStrictEqual([{ kind: "repair-projection" }, undefined]);
  });
});

describe("didWord", () => {
  it("reports a usage limit as a share of its allowance", () => {
    const word = didWord({
      request: {
        alias: "plan-a",
        allowance: { kind: "monthly-spend" },
        provider: "codex",
        usageLimitPercent: 100,
        verb: "set-usage-limit",
      },
    });
    expect(word).toBe("set the usage limit for codex/plan-a to 100% of its monthly-spend allowance");
  });

  it("reports a lapse with its instant", () => {
    const word = didWord({
      request: { alias: "plan-a", lapsesAtIso: "2026-11-17T00:00:00Z", provider: "claude", verb: "lapse" },
    });
    expect(word).toBe("recorded that claude/plan-a's paid subscription lapses at 2026-11-17T00:00:00Z");
  });

  it("reports an addressed verb in the past tense", () => {
    expect(didWord({ request: { alias: "plan-a", provider: "claude", verb: "resume" } })).toBe("resumed claude/plan-a");
  });

  it("reports a pin as pinned, never a suffix glued onto the verb", () => {
    expect(didWord({ request: { alias: "plan-a", provider: "claude", verb: "pin" } })).toBe("pinned claude/plan-a");
  });

  it("reports a projection regenerated only when validate was told to repair", () => {
    expect(didWord({ request: { repairProjection: true, verb: "validate" } })).toBe(
      "regenerated the Claude projection from the register",
    );
    expect(didWord({ request: { repairProjection: false, verb: "validate" } })).toBe("validated the register");
  });

  it("says no claude plan is pinned after an unpin, because the register holds at most one claude pin", () => {
    expect(didWord({ request: { alias: "plan-a", provider: "claude", verb: "unpin" } })).toBe(
      "took the pin off claude/plan-a; no claude plan is pinned now",
    );
  });

  it("tells a moved Claude row to sign in again, since its store path picks the sign-in", () => {
    const request = { alias: "plan-a", provider: "claude", storeDir: "/new/a", verb: "set-store-dir" } as const;
    expect(didWord({ request })).toBe(
      "moved claude/plan-a to /new/a, keeping its alias; sign in again there, since the store path picks the sign-in",
    );
  });

  it("tells a moved Codex row its address was cleared and how it is recorded again", () => {
    const request = { alias: "codex-a", provider: "codex", storeDir: "/new/x", verb: "set-store-dir" } as const;
    expect(didWord({ request })).toBe(
      "moved codex/codex-a to /new/x, keeping its alias and clearing its recorded address; sign in again there, " +
        "then run `slopweaver plans sync-accounts` to record it",
    );
  });

  it("claims nothing about the other codex rows after an unpin, because several may still be pinned", () => {
    expect(didWord({ request: { alias: "codex-one", provider: "codex", verb: "unpin" } })).toBe(
      "took the pin off codex/codex-one",
    );
  });
});
