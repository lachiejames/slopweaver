/*
 * What the sync route's answer means to the page. A backoff refusal — another tab already took that reading — is no
 * run at all, so it must never read as a failed refresh.
 */
import { describe, expect, it } from "vitest";

import { syncOutcomeOf } from "../../components/live/takeReading";

const AT = "2026-11-10T02:00:00.000Z";

describe("syncOutcomeOf", () => {
  it("reads a taken run as taken", () => {
    expect(
      syncOutcomeOf({ atIso: AT, body: { ok: true, startedAtIso: AT, tookMs: 4200 }, slug: "landing", status: 200 }),
    ).toStrictEqual({ atIso: AT, phase: "taken", tookMs: 4200 });
  });

  it("reads a backoff refusal as refused, never failed, since nothing ran", () => {
    const body = {
      notMeasured: "an automatic reading over R already ran",
      ok: false,
      refused: true,
      startedAtIso: AT,
      tookMs: 0,
    };
    expect(syncOutcomeOf({ atIso: AT, body, slug: "landing", status: 200 })).toStrictEqual({
      atIso: AT,
      phase: "refused",
      why: "an automatic reading over R already ran",
    });
  });

  it("reads a run that failed as failed, with its reason", () => {
    const body = { notMeasured: "github landing exited 1", ok: false, startedAtIso: AT, tookMs: 300 };
    expect(syncOutcomeOf({ atIso: AT, body, slug: "landing", status: 200 })).toStrictEqual({
      atIso: AT,
      phase: "failed",
      why: "github landing exited 1",
    });
  });

  it("names the route and its status when the answer carries no reason", () => {
    expect(syncOutcomeOf({ atIso: AT, body: {}, slug: "landing", status: 500 })).toStrictEqual({
      atIso: AT,
      phase: "failed",
      why: "/api/sync/landing answered 500 with no reason",
    });
  });
});
