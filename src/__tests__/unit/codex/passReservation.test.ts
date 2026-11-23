/**
 * Which destination one Codex pass may spend once every other running pass on the same account is counted —
 * `codex/passReservation.ts`, pure, over hand-built observations.
 *
 * A limit the user sets is respected even if it means taking the fleet down, and the fleet maximises to the
 * user's cap, never over it. So the arithmetic is held at its edge in
 * both directions — reaching the limit exactly is admitted, one point past it is not — and every case that holds an
 * account out names the sentence that says why.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import type { CodexPlanObservation } from "../../../codex/fleetTypes.js";
import {
  type CodexPassReservation,
  type CodexPassReservationStore,
  decideCodexPassReservation,
} from "../../../codex/passReservation.js";
import { DEFAULT_THRESHOLDS } from "../../../plans/thresholds.js";
import { accountRow, BOUND, EXPIRES, heldRow } from "./passReservationFixtures.js";
import { NOW } from "./rankFixtures.js";

/** The digest the account join keeps for a provider account id. */
const ACCT_ONE = createHash("sha256").update("account:acct-one", "utf8").digest("hex");
const ACCT_TWO = createHash("sha256").update("account:acct-two", "utf8").digest("hex");
/** The digest a reservation also carries for the store directory it was taken on. */
const STORE_ONE = createHash("sha256").update("store:/homes/plan-one", "utf8").digest("hex");

/** A healthy store holding `rows`. */
function healthy({ rows = [] }: { rows?: readonly CodexPassReservation[] } = {}): CodexPassReservationStore {
  return { document: { reservations: rows, schemaVersion: 1 }, kind: "healthy" };
}

/** The decision for `observations` against `store`, read at {@link NOW} and reserved at the same instant unless named. */
function decide({
  nowIso = NOW,
  observations,
  reservedAtIso = nowIso,
  store,
}: {
  nowIso?: string;
  observations: readonly CodexPlanObservation[];
  reservedAtIso?: string;
  store: CodexPassReservationStore;
}): ReturnType<typeof decideCodexPassReservation> {
  return decideCodexPassReservation({
    bound: BOUND,
    nowIso,
    observations,
    pid: 4242,
    reservationId: "res-new",
    reservedAtIso,
    store,
    thresholds: DEFAULT_THRESHOLDS.codex,
  });
}

/** One account at `percent` of a `limit`% usage limit. */
function limitedAt({ limit = 50, percent }: { limit?: 50 | 30; percent: number }): readonly CodexPlanObservation[] {
  return [accountRow({ account: "acct-one", alias: "plan-one", percent, usageLimitPercent: limit })];
}

describe("the reservation arithmetic at the owner's limit", () => {
  it("reserves when the week projects to the limit EXACTLY — 48 read, 1 reserved, 1 asked, limit 50", () => {
    const decision = decide({
      observations: limitedAt({ percent: 48 }),
      store: healthy({ rows: [heldRow({ id: "res-a", identities: [ACCT_ONE] })] }),
    });
    const reservation: CodexPassReservation = {
      accountIdentities: [ACCT_ONE, STORE_ONE],
      accountKey: createHash("sha256").update(ACCT_ONE, "utf8").digest("hex"),
      acquiredAtIso: NOW,
      destinationAlias: "plan-one",
      expiresAtIso: EXPIRES,
      id: "res-new",
      pid: 4242,
      weeklyPoints: 1,
    };

    expect(decision).toEqual({
      destination: { alias: "plan-one", codexHome: "/homes/plan-one" },
      document: { reservations: [heldRow({ id: "res-a", identities: [ACCT_ONE] }), reservation], schemaVersion: 1 },
      kind: "reserved",
      reservation,
      why:
        "plan-one can take a pass — ranked 1 of 1 on weekly; reserved 1 weekly point of its account's 50% usage limit " +
        "(read live at 48% used, 1 already reserved) until 2026-09-22T12:25:00.000Z",
    });
  });

  it("REFUSES one point past the limit — 49 read, 1 reserved — and says it is the owner's limit", () => {
    const decision = decide({
      observations: limitedAt({ percent: 49 }),
      store: healthy({ rows: [heldRow({ id: "res-a", identities: [ACCT_ONE] })] }),
    });

    expect(decision).toEqual({
      kind: "refused",
      why:
        "no Codex destination can take this pass within its account's usage limit — plan-one (usage-limit: weekly " +
        "window read live at 49% used; 1 point(s) are reserved by passes still running and this pass needs 1 more, " +
        "which would exceed this account's 50% usage limit — the owner's own limit, not provider cap evidence, and no " +
        "--force crosses it)",
    });
  });

  it("reserves the last point when nothing else holds one — 49 read, 0 reserved", () => {
    const decision = decide({ observations: limitedAt({ percent: 49 }), store: healthy() });

    expect(decision.kind).toBe("reserved");
    expect(decision.why).toContain("(read live at 49% used, 0 already reserved)");
  });

  it("counts a row until the instant it lapses, and not at that instant", () => {
    const lapsing = healthy({ rows: [heldRow({ expiresAtIso: NOW, id: "res-a", identities: [ACCT_ONE] })] });
    const standing = healthy({
      rows: [heldRow({ expiresAtIso: "2026-09-22T12:00:00.001Z", id: "res-a", identities: [ACCT_ONE] })],
    });

    expect(decide({ observations: limitedAt({ percent: 49 }), store: lapsing }).kind).toBe("reserved");
    expect(decide({ observations: limitedAt({ percent: 49 }), store: standing }).kind).toBe("refused");
  });

  it("dates a new row from the instant it is reserved at, not the instant the fleet was read at", () => {
    const decision = decide({
      observations: limitedAt({ percent: 10 }),
      reservedAtIso: "2026-09-22T12:30:00.000Z",
      store: healthy(),
    });

    expect(decision.kind).toBe("reserved");
    expect(decision.why).toContain("until 2026-09-22T12:55:00.000Z");
  });

  // A 99% weekly window resetting at the read's instant while the fleet read was in flight: judged at the read's own
  // instant it is still near the cap and refused, exactly as routing with no reservation judges it.
  it("ranks at the instant the fleet was read at, so a window resetting mid-read routes as it did before", () => {
    const observations = [accountRow({ account: "acct-one", alias: "plan-one", percent: 99 })];

    const decision = decide({
      nowIso: "2026-09-29T11:59:59.900Z",
      observations,
      reservedAtIso: "2026-09-29T12:00:00.100Z",
      store: healthy(),
    });

    expect(decision.kind).toBe("refused");
    // The falsifier: ranked at the later instant, the window has reset and the same account takes the pass.
    expect(decide({ nowIso: "2026-09-29T12:00:00.100Z", observations, store: healthy() }).kind).toBe("unlimited");
  });

  it("never counts a reservation held on a different account", () => {
    const decision = decide({
      observations: limitedAt({ percent: 49 }),
      store: healthy({ rows: [heldRow({ id: "res-a", identities: [ACCT_TWO] })] }),
    });

    expect(decision.kind).toBe("reserved");
    expect(decision.why).toContain("0 already reserved");
  });
});

describe("the account, not the row", () => {
  // Two rows signed into one account: a 50 row reading 20 and a 30 row reading 29. The account is held to the
  // LOWER limit and to the HIGHER reading, so it has exactly one point left, whichever row the ranking puts first.
  it("holds an account to its lowest limit and its highest live reading", () => {
    const observations = [
      accountRow({ account: "acct-one", alias: "plan-one", percent: 20, usageLimitPercent: 50 }),
      accountRow({ account: "acct-one", alias: "plan-two", percent: 29, usageLimitPercent: 30 }),
    ];

    const open = decide({ observations, store: healthy() });
    const spent = decide({
      observations,
      store: healthy({ rows: [heldRow({ id: "res-a", identities: [ACCT_ONE] })] }),
    });

    expect(open.kind).toBe("reserved");
    expect(open.why).toContain(
      "plan-one can take a pass — ranked 1 of 2 on weekly; reserved 1 weekly point of its account's 30% usage limit (read live at 29% used, 0 already reserved)",
    );
    expect(spent.kind).toBe("refused");
    expect(spent.why).toContain("plan-one (usage-limit: weekly window read live at 29% used; 1 point(s) are reserved");
    expect(spent.why).toContain("plan-two (usage-limit: weekly window read live at 29% used; 1 point(s) are reserved");
  });

  // One store names its account by id on one read and only by address on the next. The row taken on the first read
  // carries the id's digest and the store's (the exact row above); on the second read only the store matches.
  it("counts a row taken on a store that names its account differently on the next read", () => {
    const byAddress = [
      accountRow({
        account: undefined,
        alias: "plan-one",
        email: "ops@acme.example",
        percent: 49,
        usageLimitPercent: 50,
      }),
    ];
    const takenById = heldRow({ id: "res-a", identities: [ACCT_ONE, STORE_ONE] });
    const providerOnly = heldRow({ id: "res-a", identities: [ACCT_ONE] });

    const counted = decide({ observations: byAddress, store: healthy({ rows: [takenById] }) });
    const missed = decide({ observations: byAddress, store: healthy({ rows: [providerOnly] }) });

    expect(counted.kind).toBe("refused");
    expect(counted.why).toContain("1 point(s) are reserved by passes still running");
    // The falsifier: keyed on the provider identity alone, the same row is invisible and the last point is granted.
    expect(missed.kind).toBe("reserved");
  });

  it("refuses a limited account no identity proves, and routes the unlimited row behind it with no reservation", () => {
    const observations = [
      accountRow({ account: undefined, alias: "plan-one", percent: 10, usageLimitPercent: 50 }),
      accountRow({ account: "acct-two", alias: "plan-two", percent: 40 }),
    ];

    const decision = decide({ observations, store: healthy() });

    expect(decision).toEqual({
      destination: { alias: "plan-two", codexHome: "/homes/plan-two" },
      kind: "unlimited",
      why:
        "plan-two can take a pass — ranked 2 of 2 on weekly; passed over plan-one (usage-limit: held to the owner's " +
        "50% usage limit and no account id or address on its live read proves which provider account it is, so no " +
        "reservation can be held against it)",
    });
  });

  // The ranking already holds a limited row with no live reading out; the account gate holds the same account out
  // through an UNLIMITED row on it, which the ranking alone would have let through.
  it("makes no reservation on an account whose week nothing read", () => {
    const observations = [
      accountRow({ account: "acct-one", alias: "plan-one", percent: undefined }),
      accountRow({ account: "acct-one", alias: "plan-two", percent: undefined, usageLimitPercent: 50 }),
    ];

    const decision = decide({ observations, store: healthy() });

    expect(decision.kind).toBe("refused");
    expect(decision.why).toContain(
      "plan-one (usage-limit: weekly window unread, so nothing shows it under this plan's 50% usage limit",
    );
  });

  it("makes no reservation on an account whose week only the rollout log read", () => {
    const observations = [
      accountRow({ account: "acct-one", alias: "plan-one", percent: 10, readFrom: "rollout" }),
      accountRow({ account: "acct-one", alias: "plan-two", percent: undefined, usageLimitPercent: 50 }),
    ];

    const decision = decide({ observations, store: healthy() });

    expect(decision.kind).toBe("refused");
    expect(decision.why).toContain("plan-one (usage-limit: weekly window read only from the rollout log, at 10%");
  });
});

describe("a reservation store that cannot be counted on", () => {
  it("holds every limited account out while an unlimited account still takes the pass", () => {
    const observations = [
      accountRow({ account: "acct-one", alias: "plan-one", percent: 10, usageLimitPercent: 50 }),
      accountRow({ account: "acct-two", alias: "plan-two", percent: 40 }),
    ];
    const store: CodexPassReservationStore = { kind: "unavailable", reason: "the document did not parse" };

    const decision = decide({ observations, store });

    expect(decision.kind).toBe("unlimited");
    expect(decision.why).toContain(
      "passed over plan-one (usage-limit: held to the owner's 50% usage limit and the pass reservation store is unavailable (the document did not parse)",
    );
  });

  it("refuses outright when every account is limited", () => {
    const store: CodexPassReservationStore = { kind: "unavailable", reason: "the document did not parse" };

    expect(decide({ observations: limitedAt({ percent: 10 }), store }).kind).toBe("refused");
  });
});
