/*
 * What the default slot itself holds: `classifyActiveSlot` reading a live, expired or absent credential as a
 * positive finding, and a watch tick releasing its blanket hold when that slot holds nothing usable.
 */
import { describe, expect, it } from "vitest";

import { EMPTY_ROTATION_STATE, selectAccount } from "../../../../claude/rotationState.js";
import { classifyActiveSlot, planWatchTick } from "../defaultThresholds.js";
import { ACCOUNTS, ALL_TOUCHED_LONG_AGO, HEALTHY, NOW, RECENT_SWAP } from "./harness.js";

describe("classifyActiveSlot — a slot holding nothing is a POSITIVE finding, never a guess", () => {
  // Asserted whole rather than field by field: `ActiveSlot` is a union that carries the instant on exactly
  // one arm, so `toStrictEqual` pins the ABSENCE of one on the other two as hard as it pins its presence.
  it("reads an access token whose expiry has passed as expired, and carries the instant", () => {
    expect(
      classifyActiveSlot({
        nowIso: NOW,
        slice: { credential: { accessToken: "sk-x", expiresAt: Date.parse("2026-09-05T11:00:00.000Z") } },
      }),
    ).toStrictEqual({ expiryIso: "2026-09-05T11:00:00.000Z", holding: "expired" });
  });

  it("reads an expiry still ahead of the tick as live, and carries no instant", () => {
    expect(
      classifyActiveSlot({
        nowIso: NOW,
        slice: { credential: { accessToken: "sk-x", expiresAt: Date.parse("2026-09-05T13:00:00.000Z") } },
      }),
    ).toStrictEqual({ holding: "live" });
  });

  it("reads an absent slice as absent", () => {
    expect(classifyActiveSlot({ nowIso: NOW, slice: undefined })).toStrictEqual({ holding: "absent" });
  });

  it("reads the empty access token — a superseded refresh grant's shape — as absent", () => {
    expect(
      classifyActiveSlot({
        nowIso: NOW,
        slice: { credential: { accessToken: "", expiresAt: Date.parse("2026-09-05T13:00:00.000Z") } },
      }),
    ).toStrictEqual({ holding: "absent" });
  });

  it("reads an UNPARSEABLE expiry as live, because nothing has been established", () => {
    expect(classifyActiveSlot({ nowIso: NOW, slice: { credential: { accessToken: "sk-x" } } })).toStrictEqual({
      holding: "live",
    });
  });
});

describe("planWatchTick — a slot holding NOTHING is not a slot nobody could name", () => {
  // MEASURED on this machine: the default slot's credential had long expired
  // while all four configured stores held live ones. No organisation comes back for a
  // dead token and no store byte-matched it, so every unpinned tick concluded `unknown` — which holds EVERY
  // store back — and the loop whose one job is keeping four stores alive refreshed none for seven days.
  const EXPIRED_AT = "2026-09-05T11:00:00.000Z";

  it("refreshes every store when the active slot's credential has expired", () => {
    const plan = planWatchTick({
      accounts: ACCOUNTS,
      activeSlot: { expiryIso: EXPIRED_AT, holding: "expired" },
      identities: [],
      gauges: HEALTHY,
      nowIso: NOW,
      seat: "worker",
      sharesActiveCredential: [],
      state: EMPTY_ROTATION_STATE,
      touches: ALL_TOUCHED_LONG_AGO,
    });
    expect(plan.activeFrom).toBe("none");
    expect(plan.active).toBeUndefined();
    expect(plan.touch).toStrictEqual(["plan-one", "plan-two", "plan-three"]);
    expect(plan.touchSkipped).toStrictEqual([]);
  });

  it("names the instant the slot went dead, rather than only that nothing could be identified", () => {
    const plan = planWatchTick({
      accounts: ACCOUNTS,
      activeSlot: { expiryIso: EXPIRED_AT, holding: "expired" },
      identities: [],
      gauges: HEALTHY,
      nowIso: NOW,
      seat: "worker",
      sharesActiveCredential: [],
      state: EMPTY_ROTATION_STATE,
      touches: ALL_TOUCHED_LONG_AGO,
    });
    expect(plan.why).toBe(
      `the active slot's credential expired ${EXPIRED_AT}, so no session is authenticating with it and ` +
        `there is no active plan to hold or move — keep-alive is not held back on that account`,
    );
  });

  it("says it plainly with no instant when the slot holds no credential at all", () => {
    const plan = planWatchTick({
      accounts: ACCOUNTS,
      activeSlot: { holding: "absent" },
      identities: [],
      gauges: HEALTHY,
      nowIso: NOW,
      seat: "worker",
      sharesActiveCredential: [],
      state: EMPTY_ROTATION_STATE,
      touches: ALL_TOUCHED_LONG_AGO,
    });
    expect(plan.activeFrom).toBe("none");
    expect(plan.why).toBe(
      "the active slot holds no usable credential, so no session is authenticating with it and there is " +
        "no active plan to hold or move — keep-alive is not held back on that account",
    );
  });

  // The stronger half of this — a `live` slot carrying an expiry instant — is no longer a case at all:
  // review pass r2 made `ActiveSlot` a union, so `{ holding: "live", expiryIso: X }` does not compile. What
  // remains checkable is that a live slot reaches the OLD sentence untouched, which is the regression the
  // whole change must not cause.
  it("leaves a LIVE slot on the unknown sentence, naming no instant", () => {
    const plan = planWatchTick({
      accounts: ACCOUNTS,
      activeSlot: { holding: "live" },
      identities: [],
      gauges: HEALTHY,
      nowIso: NOW,
      seat: "worker",
      sharesActiveCredential: [],
      state: EMPTY_ROTATION_STATE,
      touches: ALL_TOUCHED_LONG_AGO,
    });
    expect(plan.activeFrom).toBe("unknown");
    expect(plan.why).toBe("no plan could be identified as active, so there is nothing to hold or move");
  });

  // Review pass r1 (`dead-slot-release-cannot-revoke-a-live-token`) falsified releasing this one too: an
  // `expired` reading is of the ACCESS token, and the REFRESH grant beside it runs 27-29 days, so a store
  // byte-matching a dead slot can still hold a grant that slot could have used — and a touch would revoke
  // it, leaving a browser sign-in as the only repair. A dead slot releases the BLANKET hold and nothing else.
  it("still refuses a store holding the active slot's own bytes, dead slot or not", () => {
    const plan = planWatchTick({
      accounts: ACCOUNTS,
      activeSlot: { expiryIso: EXPIRED_AT, holding: "expired" },
      identities: [],
      gauges: HEALTHY,
      nowIso: NOW,
      seat: "worker",
      sharesActiveCredential: ["plan-three"],
      state: EMPTY_ROTATION_STATE,
      touches: ALL_TOUCHED_LONG_AGO,
    });
    expect(plan.activeFrom).toBe("none");
    expect(plan.touch).toStrictEqual(["plan-one", "plan-two"]);
    expect(plan.touchSkipped).toStrictEqual([
      "plan-three holds the same credential as the active slot, so refreshing it would revoke the token " +
        "every running session is authenticating with",
    ]);
  });

  it("outranks a record written inside one token lifetime, which cannot describe a dead slot", () => {
    const plan = planWatchTick({
      accounts: ACCOUNTS,
      activeSlot: { holding: "absent" },
      identities: [],
      gauges: HEALTHY,
      nowIso: NOW,
      seat: "worker",
      sharesActiveCredential: [],
      state: selectAccount({
        alias: "plan-two",
        nowIso: RECENT_SWAP,
        reason: "under test",
        state: EMPTY_ROTATION_STATE,
      }),
      touches: ALL_TOUCHED_LONG_AGO,
    });
    expect(plan.activeFrom).toBe("none");
    expect(plan.touch).toStrictEqual(["plan-one", "plan-two", "plan-three"]);
  });

  it("leaves a PINNED process alone — its own store is live whatever the default slot holds", () => {
    const plan = planWatchTick({
      accounts: ACCOUNTS,
      activeSlot: { expiryIso: EXPIRED_AT, holding: "expired" },
      identities: [],
      gauges: HEALTHY,
      nowIso: NOW,
      pinnedActive: "plan-three",
      seat: "worker",
      sharesActiveCredential: [],
      state: EMPTY_ROTATION_STATE,
      touches: ALL_TOUCHED_LONG_AGO,
    });
    expect(plan.activeFrom).toBe("pinned");
    expect(plan.touch).toStrictEqual(["plan-one", "plan-two"]);
  });

  it("still holds EVERY store back when the slot is live and no source could name the plan", () => {
    const plan = planWatchTick({
      accounts: ACCOUNTS,
      activeSlot: { holding: "live" },
      identities: [],
      gauges: HEALTHY,
      nowIso: NOW,
      seat: "worker",
      sharesActiveCredential: [],
      state: EMPTY_ROTATION_STATE,
      touches: ALL_TOUCHED_LONG_AGO,
    });
    expect(plan.activeFrom).toBe("unknown");
    expect(plan.touch).toStrictEqual([]);
    expect(plan.touchSkipped.length).toBe(3);
  });
});
