/**
 * Which account a `codex plan` / `codex review` pass spends — `cli/commands/codex/passDeps.ts`, over a REAL
 * plan register and the REAL reservation port in a throwaway home, per testing.md's fixture allowance.
 *
 * `unit/codex/fleetCap.test.ts` and `unit/codex/passReservation.test.ts` hold the pure judgements down over
 * hand-built rankings. What is only observable here is the WIRING: whether the destination the factory is handed is
 * the one the register on disk ranks first, whether a fleet with nothing eligible REFUSES rather than falling
 * through onto the ambient `$CODEX_HOME`, and whether a pass that never got a client holds no reservation.
 *
 * Every case writes its own `plans.json`, so the derived bootstrap row never fires and nothing here reads
 * the operator's own register. The factory is a plain fake function passed in — an injected seam, not a mock.
 */
import { readFileSync, rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

import { type CodexDeps, type RoutedCodexPass, routedCodexPass } from "../../../../../cli/commands/codex/passDeps.js";
import { EXIT_ERROR } from "../../../../../cli/exitCodes.js";
import type { CodexAccountLive } from "../../../../../codex/accountLiveParse.js";
import { makePassBound } from "../../../../../codex/bounds.js";
import type { CodexClientFactory, LockedCodexClient, LockedCodexThread } from "../../../../../codex/client.js";
import type { CodexDestination } from "../../../../../codex/destinations.js";
import type { CodexPassReservationPort } from "../../../../../codex/passReservationStore.js";
import type { DeadlineRuntime } from "../../../../../codex/runPass.js";
import { err, ok, unwrap } from "../../../../../lib/result.js";
import type { PlanRegisterPort } from "../../../../../plans/port.js";
import { stateHomePaths } from "../../../../../stateHome.js";
import {
  type ReservationRow,
  reservationHome,
  signedInLive,
  testReservationPort,
} from "../../../../codexPassReservationFixture.js";
import { memoryFallbackRegisterPort } from "../../../../fallbackRegisterFixture.js";
import { memorySupersessionPort } from "../../../../landingRegistersFixture.js";
import { memoryPlanRegisterPort, unavailablePlanRegisterPort } from "../../../../planRegisterFixture.js";

const roots: string[] = [];

const BOUND = unwrap(makePassBound({ boundSeconds: 600 }));

/** A clock the routing never consults, present only because `CodexDeps` declares one. */
const RUNTIME: DeadlineRuntime = {
  nowIso: () => "2026-09-23T06:00:00.000Z",
  nowMs: () => 0,
  schedule: () => ({ cancel: () => {} }),
};

/** A thread the fake client hands back. Nothing here runs a pass, so it is never asked to. */
function noThread(): LockedCodexThread {
  return {
    currentId: () => null,
    run: async () => {
      throw new Error("no pass is run in this test");
    },
  };
}

/** A home whose register carries `rows`, each on an existing store, removed after the test. */
function homeWith({ rows }: { rows: readonly ReservationRow[] }): ReturnType<typeof reservationHome> {
  const made = reservationHome({ rows });
  roots.push(made.root);
  return made;
}

/** A factory that records the destination and model it was asked for instead of building a real client. */
function recordingFactory({ asked, models }: { asked: CodexDestination[]; models: string[] }): CodexClientFactory {
  return ({ destination, model }) => {
    asked.push(destination);
    models.push(model);
    return ok({ model, resumeThread: () => noThread(), startThread: () => noThread() } satisfies LockedCodexClient);
  };
}

/** The routed pass, or a thrown failure naming the exit code — the throwing unwrap for this function's union. */
function expectRouted({ routed }: { routed: RoutedCodexPass | number }): RoutedCodexPass {
  if (typeof routed === "number") {
    throw new Error(`expected a routed pass, got exit code ${String(routed)}`);
  }
  return routed;
}

/** Deps over the given factory and a reservation port reading the given register and live answers. */
function depsOver({
  byHome = {},
  clientFor,
  registerPort = memoryPlanRegisterPort(),
}: {
  byHome?: Readonly<Record<string, CodexAccountLive>>;
  clientFor: CodexClientFactory;
  registerPort?: PlanRegisterPort;
}): CodexDeps {
  return {
    clientFor,
    fallbackPort: memoryFallbackRegisterPort(),
    reservationPort: testReservationPort({ byHome, registerPort }),
    runtime: RUNTIME,
    supersessions: memorySupersessionPort(),
  };
}

afterEach(() => {
  roots.splice(0).forEach((root) => {
    rmSync(root, { force: true, recursive: true });
  });
});

describe("routing a Codex pass to a registered destination", () => {
  it("builds the client for the destination the register ranks first, not the ambient one", async () => {
    const { home, storeOf } = homeWith({ rows: [{ alias: "plan-six" }] });
    const asked: CodexDestination[] = [];
    const models: string[] = [];

    const routed = await routedCodexPass({
      bound: BOUND,
      deps: depsOver({ clientFor: recordingFactory({ asked, models }) }),
      home,
      model: "gpt-6-astra",
    });

    expect(routed).not.toBe(EXIT_ERROR);
    expect(asked).toEqual([{ alias: "plan-six", codexHome: storeOf["plan-six"] }]);
    // The per-pass override reaches the factory: a pass that named another model is not quietly on the default.
    expect(models).toEqual(["gpt-6-astra"]);
  });

  // The falsifiable partner: the SAME shape of register, with its one row paused, must refuse — and must
  // never reach the factory, because reaching it with no destination is exactly the ambient-home fallthrough
  // this routing exists to end.
  it("REFUSES rather than routing when every registered destination is paused", async () => {
    const { home } = homeWith({ rows: [{ alias: "plan-six", paused: true }] });
    const asked: CodexDestination[] = [];
    const deps = depsOver({ clientFor: recordingFactory({ asked, models: [] }) });

    expect(await routedCodexPass({ bound: BOUND, deps, home, model: "gpt-5.6-sol" })).toBe(EXIT_ERROR);
    expect(asked).toEqual([]);
  });

  // A pass inherits the owner's usage policy through the same ranking, with no path of its own: a register
  // whose one row is an unmeasured monthly allowance refuses exactly as the paused one above does, while the
  // first case's weekly row on an existing store is the falsifier.
  it("REFUSES rather than routing when the only registered destination is an unmeasured monthly allowance", async () => {
    const { home } = homeWith({
      rows: [{ alias: "plan-six", extra: { allowance: { kind: "monthly-spend" }, pinned: true } }],
    });
    const asked: CodexDestination[] = [];
    const deps = depsOver({ clientFor: recordingFactory({ asked, models: [] }) });

    expect(await routedCodexPass({ bound: BOUND, deps, home, model: "gpt-5.6-sol" })).toBe(EXIT_ERROR);
    expect(asked).toEqual([]);
  });

  // The browser door's arm: a routable destination whose factory REFUSES (its home would still start a
  // browser) stops the pass rather than spending it — the refusal is the factory's, the exit code this one's.
  it("stops the pass when the factory refuses the routed destination", async () => {
    const { home, storeOf } = homeWith({ rows: [{ alias: "plan-six" }] });
    const asked: CodexDestination[] = [];
    const clientFor: CodexClientFactory = ({ destination }) => {
      asked.push(destination);
      return err("a Codex thread launch blocked because cua_repl would start");
    };

    expect(await routedCodexPass({ bound: BOUND, deps: depsOver({ clientFor }), home, model: "gpt-5.6-sol" })).toBe(
      EXIT_ERROR,
    );
    expect(asked).toEqual([{ alias: "plan-six", codexHome: storeOf["plan-six"] }]);
  });

  // The store-era fallthrough: a register the store cannot answer for must refuse the pass and never reach the
  // factory, exactly as an all-paused fleet does — never route onto the ambient home over an outage.
  it("REFUSES without reaching the factory when the register store cannot be read", async () => {
    const { home } = homeWith({ rows: [{ alias: "plan-six" }] });
    const asked: CodexDestination[] = [];
    const deps = depsOver({
      clientFor: recordingFactory({ asked, models: [] }),
      registerPort: unavailablePlanRegisterPort(),
    });

    expect(await routedCodexPass({ bound: BOUND, deps, home, model: "gpt-5.6-sol" })).toBe(EXIT_ERROR);
    expect(asked).toEqual([]);
  });
});

describe("a routed pass on a usage-limited account", () => {
  it("holds one reservation while it runs, and none once released", async () => {
    const { home, storeOf } = homeWith({ rows: [{ alias: "plan-one", usageLimitPercent: 50 }] });
    const store = storeOf["plan-one"]!;
    const byHome = { [store]: signedInLive({ accountId: "acct-one", codexHome: store, weeklyPercent: 48 }) };
    const deps = depsOver({ byHome, clientFor: recordingFactory({ asked: [], models: [] }) });
    const path = stateHomePaths({ home }).live.codexPassReservationsJson;

    const routed = expectRouted({ routed: await routedCodexPass({ bound: BOUND, deps, home, model: "gpt-5.6-sol" }) });
    const held = JSON.parse(readFileSync(path, "utf8")) as { reservations: { destinationAlias: string }[] };
    expect(held.reservations.map((row) => row.destinationAlias)).toEqual(["plan-one"]);

    await routed.release();
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ reservations: [], schemaVersion: 1 });
  });

  // The lock's filesystem staging THROWS on a full disk. A release that rejects must still resolve, so the throw is
  // printed rather than replacing the result of the pass whose `finally` awaited it.
  it("resolves even when the release itself throws", async () => {
    const { home, storeOf } = homeWith({ rows: [{ alias: "plan-one", usageLimitPercent: 50 }] });
    const reservationPort: CodexPassReservationPort = {
      acquire: () =>
        Promise.resolve(
          ok({
            destination: { alias: "plan-one", codexHome: storeOf["plan-one"]! },
            kind: "routed",
            release: () => Promise.reject(new Error("ENOSPC: no space left on device")),
            reservation: {
              accountIdentities: ["acct-digest"],
              accountKey: "key-digest",
              acquiredAtIso: "2026-09-23T06:00:00.000Z",
              destinationAlias: "plan-one",
              expiresAtIso: "2026-09-23T06:25:00.000Z",
              id: "res-1",
              pid: 4242,
              weeklyPoints: 1,
            },
            why: "routed for the test",
          }),
        ),
    };
    const deps = { ...depsOver({ clientFor: recordingFactory({ asked: [], models: [] }) }), reservationPort };

    const routed = expectRouted({ routed: await routedCodexPass({ bound: BOUND, deps, home, model: "gpt-5.6-sol" }) });

    await expect(routed.release()).resolves.toBe(undefined);
  });

  // A pass the factory refuses never started, so it must not keep the point it reserved on the way.
  it("releases the reservation it took when the factory refuses the client", async () => {
    const { home, storeOf } = homeWith({ rows: [{ alias: "plan-one", usageLimitPercent: 50 }] });
    const store = storeOf["plan-one"]!;
    const byHome = { [store]: signedInLive({ accountId: "acct-one", codexHome: store, weeklyPercent: 48 }) };
    const clientFor: CodexClientFactory = () => err("a Codex thread launch blocked because cua_repl would start");

    expect(
      await routedCodexPass({ bound: BOUND, deps: depsOver({ byHome, clientFor }), home, model: "gpt-5.6-sol" }),
    ).toBe(EXIT_ERROR);
    const path = stateHomePaths({ home }).live.codexPassReservationsJson;
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ reservations: [], schemaVersion: 1 });
  });
});
