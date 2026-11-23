/**
 * The refresh-token lapse policy: no recorded lapse says nothing, 48 hours or less warns, the instant itself and
 * after reads lapsed, and a value that is no instant says so rather than reading healthy.
 */
import { describe, expect, it } from "vitest";

import {
  landingLapseNotice,
  refreshLapseField,
  refreshTokenExpiresAtIso,
  refreshTokenLapse,
  statusLapseWarning,
} from "../../../../live/google/refreshLapse.js";

const VERB = "slopweaver gmail connect";
const LAPSE = "2026-11-24T10:00:00.000Z";
const LAPSE_MS = Date.parse(LAPSE);
const HOUR_MS = 60 * 60 * 1000;

describe("refreshTokenLapse", () => {
  it("says nothing for a grant with no recorded lapse", () => {
    expect(refreshTokenLapse({ expiresAtIso: undefined, nowMs: LAPSE_MS, reconnectVerb: VERB })).toStrictEqual({
      kind: "none",
    });
  });

  it("reads ok more than 48 hours out", () => {
    const nowMs = LAPSE_MS - 48 * HOUR_MS - 1;
    expect(refreshTokenLapse({ expiresAtIso: LAPSE, nowMs, reconnectVerb: VERB })).toStrictEqual({
      expiresAtIso: LAPSE,
      kind: "ok",
    });
  });

  it.each([
    ["exactly 48 hours out", LAPSE_MS - 48 * HOUR_MS],
    ["one millisecond out", LAPSE_MS - 1],
  ])("warns %s, naming the instant and the door's own connect verb", (_label, nowMs) => {
    expect(refreshTokenLapse({ expiresAtIso: LAPSE, nowMs, reconnectVerb: VERB })).toStrictEqual({
      expiresAtIso: LAPSE,
      kind: "soon",
      warning:
        "refresh token lapses at 2026-11-24T10:00:00.000Z — re-run `slopweaver gmail connect` before then to reconnect",
    });
  });

  it.each([
    ["at the instant", LAPSE_MS],
    ["after it", LAPSE_MS + HOUR_MS],
  ])("reads lapsed %s", (_label, nowMs) => {
    expect(refreshTokenLapse({ expiresAtIso: LAPSE, nowMs, reconnectVerb: VERB })).toStrictEqual({
      expiresAtIso: LAPSE,
      kind: "lapsed",
      warning: "refresh token lapsed at 2026-11-24T10:00:00.000Z — re-run `slopweaver gmail connect` to reconnect",
    });
  });

  it("names a recorded value that is no instant, rather than reading it as healthy", () => {
    expect(refreshTokenLapse({ expiresAtIso: "next week", nowMs: LAPSE_MS, reconnectVerb: VERB })).toStrictEqual({
      expiresAtIso: "next week",
      kind: "unreadable",
      warning:
        "refresh token lapse next week is no instant, so when it stops working is unknown — re-run `slopweaver gmail connect` to record it again",
    });
  });
});

describe("refreshTokenExpiresAtIso", () => {
  it("adds Google's lifetime in seconds to the consent instant", () => {
    const grantedAtMs = Date.parse("2026-11-17T10:00:00.000Z");
    expect(refreshTokenExpiresAtIso({ grantedAtMs, lifetimeSeconds: 604800 })).toBe("2026-11-24T10:00:00.000Z");
  });

  it("answers nothing for an instant no Date can hold, which a safe-integer lifetime can still reach", () => {
    expect(refreshTokenExpiresAtIso({ grantedAtMs: 0, lifetimeSeconds: 9e12 })).toBeUndefined();
  });
});

describe("refreshLapseField", () => {
  const grantedAtMs = Date.parse("2026-11-17T10:00:00.000Z");

  it("is empty when Google named no lifetime, as for a Production client", () => {
    expect(refreshLapseField({ grantedAtMs, lifetimeSeconds: undefined })).toStrictEqual({});
  });

  it("carries the lapse instant when Google named one", () => {
    expect(refreshLapseField({ grantedAtMs, lifetimeSeconds: 604800 })).toStrictEqual({
      refreshTokenExpiresAtIso: LAPSE,
    });
  });

  it("is undefined, never an empty field, when no instant can hold the lapse", () => {
    expect(refreshLapseField({ grantedAtMs, lifetimeSeconds: 9e12 })).toBeUndefined();
  });
});

describe("statusLapseWarning", () => {
  it("never reads the clock for a grant with no recorded lapse", () => {
    const reads: string[] = [];
    const readNowIso = (): string => {
      reads.push("now");
      return LAPSE;
    };
    expect(statusLapseWarning({ expiresAtIso: undefined, readNowIso, reconnectVerb: VERB })).toBeUndefined();
    expect(reads).toStrictEqual([]);
  });

  it("says nothing more than 48 hours out", () => {
    expect(
      statusLapseWarning({ expiresAtIso: LAPSE, readNowIso: () => "2026-11-17T10:00:00.000Z", reconnectVerb: VERB }),
    ).toBeUndefined();
  });

  it("warns once lapsed, naming the door's connect verb", () => {
    expect(statusLapseWarning({ expiresAtIso: LAPSE, readNowIso: () => LAPSE, reconnectVerb: VERB })).toBe(
      "refresh token lapsed at 2026-11-24T10:00:00.000Z — re-run `slopweaver gmail connect` to reconnect",
    );
  });

  it("says the lapse is unknown when the clock reads no instant", () => {
    expect(statusLapseWarning({ expiresAtIso: LAPSE, readNowIso: () => "tuesday", reconnectVerb: VERB })).toBe(
      "the clock read tuesday, which is no instant, so whether the refresh token has lapsed is unknown",
    );
  });
});

describe("landingLapseNotice", () => {
  it("names the instant, why Google set it, and both ways out", () => {
    expect(landingLapseNotice({ expiresAtIso: LAPSE, reconnectVerb: VERB })).toBe(
      "Google set this refresh token to lapse at 2026-11-24T10:00:00.000Z, which it does for an OAuth client whose " +
        "consent screen is in Testing — re-run `slopweaver gmail connect` before then, or publish the client to Production",
    );
  });
});
