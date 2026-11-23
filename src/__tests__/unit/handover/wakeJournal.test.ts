/**
 * The wake journal's pure half: decoding a row, pairing attempts with settlements, the re-park guard's match, and
 * which attempt a `--retry` may name. Every row is built inline; nothing here touches a file.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";

import type { WakeObservation } from "../../../handover/parkWake.js";
import {
  decodeWakeJournalRow,
  deferredAttemptForRetry,
  foldWakeJournal,
  parkKey,
  reparkedOnActedCondition,
  type WakeAttemptRow,
  WakeRetryErrors,
  type WakeSettledRow,
} from "../../../handover/wakeJournal.js";

const GREEN: WakeObservation = {
  fingerprint: "f".repeat(64),
  headSha: "abc",
  kind: "checks",
  number: 10,
  prState: "OPEN",
  repo: "acme/widgets",
};

/** An attempt on one park of `row`. */
function attempt({
  nonce,
  parkIndex = 2,
  parkedAtIso = "2026-10-15T02:00:00.000Z",
  observed = GREEN,
  slug = "row",
}: {
  nonce: string;
  parkIndex?: number;
  parkedAtIso?: string;
  observed?: WakeObservation;
  slug?: string;
}): WakeAttemptRow {
  return { atIso: "2026-10-15T03:13:00.000Z", kind: "attempt", nonce, observed, parkIndex, parkedAtIso, slug };
}

/** A settlement of one attempt. */
function settled({
  nonce,
  action,
  retryAfterIso,
}: {
  nonce: string;
  action: WakeSettledRow["action"];
  retryAfterIso?: string;
}): WakeSettledRow {
  const row = { action, atIso: "2026-10-15T03:14:00.000Z", kind: "settled", nonce } as const;
  return retryAfterIso === undefined ? row : { ...row, retryAfterIso };
}

describe("decodeWakeJournalRow", () => {
  it("reads back an attempt and a deferred settlement exactly", () => {
    const rows = [
      attempt({ nonce: "n-1" }),
      settled({ action: "spawn-deferred", nonce: "n-1", retryAfterIso: "2026-10-15T03:18:00.000Z" }),
    ];
    expect(rows.map((value) => unwrap(decodeWakeJournalRow({ value: JSON.parse(JSON.stringify(value)) })))).toEqual(
      rows,
    );
  });

  it("refuses an unknown field, a non-UTC instant and a malformed repo", () => {
    const bad = [
      { ...attempt({ nonce: "n-1" }), extra: true },
      { ...attempt({ nonce: "n-1" }), atIso: "2026-10-15 03:13" },
      attempt({ nonce: "n-1", observed: { ...GREEN, repo: "no-slash" } }),
    ];
    expect(bad.map((value) => decodeWakeJournalRow({ value }).isErr())).toEqual([true, true, true]);
    expect(unwrapErr(decodeWakeJournalRow({ value: bad[1] })).join("; ")).toContain("not a UTC instant");
  });
});

describe("foldWakeJournal", () => {
  it("pairs each attempt with its first settlement, and leaves an unsettled one bare", () => {
    const folded = foldWakeJournal({
      rows: [
        attempt({ nonce: "n-1" }),
        settled({ action: "spawned", nonce: "n-1" }),
        settled({ action: "spawn-failed", nonce: "n-1" }),
        attempt({ nonce: "n-2" }),
      ],
    });
    expect(folded.map((state) => [state.attempt.nonce, state.settlement?.action])).toEqual([
      ["n-1", "spawned"],
      ["n-2", undefined],
    ]);
  });

  // an orphan settlement written before its attempt is not that attempt's outcome.
  it("never pairs an attempt with a settlement written before it", () => {
    const folded = foldWakeJournal({
      rows: [
        settled({ action: "spawn-deferred", nonce: "x", retryAfterIso: "2026-10-15T03:01:00.000Z" }),
        attempt({ nonce: "x" }),
        settled({ action: "spawn-failed", nonce: "x" }),
        settled({ action: "spawn-deferred", nonce: "y" }),
        attempt({ nonce: "y" }),
      ],
    });
    expect(folded.map((state) => [state.attempt.nonce, state.settlement?.action])).toEqual([
      ["x", "spawn-failed"],
      ["y", undefined],
    ]);
  });
});

describe("reparkedOnActedCondition", () => {
  const acted = parkKey({ parkIndex: 2, parkedAtIso: "2026-10-15T02:00:00.000Z" });
  const attempts = foldWakeJournal({ rows: [attempt({ nonce: "n-1" })] });

  it("matches the park the seat came up from when it observed the very condition the re-park waits on", () => {
    expect(reparkedOnActedCondition({ actedPark: acted, attempts, observed: GREEN, slug: "row" })).toEqual(
      attempt({ nonce: "n-1" }),
    );
  });

  it("never matches a new head, another row, no reseated park, or a reseated park no wake attempted", () => {
    const misses = [
      reparkedOnActedCondition({ actedPark: acted, attempts, observed: { ...GREEN, headSha: "def" }, slug: "row" }),
      reparkedOnActedCondition({ actedPark: acted, attempts, observed: GREEN, slug: "other" }),
      reparkedOnActedCondition({ actedPark: undefined, attempts, observed: GREEN, slug: "row" }),
      reparkedOnActedCondition({
        actedPark: parkKey({ parkIndex: 5, parkedAtIso: "2026-10-15T03:15:00.000Z" }),
        attempts,
        observed: GREEN,
        slug: "row",
      }),
    ];
    expect(misses).toEqual([undefined, undefined, undefined, undefined]);
  });

  it("judges the latest attempt on that park, so an earlier deferral's observation does not stand for it", () => {
    const both = foldWakeJournal({
      rows: [attempt({ nonce: "n-1" }), attempt({ nonce: "n-2", observed: { ...GREEN, headSha: "def" } })],
    });
    expect(reparkedOnActedCondition({ actedPark: acted, attempts: both, observed: GREEN, slug: "row" })).toBe(
      undefined,
    );
  });
});

describe("deferredAttemptForRetry", () => {
  const attempts = foldWakeJournal({
    rows: [
      attempt({ nonce: "n-1" }),
      settled({ action: "spawn-deferred", nonce: "n-1", retryAfterIso: "2026-10-15T03:18:00.000Z" }),
      attempt({ nonce: "n-2" }),
      settled({ action: "spawn-deferred", nonce: "n-2" }),
      attempt({ nonce: "n-3" }),
    ],
  });

  it("answers a deferred attempt and the instant its backoff opens", () => {
    expect(unwrap(deferredAttemptForRetry({ attempts, nonce: "n-1" }))).toEqual({
      attempt: attempt({ nonce: "n-1" }),
      retryAfterIso: "2026-10-15T03:18:00.000Z",
    });
  });

  it("refuses an unknown nonce, a deferral with no instant, and an unsettled attempt", () => {
    const refused = ["n-9", "n-2", "n-3"].map((nonce) => unwrapErr(deferredAttemptForRetry({ attempts, nonce })));
    expect(refused).toEqual([
      WakeRetryErrors.nonceUnknown({ nonce: "n-9" }),
      WakeRetryErrors.noInstant({ attempt: attempt({ nonce: "n-2" }) }),
      WakeRetryErrors.unsettled({ attempt: attempt({ nonce: "n-3" }) }),
    ]);
    expect(refused.map((error) => error.code)).toEqual(["RETRY_NONCE_UNKNOWN", "RETRY_NO_INSTANT", "RETRY_UNSETTLED"]);
    expect(refused.map((error) => error.message)).toEqual([
      "no wake attempt carries the nonce n-9",
      "wake attempt n-2 (row) was deferred with no retry instant read, so the next tick takes it",
      "wake attempt n-3 (row) has no settlement, so its spawn is still running or its outcome was never journalled; the next tick judges the park",
    ]);
  });

  // a nonce two attempts carry names no one park, so the retry refuses rather than picking the first.
  it("refuses a nonce two attempts carry, naming neither park", () => {
    const duplicated = foldWakeJournal({
      rows: [
        attempt({ nonce: "dup", slug: "a" }),
        settled({ action: "spawn-deferred", nonce: "dup", retryAfterIso: "2026-10-15T03:18:00.000Z" }),
        attempt({ nonce: "dup", slug: "b" }),
        settled({ action: "spawn-deferred", nonce: "dup", retryAfterIso: "2026-10-15T03:18:00.000Z" }),
      ],
    });
    const refused = unwrapErr(deferredAttemptForRetry({ attempts: duplicated, nonce: "dup" }));
    expect(refused).toEqual(WakeRetryErrors.nonceAmbiguous({ count: 2, nonce: "dup" }));
    expect([refused.code, refused.message]).toEqual([
      "RETRY_NONCE_AMBIGUOUS",
      "2 wake attempts carry the nonce dup, so which park it names is unknown — repair the wake journal",
    ]);
  });
});
