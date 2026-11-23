import { describe, expect, it } from "vitest";

import type { ClaudeAccount } from "../../../claude/contracts.js";
import { EMPTY_ROTATION_STATE, selectAccount } from "../../../claude/rotationState.js";
import { parseClaudeGauge } from "../../../claude/usage.js";
import { recoveryEta, renderWatchLines, storeLifeLines, watchTickDocument } from "../../../claude/watchReport.js";
import { planWatchTick } from "../../../claude/watchTick.js";
import { unwrap } from "../../../lib/result.js";
import { DEFAULT_THRESHOLDS } from "../../../plans/thresholds.js";

/** A tick under the default thresholds. */
const planTick = (
  args: Omit<Parameters<typeof planWatchTick>[0], "spends" | "thresholds">,
): ReturnType<typeof planWatchTick> => planWatchTick({ ...args, spends: [], thresholds: DEFAULT_THRESHOLDS.claude });

const FIVE_MINUTES_MS = 300_000;
const NOW = "2026-09-05T12:00:00.000Z";
const STALE = "2026-09-04T12:00:00.000Z";

/**
 * A swap recorded three hours before the tick. The RECORDED answer to "which plan is active" expires with
 * the credential it describes (`watchTick.ts`), so a fixture using `STALE` here would resolve to `unknown`
 * and this file would be reporting a tick that named no active plan at all.
 */
const RECENT_SWAP = "2026-09-05T09:00:00.000Z";

const ACCOUNTS: readonly ClaudeAccount[] = [
  { alias: "plan-one", storeDir: "/stores/one" },
  { alias: "plan-two", storeDir: "/stores/two" },
];

function gauge({ alias, fiveHour }: { alias: string; fiveHour: string }) {
  return unwrap(
    parseClaudeGauge({
      alias,
      headers: {
        "anthropic-ratelimit-unified-5h-reset": "1788459000",
        "anthropic-ratelimit-unified-5h-status": "allowed",
        "anthropic-ratelimit-unified-5h-utilization": fiveHour,
        "anthropic-ratelimit-unified-7d-reset": "1789041600",
        "anthropic-ratelimit-unified-7d-status": "allowed",
        "anthropic-ratelimit-unified-7d-utilization": "0.10",
      },
      observedAtIso: NOW,
    }),
  );
}

describe("recoveryEta", () => {
  it("reports the tick interval as the worst case for noticing a wall", () => {
    const eta = recoveryEta({ intervalMs: FIVE_MINUTES_MS });
    expect(eta.detectionMs).toBe(FIVE_MINUTES_MS);
    expect(eta.detection).toBe("worst-case");
  });

  it("reports a MEASURED detection when both instants are known", () => {
    const eta = recoveryEta({
      intervalMs: FIVE_MINUTES_MS,
      noticedAtIso: "2026-09-05T12:00:41.000Z",
      signalAtIso: "2026-09-05T12:00:08.000Z",
    });
    expect(eta.detectionMs).toBe(33_000);
    expect(eta.detection).toBe("measured");
  });

  it("names the swap and the pickup as unmeasured rather than folding either into zero", () => {
    const eta = recoveryEta({ intervalMs: FIVE_MINUTES_MS });
    expect(eta.unmeasured).toStrictEqual([
      "the swap, because the credential copy is retired and nothing performs one",
      "pickup, because how fast a running session re-reads the credential is not observable here",
    ]);
  });

  it("names BOTH legs unmeasured unconditionally, with no input that could supply either", () => {
    // Two review rounds took two fields out of this accounting. `swapMs` measured the credential copy, which is
    // retired; `pickupMs` never had a producer at all, and its optional parameter was an invitation to supply a
    // number nothing can measure. Both legs are constants in `unmeasured` now rather than conditionals, and the
    // shape assertion is on the KEYS, because a missing property and a declared-but-absent one read identically
    // through a property access.
    const eta = recoveryEta({ intervalMs: FIVE_MINUTES_MS });
    expect(Object.keys(eta).toSorted()).toStrictEqual(["detection", "detectionMs", "unmeasured"]);
    expect(eta.detectionMs).toBe(FIVE_MINUTES_MS);
    expect(eta.detection).toBe("worst-case");
  });
});

describe("the tick report", () => {
  const plan = planTick({
    accounts: ACCOUNTS,
    gauges: [gauge({ alias: "plan-one", fiveHour: "0.96" }), gauge({ alias: "plan-two", fiveHour: "0.10" })],
    identities: [],
    nowIso: NOW,
    seat: "worker",
    sharesActiveCredential: [],
    state: selectAccount({ alias: "plan-one", nowIso: RECENT_SWAP, reason: "under test", state: EMPTY_ROTATION_STATE }),
    touches: [{ alias: "plan-two", lastTouchedIso: STALE }],
  });
  const eta = recoveryEta({ intervalMs: FIVE_MINUTES_MS });
  const LIVES = [
    { alias: "plan-one", expiresAtIso: "2026-09-05T15:36:00.000Z", hasCredential: true },
    { alias: "plan-two", expiresAtIso: "2026-09-05T09:00:00.000Z", hasCredential: true },
  ];

  it("reports writing NOTHING to the active credential on a live tick that recommends a plan", () => {
    // This asserted `"plan-two"` — the plan a live tick had moved onto — and it was right while a tick performed
    // a swap. The credential copy is retired, so a tick writes the active slot on no path at all, and the field
    // naming a plan was the document saying it had done the one thing it must never misreport. Codex review pass
    // on that change built exactly this tick. `rotateTo` beside it still carries what was RECOMMENDED.
    const document = watchTickDocument({ dryRun: false, eta, lives: LIVES, nowIso: NOW, plan });
    expect(document["wroteToActiveCredential"]).toBe("nothing");
    expect(document["rotateTo"]).toBe("plan-two");
    expect(document["act"]).toBe("rotate");
    expect(document["touched"]).toStrictEqual(["plan-two"]);
    expect(document["wouldTouch"]).toStrictEqual(["plan-two"]);
    expect(document["stores"]).toStrictEqual(LIVES);
  });

  it("records a DRY RUN as having touched nothing, while still reporting what was due", () => {
    const document = watchTickDocument({ dryRun: true, eta, lives: LIVES, nowIso: NOW, plan });
    expect(document["touched"]).toStrictEqual([]);
    expect(document["wouldTouch"]).toStrictEqual(["plan-two"]);
    expect(document["wroteToActiveCredential"]).toBe("nothing");
  });

  it("leads with the sentence, then the active plan, the touches, the lives, then the recovery accounting", () => {
    expect(renderWatchLines({ dryRun: false, eta, lives: LIVES, nowIso: NOW, plan })).toStrictEqual([
      "2026-09-05T12:00:00.000Z  RECOMMENDING plan-two as the plan to boot against — five_hour reached the " +
        "rotation threshold before a wall",
      "  active: plan-one (recorded)",
      "  touched: plan-two",
      "  not touched: plan-one is the active plan (recorded), so it refreshes itself under ordinary use",
      "  plan-one: 3.60h left, expires 2026-09-05T15:36:00.000Z",
      "  plan-two: EXPIRED at 2026-09-05T09:00:00.000Z — the next touch is what repairs it",
      "  eta-to-recover: detection 300000ms (worst-case)",
      "    not measured: the swap, because the credential copy is retired and nothing performs one",
      "    not measured: pickup, because how fast a running session re-reads the credential is not " +
        "observable here",
    ]);
  });

  it("says WOULD touch under a dry run, so a report is never mistaken for work done", () => {
    expect(renderWatchLines({ dryRun: true, eta, lives: LIVES, nowIso: NOW, plan })).toContain(
      "  would touch: plan-two",
    );
  });
});

describe("storeLifeLines — the witness that says whether keep-alive worked", () => {
  it("reports remaining hours rather than claiming a refresh happened", () => {
    expect(
      storeLifeLines({
        lives: [{ alias: "plan-two", expiresAtIso: "2026-09-05T15:36:00.000Z", hasCredential: true }],
        nowIso: NOW,
      }),
    ).toStrictEqual(["  plan-two: 3.60h left, expires 2026-09-05T15:36:00.000Z"]);
  });

  it("calls an expired store EXPIRED rather than reporting a negative number", () => {
    expect(
      storeLifeLines({
        lives: [{ alias: "plan-two", expiresAtIso: "2026-09-05T11:00:00.000Z", hasCredential: true }],
        nowIso: NOW,
      }),
    ).toStrictEqual(["  plan-two: EXPIRED at 2026-09-05T11:00:00.000Z — the next touch is what repairs it"]);
  });

  it("says so plainly when a store carries no expiry this build can read", () => {
    expect(storeLifeLines({ lives: [{ alias: "plan-three", hasCredential: true }], nowIso: NOW })).toStrictEqual([
      "  plan-three: no expiry this build can read",
    ]);
  });

  it("treats an expiry exactly at now as expired, since a credential at its instant is already unusable", () => {
    expect(
      storeLifeLines({ lives: [{ alias: "plan-one", expiresAtIso: NOW, hasCredential: true }], nowIso: NOW }),
    ).toStrictEqual([`  plan-one: EXPIRED at ${NOW} — the next touch is what repairs it`]);
  });
});

describe("a signed-out store is not an expired one", () => {
  it("sends the reader to a browser sign-in rather than promising the next touch will repair it", () => {
    expect(
      storeLifeLines({
        lives: [{ alias: "plan-one", expiresAtIso: "1970-01-01T00:00:00.000Z", hasCredential: false }],
        nowIso: NOW,
      }),
    ).toStrictEqual([
      "  plan-one (UNMAPPED — add its email to accounts.json): SIGNED OUT — no touch repairs this, it needs one browser sign-in",
    ]);
  });

  it("names the account to sign in when accounts.json maps one", () => {
    expect(
      storeLifeLines({
        lives: [{ alias: "plan-two", email: "security@example.invalid", hasCredential: false }],
        nowIso: NOW,
      }),
    ).toStrictEqual([
      "  plan-two (CACHED security@example.invalid): SIGNED OUT — no touch repairs this, it needs one browser sign-in",
    ]);
  });

  it("says the same for a store with no readable expiry and no credential either", () => {
    expect(storeLifeLines({ lives: [{ alias: "plan-one", hasCredential: false }], nowIso: NOW })).toStrictEqual([
      "  plan-one (UNMAPPED — add its email to accounts.json): SIGNED OUT — no touch repairs this, it needs one browser sign-in",
    ]);
  });

  it("still promises repair for a store that merely expired, because a touch really does repair one", () => {
    expect(
      storeLifeLines({
        lives: [{ alias: "plan-two", expiresAtIso: "2026-09-05T09:00:00.000Z", hasCredential: true }],
        nowIso: NOW,
      }),
    ).toStrictEqual(["  plan-two: EXPIRED at 2026-09-05T09:00:00.000Z — the next touch is what repairs it"]);
  });
});
