/**
 * The reservation document on disk and the locked transaction around it — `codex/passReservationDocument.ts` and
 * `codex/passReservationStore.ts`, over REAL files in a throwaway home (testing.md's fixture allowance) and the real
 * fleet read over in-memory ports and a fake live reader.
 *
 * What is only observable here is the effectful half: what a reservation writes and with which mode, that a release
 * removes its own row and nobody else's, that each kind of store fault is typed as itself, and that every one of
 * them holds a usage-limited account out of the pass while an unlimited account still takes it.
 */
import { chmodSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { acquireOperationLock } from "../../../admit/operationLock.js";
import type { CodexAccountLive } from "../../../codex/accountLiveParse.js";
import { makePassBound } from "../../../codex/bounds.js";
import { type CodexPassReservation, EMPTY_CODEX_PASS_RESERVATIONS } from "../../../codex/passReservation.js";
import { readCodexPassReservations, writeCodexPassReservations } from "../../../codex/passReservationDocument.js";
import {
  CODEX_PASS_RESERVATION_LOCK_KEY,
  type CodexPassRoute,
  reserveUnderLock,
} from "../../../codex/passReservationStore.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { stateHomePaths } from "../../../stateHome.js";
import {
  RESERVATION_NOW,
  type ReservationRow,
  reservationHome,
  signedInLive,
  testReservationPort,
  testReservationSeams,
} from "../../codexPassReservationFixture.js";

const roots: string[] = [];
/** Directories a case made read-only, given their write bit back before the tree is removed. */
const locked: string[] = [];

const BOUND = unwrap(makePassBound({ boundSeconds: 600 }));

afterEach(() => {
  locked.splice(0).forEach((dir) => {
    chmodSync(dir, 0o700);
  });
  roots.splice(0).forEach((root) => {
    rmSync(root, { force: true, recursive: true });
  });
});

/**
 * A home whose register carries `rows`, with each named store answering signed in to its own account at `percent`.
 *
 * @param live each alias's account id and weekly reading
 * @returns the home, the document's path and the port over them
 */
function fleet({
  live,
  rows,
}: {
  live: Readonly<Record<string, { account: string; percent: number }>>;
  rows: readonly ReservationRow[];
}): {
  readonly byHome: Readonly<Record<string, CodexAccountLive>>;
  readonly home: string;
  readonly path: string;
  readonly port: ReturnType<typeof testReservationPort>;
} {
  const made = reservationHome({ rows });
  roots.push(made.root);
  const byHome = Object.fromEntries(
    Object.entries(live).map(([alias, { account, percent }]) => {
      const codexHome = made.storeOf[alias]!;
      return [codexHome, signedInLive({ accountId: account, codexHome, weeklyPercent: percent })];
    }),
  );
  const path = stateHomePaths({ home: made.home }).live.codexPassReservationsJson;
  return {
    byHome,
    home: made.home,
    path,
    port: testReservationPort({ byHome, ids: ["res-1", "res-2", "res-3"], lockWaitSeconds: 1 }),
  };
}

/** One limited account at 40% of a 50% limit — room for ten passes. */
function limitedFleet(): ReturnType<typeof fleet> {
  return fleet({
    live: { "plan-one": { account: "acct-one", percent: 40 } },
    rows: [{ alias: "plan-one", usageLimitPercent: 50 }],
  });
}

/** A limited account ranked first and an unlimited one behind it. */
function mixedFleet(): ReturnType<typeof fleet> {
  return fleet({
    live: { "plan-one": { account: "acct-one", percent: 10 }, "plan-two": { account: "acct-two", percent: 40 } },
    rows: [{ alias: "plan-one", usageLimitPercent: 50 }, { alias: "plan-two" }],
  });
}

/** Where a route went, as `<kind>:<alias or why>` — one exact string to assert. */
function where({ route }: { route: CodexPassRoute }): string {
  return route.kind === "routed" ? `routed:${route.destination.alias}` : `refused:${route.why}`;
}

/** The routed arm, or a thrown failure carrying the refusal — the throwing unwrap for a route. */
function routedOrThrow({ route }: { route: CodexPassRoute }): CodexPassRoute & { kind: "routed" } {
  if (route.kind === "refused") {
    throw new Error(`expected a routed pass, got: ${route.why}`);
  }
  return route;
}

/** The ids standing in the document on disk. */
function idsOnDisk({ path }: { path: string }): readonly string[] {
  return unwrap(readCodexPassReservations({ path })).reservations.map((row) => row.id);
}

describe("the reservation document", () => {
  it("reads the empty version-1 document when no file is there", () => {
    const { path } = limitedFleet();

    expect(unwrap(readCodexPassReservations({ path }))).toEqual(EMPTY_CODEX_PASS_RESERVATIONS);
  });

  it("types a file that does not parse as MALFORMED, and one that cannot be read as UNREADABLE", () => {
    const { path } = limitedFleet();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "{not a document", "utf8");
    expect(unwrapErr(readCodexPassReservations({ path })).code).toBe("PASS_RESERVATION_STORE_MALFORMED");

    rmSync(path);
    mkdirSync(path);
    expect(unwrapErr(readCodexPassReservations({ path })).code).toBe("PASS_RESERVATION_STORE_UNREADABLE");
  });

  it("types a document whose reservations share one id as MALFORMED, since a release would erase both", async () => {
    const { home, path, port } = limitedFleet();
    unwrap(await port.acquire({ bound: BOUND, home }));
    unwrap(await port.acquire({ bound: BOUND, home }));
    const rows = unwrap(readCodexPassReservations({ path })).reservations.map((row) => ({ ...row, id: "dup" }));
    const shared = { reservations: rows, schemaVersion: 1 } as const;

    // The publisher refuses it and leaves the standing document as it was…
    expect(unwrapErr(writeCodexPassReservations({ document: shared, path })).code).toBe(
      "PASS_RESERVATION_STORE_MALFORMED",
    );
    expect(idsOnDisk({ path })).toEqual(["res-1", "res-2"]);

    // …and one written past it by any other hand reads as MALFORMED.
    writeFileSync(path, JSON.stringify(shared), "utf8");
    expect(unwrapErr(readCodexPassReservations({ path })).code).toBe("PASS_RESERVATION_STORE_MALFORMED");
  });

  it("types a publish into a directory it cannot write as WRITE_FAILED, leaving the old document standing", () => {
    const { path } = limitedFleet();
    unwrap(writeCodexPassReservations({ document: EMPTY_CODEX_PASS_RESERVATIONS, path }));
    chmodSync(dirname(path), 0o500);
    locked.push(dirname(path));

    const written = writeCodexPassReservations({ document: { reservations: [], schemaVersion: 1 }, path });

    expect(unwrapErr(written).code).toBe("PASS_RESERVATION_STORE_WRITE_FAILED");
    expect(unwrap(readCodexPassReservations({ path }))).toEqual(EMPTY_CODEX_PASS_RESERVATIONS);
  });
});

describe("reserving and releasing through the locked port", () => {
  it("writes one owner-only row for a pass on a limited account, dated by the pass's bound", async () => {
    const { home, path, port } = limitedFleet();

    const route = unwrap(await port.acquire({ bound: BOUND, home }));

    expect(where({ route })).toBe("routed:plan-one");
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(
      unwrap(readCodexPassReservations({ path })).reservations.map((row) => [
        row.id,
        row.acquiredAtIso,
        row.expiresAtIso,
        row.pid,
        row.weeklyPoints,
      ]),
    ).toEqual([["res-1", RESERVATION_NOW, "2026-11-05T06:25:00.000Z", 4242, 1]]);
  });

  it("dates a reservation from its publication, not from a fleet read that stalled past the pass's bound", async () => {
    const { byHome, home, path } = limitedFleet();
    // The fleet read starts at 06:00 and stalls; every later clock read is 06:30, past the 06:25 a read-dated row expires.
    let reads = 0;
    const seams = testReservationSeams({
      byHome,
      ids: ["res-late"],
      lockWaitSeconds: 1,
      nowIso: () => {
        reads += 1;
        if (reads === 1) {
          return "2026-11-05T06:00:00.000Z";
        }
        return "2026-11-05T06:30:00.000Z";
      },
    });

    unwrap(await reserveUnderLock({ bound: BOUND, home, seams, stillHeld: () => true }));

    expect(
      unwrap(readCodexPassReservations({ path })).reservations.map((row) => [row.acquiredAtIso, row.expiresAtIso]),
    ).toEqual([["2026-11-05T06:30:00.000Z", "2026-11-05T06:55:00.000Z"]]);
  });

  it("removes only its own row on release", async () => {
    const { home, path, port } = limitedFleet();
    const first = unwrap(await port.acquire({ bound: BOUND, home }));
    unwrap(await port.acquire({ bound: BOUND, home }));
    expect(idsOnDisk({ path })).toEqual(["res-1", "res-2"]);

    unwrap(await routedOrThrow({ route: first }).release());

    expect(idsOnDisk({ path })).toEqual(["res-2"]);
  });

  it("reads and writes nothing for a fleet with no usage limit", async () => {
    const { home, path, port } = fleet({
      live: { "plan-two": { account: "acct-two", percent: 40 } },
      rows: [{ alias: "plan-two" }],
    });

    const route = unwrap(await port.acquire({ bound: BOUND, home }));

    expect(where({ route })).toBe("routed:plan-two");
    expect(() => statSync(path)).toThrow("ENOENT");
  });
});

describe("a store fault holds limited accounts out and nothing else", () => {
  it("routes past a limited account to an unlimited one when the document does not parse, and leaves it as it was", async () => {
    const { home, path, port } = mixedFleet();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "{not a document", "utf8");

    const route = unwrap(await port.acquire({ bound: BOUND, home }));

    expect(where({ route })).toBe("routed:plan-two");
    expect(routedOrThrow({ route }).reservation).toBe(undefined);
    expect(readFileSync(path, "utf8")).toBe("{not a document");
  });

  it("refuses a fleet of limited accounts when the document cannot be read", async () => {
    const { home, path, port } = limitedFleet();
    mkdirSync(path, { recursive: true });

    const route = unwrap(await port.acquire({ bound: BOUND, home }));

    expect(route.kind).toBe("refused");
    expect(where({ route })).toContain("the pass reservation store is unavailable");
  });

  it("refuses a fleet of limited accounts when the reservation cannot be published", async () => {
    const { home, path, port } = limitedFleet();
    unwrap(writeCodexPassReservations({ document: EMPTY_CODEX_PASS_RESERVATIONS, path }));
    chmodSync(dirname(path), 0o500);
    locked.push(dirname(path));

    const route = unwrap(await port.acquire({ bound: BOUND, home }));

    expect(route.kind).toBe("refused");
    expect(where({ route })).toContain("could not be written");
    expect(idsOnDisk({ path })).toEqual([]);
  });

  /**
   * A holder stalled past the lock's stale threshold is taken over while still alive. Resuming, it must not publish
   * the document it read before the new holder's row — so a lost lease refuses, and writes nothing.
   */
  it("publishes nothing, and refuses a limited account, once its lease was taken over", async () => {
    const { byHome, home, path } = limitedFleet();
    const seams = testReservationSeams({
      byHome,
      ids: ["res-stale"],
      lockWaitSeconds: 1,
    });

    const route = unwrap(await reserveUnderLock({ bound: BOUND, home, seams, stillHeld: () => false }));

    expect(where({ route })).toContain("taken over after its lease aged out");
    expect(() => statSync(path)).toThrow("ENOENT");
  });

  // A lost lease is a store fault like any other: limited accounts are held out, an unlimited one still takes the
  // pass, with no reservation and nothing published.
  it("routes a holder whose lease was taken over only to an unlimited account, publishing nothing", async () => {
    const { byHome, home, path } = mixedFleet();
    const seams = testReservationSeams({ byHome, ids: ["res-stale"], lockWaitSeconds: 1 });

    const route = unwrap(await reserveUnderLock({ bound: BOUND, home, seams, stillHeld: () => false }));

    expect(where({ route })).toBe("routed:plan-two");
    expect(routedOrThrow({ route }).reservation).toBe(undefined);
    expect(() => statSync(path)).toThrow("ENOENT");
  });

  // The falsifier: the SAME step with its lease intact reserves and publishes its row.
  it("publishes its row when its lease still stands", async () => {
    const { byHome, home, path } = limitedFleet();
    const seams = testReservationSeams({
      byHome,
      ids: ["res-held"],
      lockWaitSeconds: 1,
    });

    const route = unwrap(await reserveUnderLock({ bound: BOUND, home, seams, stillHeld: () => true }));

    expect(where({ route })).toBe("routed:plan-one");
    expect(idsOnDisk({ path })).toEqual(["res-held"]);
  });

  it("holds a limited account out when the id it mints already names a standing reservation", async () => {
    const { byHome, home, path, port } = limitedFleet();
    unwrap(await port.acquire({ bound: BOUND, home }));
    const seams = testReservationSeams({ byHome, ids: ["res-1"], lockWaitSeconds: 1 });

    const route = unwrap(await reserveUnderLock({ bound: BOUND, home, seams, stillHeld: () => true }));

    expect(where({ route })).toContain("already names a standing reservation");
    expect(idsOnDisk({ path })).toEqual(["res-1"]);
  });

  // The falsifier: the SAME minted id over a row that has LAPSED clashes with nothing — the lapsed row is pruned on
  // publish, so the document stays unique and the limited account is reserved (found by a Codex review).
  it("reserves a limited account when the id it mints names only a lapsed reservation", async () => {
    const { byHome, home, path } = limitedFleet();
    mkdirSync(dirname(path), { recursive: true });
    const lapsed: CodexPassReservation = {
      accountIdentities: ["acct-digest"],
      accountKey: "key-digest",
      acquiredAtIso: "2026-11-05T05:35:00.000Z",
      destinationAlias: "plan-one",
      expiresAtIso: RESERVATION_NOW,
      id: "res-reused",
      pid: 4141,
      weeklyPoints: 1,
    };
    unwrap(writeCodexPassReservations({ document: { reservations: [lapsed], schemaVersion: 1 }, path }));
    const seams = testReservationSeams({ byHome, ids: ["res-reused"], lockWaitSeconds: 1 });

    const route = unwrap(await reserveUnderLock({ bound: BOUND, home, seams, stillHeld: () => true }));

    expect(where({ route })).toBe("routed:plan-one");
    expect(unwrap(readCodexPassReservations({ path })).reservations.map((row) => row.acquiredAtIso)).toEqual([
      RESERVATION_NOW,
    ]);
  });

  // The lock's staging THROWS on a filesystem fault rather than returning an error. A throw escaping the port would
  // stop the pass outright, so it must read as an unheld lock: the limited account held out, the unlimited one routed.
  it("routes only to an unlimited account when the lock cannot even be staged", async () => {
    const { home, path, port } = mixedFleet();
    const ledgers = stateHomePaths({ home }).ledgers;
    mkdirSync(ledgers, { recursive: true });
    writeFileSync(`${ledgers}/operation-locks`, "a file where the lock directory belongs", "utf8");

    const route = unwrap(await port.acquire({ bound: BOUND, home }));

    expect(where({ route })).toBe("routed:plan-two");
    expect(() => statSync(path)).toThrow("ENOENT");
  });

  it("routes only to an unlimited account while another process holds the lock past the wait", async () => {
    const { home, port } = mixedFleet();
    const held = unwrap(acquireOperationLock({ home, key: CODEX_PASS_RESERVATION_LOCK_KEY, nowIso: RESERVATION_NOW }));

    try {
      const route = unwrap(await port.acquire({ bound: BOUND, home }));
      expect(where({ route })).toBe("routed:plan-two");
    } finally {
      held.release();
    }
  });
});
