/**
 * `planAccountSync` — the pure pairing of Codex rows with their stores' live answers. The verb's own lane
 * (`./run.test.ts`) covers the writes; this file pins the shapes that write nothing.
 */
import { describe, expect, it } from "vitest";

import { planAccountSync } from "../../../../../cli/commands/plans/syncAccounts.js";
import type { RegisteredPlan } from "../../../../../plans/types.js";

const NOW = "2026-09-25T00:00:00.000Z";

/** One Codex row, overriding only what a case is about. */
const row = (over: Partial<RegisteredPlan> = {}): RegisteredPlan => ({
  alias: "codex-a",
  allowance: { kind: "weekly-window" },
  provider: "codex",
  storeDir: "/s/a",
  usageLimitPercent: 100,
  ...over,
});

/** A signed-in answer from one store, carrying only what the pairing reads. */
const signedIn = ({ codexHome, email }: { codexHome: string; email: string }) =>
  ({
    accountId: undefined,
    codexHome,
    email,
    gauges: [],
    kind: "signed-in",
    ordinaryUsageAllowed: undefined,
    planType: undefined,
    readAtIso: NOW,
    resetCreditsAvailable: 0,
  }) as const;

describe("planAccountSync", () => {
  it("pairs each row with its OWN store's answer, whatever order the answers arrive in", () => {
    const rows = planAccountSync({
      lives: [
        signedIn({ codexHome: "/s/b", email: "b@example.com" }),
        signedIn({ codexHome: "/s/a", email: "a@example.com" }),
      ],
      plans: [row(), row({ alias: "codex-b", storeDir: "/s/b" })],
    });

    expect(rows.map((outcome) => [outcome.alias, outcome.liveEmail])).toStrictEqual([
      ["codex-a", "a@example.com"],
      ["codex-b", "b@example.com"],
    ]);
  });

  it("writes nothing for a row whose store got no answer at all", () => {
    const rows = planAccountSync({
      lives: [signedIn({ codexHome: "/s/other", email: "other@example.com" })],
      plans: [row()],
    });

    expect(rows.map((outcome) => [outcome.update, outcome.state, outcome.line])).toStrictEqual([
      [false, "unreadable", "codex-a: live read unavailable — the live read returned no answer for this store"],
    ]);
  });

  it("leaves a row alone when the store is signed in but reported no address", () => {
    const rows = planAccountSync({
      lives: [
        {
          accountId: undefined,
          codexHome: "/s/a",
          email: undefined,
          gauges: [],
          kind: "signed-in",
          ordinaryUsageAllowed: undefined,
          planType: undefined,
          readAtIso: NOW,
          resetCreditsAvailable: 0,
        },
      ],
      plans: [row({ email: "kept@example.com" })],
    });

    expect(rows).toStrictEqual([
      {
        alias: "codex-a",
        line: "codex-a: signed in, but the provider reported no address — the row is left as it was",
        liveEmail: null,
        recordedEmail: "kept@example.com",
        state: "signed-in",
        storeDir: "/s/a",
        update: false,
      },
    ]);
  });

  it("names the login for a store whose directory is missing, and changes nothing", () => {
    const rows = planAccountSync({
      lives: [{ codexHome: "/s/gone", kind: "store-missing", readAtIso: NOW }],
      plans: [row({ alias: "codex-gone", storeDir: "/s/gone" })],
    });

    expect(rows.map((outcome) => [outcome.update, outcome.line])).toStrictEqual([
      [false, "codex-gone: store directory missing — run mkdir -p /s/gone && CODEX_HOME=/s/gone codex login"],
    ]);
  });

  it("returns nothing for a register with no Codex rows", () => {
    expect(planAccountSync({ lives: [], plans: [] })).toStrictEqual([]);
  });
});
