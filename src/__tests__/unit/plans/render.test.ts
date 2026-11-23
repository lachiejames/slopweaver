import { describe, expect, it } from "vitest";

import {
  codexAccountCell,
  pausedPlanNotice,
  registeredAccountCell,
  renderPlanAccount,
  renderPlanDiagnostic,
} from "../../../plans/render.js";
import type { RegisteredPlan } from "../../../plans/types.js";

const claudeRow = (over: Partial<RegisteredPlan> = {}): RegisteredPlan => ({
  alias: "plan-one",
  allowance: { kind: "weekly-window" },
  provider: "claude",
  storeDir: "/c1",
  usageLimitPercent: 100,
  ...over,
});

const codexRow = (over: Partial<RegisteredPlan> = {}): RegisteredPlan => ({
  alias: "codex-work",
  allowance: { kind: "weekly-window" },
  provider: "codex",
  usageLimitPercent: 100,
  storeDir: "/x1",
  ...over,
});

describe("registeredAccountCell", () => {
  it("can never decide a Codex address is bound — CACHED is its ceiling", () => {
    expect(registeredAccountCell({ plan: codexRow({ email: "owner@example.com" }) })).toStrictEqual({
      cell: { address: "owner@example.com", trust: "cached" },
      provider: "codex",
    });
  });

  it("reports an unmapped row as unmapped rather than blank, on either provider", () => {
    expect(registeredAccountCell({ plan: codexRow() }).cell).toStrictEqual({ trust: "unmapped" });
    expect(registeredAccountCell({ plan: claudeRow() }).cell).toStrictEqual({ trust: "unmapped" });
  });

  it("carries the register's cache for a Claude row, labelled as a cache", () => {
    expect(registeredAccountCell({ plan: claudeRow({ email: "first@example.com" }) }).cell).toStrictEqual({
      address: "first@example.com",
      trust: "cached",
    });
  });
});

describe("codexAccountCell", () => {
  it("maps a present address to a cache and an absent one to unmapped", () => {
    expect(codexAccountCell({ cachedEmail: "owner@example.com" })).toStrictEqual({
      address: "owner@example.com",
      trust: "cached",
    });
    expect(codexAccountCell({})).toStrictEqual({ trust: "unmapped" });
  });
});

describe("renderPlanAccount", () => {
  it("names the provider and the account, and no plan number", () => {
    expect(renderPlanAccount({ account: registeredAccountCell({ plan: claudeRow({ email: "a@b.com" }) }) })).toBe(
      "Claude · CACHED a@b.com",
    );
    expect(renderPlanAccount({ account: registeredAccountCell({ plan: codexRow({ email: "a@b.com" }) }) })).toBe(
      "Codex · CACHED a@b.com",
    );
    expect(renderPlanAccount({ account: registeredAccountCell({ plan: codexRow() }) })).toBe("Codex · UNMAPPED");
  });

  it("reads identically for two destinations mapping the same address, while the selectors stay separate", () => {
    const first = codexRow({ alias: "codex-work", email: "same@example.com", storeDir: "/x1" });
    const second = codexRow({ alias: "codex-spare", email: "same@example.com", storeDir: "/x2" });
    const line = "Codex · CACHED same@example.com";
    expect(renderPlanAccount({ account: registeredAccountCell({ plan: first }) })).toBe(line);
    expect(renderPlanAccount({ account: registeredAccountCell({ plan: second }) })).toBe(line);
    expect([first.alias, second.alias]).toStrictEqual(["codex-work", "codex-spare"]);
    expect([first.storeDir, second.storeDir]).toStrictEqual(["/x1", "/x2"]);
  });
});

describe("pausedPlanNotice", () => {
  it("returns nothing for a plan that is not paused", () => {
    expect(pausedPlanNotice({ plan: codexRow() })).toBe(undefined);
  });

  it("says a paused weekly Codex row is still read for its sign-in, never that it is not probed", () => {
    // `codex/fleetRead.ts` live-reads every weekly Codex row, paused or not, so the paused line must not claim
    // otherwise (`codex/fleetReadPaused.test.ts` pins the read itself).
    const notice = pausedPlanNotice({
      plan: codexRow({
        email: "owner@example.com",
        paused: { reason: "not signed in yet", sinceIso: "2026-09-21T00:00:00.000Z" },
      }),
    });
    expect(notice).toBe(
      "Codex · CACHED owner@example.com is PAUSED since 2026-09-21T00:00:00.000Z — not signed in yet. " +
        "It is not routed, though its sign-in and limits are still read so a needed login stays visible; " +
        "every fleet count still lists it as paused; " +
        "`slopweaver plans resume --provider codex --plan " +
        "codex-work` puts it back.",
    );
    expect(notice).not.toContain("not probed");
  });

  it("says a paused monthly-spend Codex row is read by nothing, since nothing measures monthly spend", () => {
    const notice = pausedPlanNotice({
      plan: codexRow({
        allowance: { kind: "monthly-spend" },
        paused: { reason: "over budget", sinceIso: "2026-09-21T00:00:00.000Z" },
      }),
    });
    expect(notice).toBe(
      "the Codex destination at /x1 (no account mapped) is PAUSED since 2026-09-21T00:00:00.000Z — over budget. " +
        "It is not routed and not live-read, because nothing here measures monthly spend; " +
        "every fleet count still lists it as paused; " +
        "`slopweaver plans resume --provider codex --plan codex-work` puts it back.",
    );
  });

  it("names the STORE DIRECTORY when the register maps no account, rather than a sentence about nothing", () => {
    // MEASURED over a real home: with five Claude rows registered, an unmapped one's notice opened
    // `Claude · UNMAPPED is PAUSED …` and identified none of them. The substitution is said out loud.
    const notice = pausedPlanNotice({
      plan: claudeRow({ paused: { reason: "the subscription lapsed", sinceIso: "2026-09-21T00:00:00.000Z" } }),
    });
    expect(notice).toBe(
      "the Claude destination at /c1 (no account mapped) is PAUSED since 2026-09-21T00:00:00.000Z — " +
        "the subscription lapsed. It is not probed and not routed, but every fleet count still lists it as " +
        "paused; `slopweaver plans resume " +
        "--provider claude --plan plan-one` puts it back.",
    );
  });
});

describe("renderPlanDiagnostic", () => {
  it("tags the line with the code a reader can search for", () => {
    expect(renderPlanDiagnostic({ diagnostic: { code: "UNKNOWN_CAPACITY", message: "nothing measured" } })).toBe(
      "note [UNKNOWN_CAPACITY]: nothing measured",
    );
  });
});
