/**
 * `alias provision`/`list`/`catch-all` against an injected seam.
 *
 * The seam is six plain functions, never a mock: each records what it was asked for, so "wrote nothing" is
 * asserted against a RECORD of the calls rather than against the absence of an error. A refusal that
 * happened to print the right line while still creating the rule would pass the first kind of check and
 * fail this one, which is the whole reason the recorder exists.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { DoorLedgerPort } from "../../../../../admit/doorLedgerPort.js";
import { AliasErrors } from "../../../../../alias/errors.js";
import type { AliasRule } from "../../../../../alias/rules.js";
import type { AliasDeps, AliasRouting } from "../../../../../cli/commands/alias/deps.js";
import { runAliasCatchAll, runAliasList, runAliasProvision } from "../../../../../cli/commands/alias/run.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../../../../cli/exitCodes.js";
import { err, ok } from "../../../../../lib/result.js";
import type { CatchAllTarget, ResolvedZone } from "../../../../../live/cloudflare/emailRouting.js";
import { memoryDoorLedger, unreachableDoorLedger } from "../../../../doorLedgerFixture.js";

const ZONE: ResolvedZone = { accountId: "0000ac01", id: "zone-1", name: "acme.com" };
const ADDRESS = "ada-owner-claude-five@acme.com";
const DESTINATION = "ops@acme.com";

const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A throwaway home, so the door ledger this run writes never touches the operator's own. */
function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), "alias-run-home-"));
  fixtureDirs.push(home);
  return home;
}

/** One forwarding rule, as Cloudflare would have returned it. */
function rule(over: Partial<AliasRule> = {}): AliasRule {
  return { address: ADDRESS, destinations: [DESTINATION], enabled: true, ruleId: "r1", ...over };
}

/** Everything a run asked the seam to do, in the order it asked. */
interface Recorder {
  readonly creates: { address: string; destination: string }[];
  readonly catchAlls: CatchAllTarget[];
  readonly out: string[];
  readonly err: string[];
}

function recorder(): Recorder {
  return { catchAlls: [], creates: [], err: [], out: [] };
}

/** How each check answers this case — every one of them a plain function. */
interface SeamBehaviour {
  readonly zoneHeld: boolean;
  readonly routingEnabled: boolean;
  readonly destinationVerified: boolean;
  readonly rules: readonly AliasRule[];
  /** The catch-all the zone is standing on. A zone with none reads back disabled, forwarding nowhere. */
  readonly catchAll: AliasRule;
}

/** A zone with no catch-all configured, which is how Cloudflare answers one. */
const NO_CATCH_ALL: AliasRule = { address: "", destinations: [], enabled: false, ruleId: "catch-all" };

const HAPPY: SeamBehaviour = {
  catchAll: NO_CATCH_ALL,
  destinationVerified: true,
  routingEnabled: true,
  rules: [],
  zoneHeld: true,
};

function fakeRouting({ behaviour, record }: { behaviour: SeamBehaviour; record: Recorder }): AliasRouting {
  return {
    createForwardRule: ({ address, destination }) => {
      record.creates.push({ address, destination });
      return Promise.resolve(ok(rule({ address, destinations: [destination] })));
    },
    getCatchAll: () => Promise.resolve(ok(behaviour.catchAll)),
    listRules: () => Promise.resolve(ok(behaviour.rules)),
    requireRoutingEnabled: () =>
      Promise.resolve(behaviour.routingEnabled ? ok(undefined) : err(AliasErrors.routingDisabled({ zone: ZONE.name }))),
    requireVerifiedDestination: ({ destination }) =>
      Promise.resolve(
        behaviour.destinationVerified ? ok(undefined) : err(AliasErrors.destinationUnverified({ destination })),
      ),
    resolveZone: ({ zone }) =>
      Promise.resolve(behaviour.zoneHeld ? ok(ZONE) : err(AliasErrors.zoneNotInAccount({ held: ["acme.com"], zone }))),
    setCatchAll: ({ target }) => {
      record.catchAlls.push(target);
      return Promise.resolve(
        ok(rule({ address: "", destinations: target.kind === "forward" ? [target.destination] : [] })),
      );
    },
  };
}

function fakeDeps({
  behaviour,
  doorLedger = memoryDoorLedger().port,
  record,
}: {
  behaviour: SeamBehaviour;
  doorLedger?: DoorLedgerPort;
  record: Recorder;
}): AliasDeps {
  return {
    doorLedger,
    err: ({ line }) => record.err.push(line),
    makeRouting: () => fakeRouting({ behaviour, record }),
    out: ({ line }) => record.out.push(line),
    resolveToken: () => "cf-token",
  };
}

/** A complete, valid `alias provision` invocation, so a case changes only what it is about. */
function provisionOptions({ home }: { home: string }) {
  return {
    address: ADDRESS,
    destination: DESTINATION,
    home,
    identity: "ada-owner",
    json: false,
    label: "five",
    provider: "claude" as const,
    zone: "acme.com",
  };
}

describe("runAliasProvision", () => {
  it("sends exactly one create on a held zone, and reports the address it wrote", async () => {
    const record = recorder();
    const code = await runAliasProvision({
      deps: fakeDeps({ behaviour: HAPPY, record }),
      options: provisionOptions({ home: tempHome() }),
    });

    expect(code).toBe(EXIT_OK);
    expect(record.creates).toEqual([{ address: ADDRESS, destination: DESTINATION }]);
    expect(record.out).toEqual([`provisioned ${ADDRESS} -> ${DESTINATION}`, `on  ${ADDRESS} -> ${DESTINATION}`]);
    expect(record.err).toEqual([]);
  });

  it("sends no create and exits 1, not as a policy refusal, when the store cannot record the decision", async () => {
    const record = recorder();
    const code = await runAliasProvision({
      deps: fakeDeps({ behaviour: HAPPY, doorLedger: unreachableDoorLedger(), record }),
      options: provisionOptions({ home: tempHome() }),
    });

    expect(code).toBe(EXIT_ERROR);
    expect(record.creates).toEqual([]);
    expect(record.err.join("\n")).toContain(
      "slopweaver alias provision not performed: the door ledger lives in the store",
    );
    expect(record.err.join("\n")).toContain("The store said: fixture: the store is down");
  });

  it("writes NOTHING when the account does not hold the zone, and names the zones it holds", async () => {
    const record = recorder();
    const code = await runAliasProvision({
      deps: fakeDeps({ behaviour: { ...HAPPY, zoneHeld: false }, record }),
      options: { ...provisionOptions({ home: tempHome() }), zone: "slopweaver.ai" },
    });

    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(record.creates).toEqual([]);
    expect(record.err).toEqual(["slopweaver.ai is not a zone this Cloudflare account holds — it holds acme.com"]);
  });

  it("writes NOTHING when email routing is off on the zone", async () => {
    const record = recorder();
    const code = await runAliasProvision({
      deps: fakeDeps({ behaviour: { ...HAPPY, routingEnabled: false }, record }),
      options: provisionOptions({ home: tempHome() }),
    });

    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(record.creates).toEqual([]);
    expect(record.err).toEqual(["email routing is not enabled on acme.com, so no address on it can receive mail yet"]);
  });

  it("writes NOTHING when Cloudflare has not verified the destination", async () => {
    const record = recorder();
    const code = await runAliasProvision({
      deps: fakeDeps({ behaviour: { ...HAPPY, destinationVerified: false }, record }),
      options: provisionOptions({ home: tempHome() }),
    });

    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(record.creates).toEqual([]);
    expect(record.err[0]).toContain(`cloudflare has not verified ${DESTINATION}`);
  });

  it("reports an address already routed rather than duplicating its rule", async () => {
    const record = recorder();
    const code = await runAliasProvision({
      deps: fakeDeps({ behaviour: { ...HAPPY, rules: [rule()] }, record }),
      options: provisionOptions({ home: tempHome() }),
    });

    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(record.creates).toEqual([]);
    expect(record.err).toEqual([
      `${ADDRESS} already forwards to ${DESTINATION}, so there is nothing to provision`,
      `on  ${ADDRESS} -> ${DESTINATION}`,
    ]);
  });

  it("refuses with no token, before it reaches the zone at all", async () => {
    const record = recorder();
    const deps: AliasDeps = { ...fakeDeps({ behaviour: HAPPY, record }), resolveToken: () => undefined };
    const code = await runAliasProvision({ deps, options: provisionOptions({ home: tempHome() }) });

    expect(code).toBe(EXIT_ERROR);
    expect(record.creates).toEqual([]);
    expect(record.err).toEqual(["no Cloudflare token configured — run: slopweaver secrets set cloudflare-token"]);
  });
});

describe("runAliasList", () => {
  it("prints every rule on the zone, ours and not", async () => {
    const record = recorder();
    const strangers = [rule(), rule({ address: "", destinations: [], enabled: false, ruleId: "r2" })];
    const code = await runAliasList({
      deps: fakeDeps({ behaviour: { ...HAPPY, rules: strangers }, record }),
      options: { home: tempHome(), json: false, zone: "acme.com" },
    });

    expect(code).toBe(EXIT_OK);
    expect(record.out).toEqual([
      "acme.com: 2 email routing rule(s)",
      `on  ${ADDRESS} -> ${DESTINATION}`,
      "off  (not a single-address rule) -> (no forward action)",
    ]);
  });

  it("refuses a zone the account does not hold", async () => {
    const record = recorder();
    const code = await runAliasList({
      deps: fakeDeps({ behaviour: { ...HAPPY, zoneHeld: false }, record }),
      options: { home: tempHome(), json: false, zone: "slopweaver.ai" },
    });

    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(record.out).toEqual([]);
  });
});

describe("runAliasCatchAll", () => {
  /** A zone whose catch-all already forwards everything to one mailbox. */
  const standingCatchAll: AliasRule = {
    address: "",
    destinations: ["ops-old@acme.com"],
    enabled: true,
    ruleId: "catch-all",
  };

  it("forwards every unmatched address to a verified mailbox", async () => {
    const record = recorder();
    const code = await runAliasCatchAll({
      deps: fakeDeps({ behaviour: HAPPY, record }),
      options: { destination: DESTINATION, home: tempHome(), json: false, zone: "acme.com" },
    });

    expect(code).toBe(EXIT_OK);
    expect(record.catchAlls).toEqual([{ destination: DESTINATION, kind: "forward" }]);
  });

  it("drops rather than forwarding when it is switched off, and asks for no mailbox to do it", async () => {
    const record = recorder();
    const code = await runAliasCatchAll({
      deps: fakeDeps({ behaviour: { ...HAPPY, catchAll: standingCatchAll, destinationVerified: false }, record }),
      options: { destination: null, home: tempHome(), json: false, zone: "acme.com" },
    });

    expect(code).toBe(EXIT_OK);
    expect(record.catchAlls).toEqual([{ kind: "drop" }]);
  });

  it("writes NOTHING when the mailbox it would catch everything into is unverified", async () => {
    const record = recorder();
    const code = await runAliasCatchAll({
      deps: fakeDeps({ behaviour: { ...HAPPY, destinationVerified: false }, record }),
      options: { destination: DESTINATION, home: tempHome(), json: false, zone: "acme.com" },
    });

    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(record.catchAlls).toEqual([]);
  });

  it("NAMES the standing catch-all it is about to replace, rather than re-pointing the zone silently", async () => {
    const record = recorder();
    const code = await runAliasCatchAll({
      deps: fakeDeps({ behaviour: { ...HAPPY, catchAll: standingCatchAll }, record }),
      options: { destination: DESTINATION, home: tempHome(), json: false, zone: "acme.com" },
    });

    expect(code).toBe(EXIT_OK);
    expect(record.err).toEqual([
      "replacing the standing catch-all — on  (not a single-address rule) -> ops-old@acme.com",
    ]);
    expect(record.catchAlls).toEqual([{ destination: DESTINATION, kind: "forward" }]);
  });

  it("writes NOTHING when the catch-all is already exactly what was asked for", async () => {
    const record = recorder();
    const already: AliasRule = { address: "", destinations: [DESTINATION], enabled: true, ruleId: "catch-all" };
    const code = await runAliasCatchAll({
      deps: fakeDeps({ behaviour: { ...HAPPY, catchAll: already }, record }),
      options: { destination: DESTINATION, home: tempHome(), json: false, zone: "acme.com" },
    });

    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(record.catchAlls).toEqual([]);
    expect(record.err).toEqual([
      "acme.com's catch-all is already what you asked for",
      `on  (not a single-address rule) -> ${DESTINATION}`,
    ]);
  });

  it("writes NOTHING when --disable is asked of a zone that already catches nothing", async () => {
    const record = recorder();
    const code = await runAliasCatchAll({
      deps: fakeDeps({ behaviour: HAPPY, record }),
      options: { destination: null, home: tempHome(), json: false, zone: "acme.com" },
    });

    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(record.catchAlls).toEqual([]);
  });
});
