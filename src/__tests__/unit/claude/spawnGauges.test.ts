import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { ClaudeAccount, ClaudeAccountGauge } from "../../../claude/contracts.js";
import type { StoreLife } from "../../../claude/credentialRepair.js";
import { ClaudeRotationErrors } from "../../../claude/errors.js";
import type { ClaudePlanProbesPort } from "../../../claude/planProbes.js";
import type { ProbeRepairDeps } from "../../../claude/probeRepair.js";
import type { ClaudeProbeResult } from "../../../claude/probeStore.js";
import { readSpawnGauges } from "../../../claude/spawnGauges.js";
import { err, ok, unwrap } from "../../../lib/result.js";
import { memoryClaudePlanProbesPort, unavailableClaudePlanProbesPort } from "../../claudePlanProbesFixture.js";

const NOW = "2026-10-10T06:00:00.000Z";
const EXPIRED = "2026-10-10T05:45:00.000Z";
const ALIVE = "2026-10-10T14:00:00.000Z";
const HOME = "/home/spawn-gauges";

const ACCOUNTS: readonly ClaudeAccount[] = [
  { alias: "plan-one", storeDir: "/stores/plan-one" },
  { alias: "plan-two", storeDir: "/stores/plan-two" },
  { alias: "plan-three", storeDir: "/stores/plan-three" },
];

const minted: string[] = [];

/** A store directory that is really on disk, so a recorded probe is judged on its reading, not on a missing store. */
function storeOnDisk({ alias }: { alias: string }): ClaudeAccount {
  const storeDir = mkdtempSync(join(tmpdir(), `${alias}-`));
  minted.push(storeDir);
  return { alias, storeDir };
}

afterEach(() => {
  for (const dir of minted.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

const lifeAt = ({ alias, expiresAtIso }: { alias: string; expiresAtIso: string }): StoreLife => ({
  alias,
  expiresAtIso,
  hasCredential: true,
  hasRefreshToken: true,
  refreshExpiresAtIso: "2026-11-09T12:00:00.000Z",
});

const liveLife = ({ alias }: { alias: string }): StoreLife => lifeAt({ alias, expiresAtIso: ALIVE });

const gaugeFor = ({ alias }: { alias: string }): ClaudeAccountGauge => ({
  alias,
  fiveHour: { resetAtIso: ALIVE, status: "allowed", utilization: 0.2 },
  observedAtIso: NOW,
  sevenDay: { resetAtIso: ALIVE, status: "allowed", utilization: 0.3 },
});

const healthy = ({ alias, life }: { alias: string; life: StoreLife }): ClaudeProbeResult => ({
  life,
  outcome: { alias, gauge: gaugeFor({ alias }) },
  reading: ok(gaugeFor({ alias })),
});

const refused = ({ alias, life }: { alias: string; life: StoreLife }): ClaudeProbeResult => ({
  life,
  outcome: { alias, problem: "refused" },
  reading: err(ClaudeRotationErrors.credentialRejected({ alias, status: 401 })),
});

/** Deps where only the named plans answer and every other is unreachable, so nothing is ever refreshed. */
const answeringDeps = ({ healthy: answering }: { healthy: readonly string[] }): ProbeRepairDeps => ({
  nowIso: () => NOW,
  probe: async ({ alias }): Promise<ClaudeProbeResult> =>
    answering.includes(alias)
      ? healthy({ alias, life: liveLife({ alias }) })
      : {
          life: liveLife({ alias }),
          outcome: { alias, problem: "no answer" },
          reading: err(ClaudeRotationErrors.probeTransportFailed({ alias })),
        },
  readLife: ({ account }) => liveLife({ alias: account.alias }),
  refresh: () => {
    throw new Error("a transport failure must never reach a refresh command");
  },
});

/**
 * Deps where every plan is refused on its first probe. An EXPIRED one is refreshed and then answers. One with hours
 * of life left is a superseded login, refused on every probe — the `access-not-expired` skip, which no refresh and
 * no re-probe restores.
 *
 * @param expired the aliases whose token has merely expired
 * @returns the seams
 */
const refusingDeps = ({ expired }: { expired: readonly string[] }): ProbeRepairDeps => {
  const aliasOfStore = new Map<string, string>();
  const refreshed = new Set<string>();
  return {
    nowIso: () => NOW,
    probe: async ({ alias }): Promise<ClaudeProbeResult> => {
      if (refreshed.has(alias)) {
        return healthy({ alias, life: liveLife({ alias }) });
      }
      const life = expired.includes(alias) ? lifeAt({ alias, expiresAtIso: EXPIRED }) : liveLife({ alias });
      return refused({ alias, life });
    },
    readLife: ({ account }) => {
      aliasOfStore.set(account.storeDir, account.alias);
      return expired.includes(account.alias) && !refreshed.has(account.alias)
        ? lifeAt({ alias: account.alias, expiresAtIso: EXPIRED })
        : liveLife({ alias: account.alias });
    },
    refresh: ({ storeDir }) => {
      refreshed.add(aliasOfStore.get(storeDir)!);
      return undefined;
    },
  };
};

describe("readSpawnGauges — the readable gauges the spawn gate decides from", () => {
  it("keeps only the plans that answered, in configured order", async () => {
    const gauges = await readSpawnGauges({
      accounts: ACCOUNTS,
      deps: answeringDeps({ healthy: ["plan-three", "plan-one"] }),
      home: HOME,
      probesPort: memoryClaudePlanProbesPort(),
    });

    expect(gauges.map((gauge) => gauge.alias)).toStrictEqual(["plan-one", "plan-three"]);
  });

  it("answers no gauge at all when every plan is unreachable", async () => {
    const gauges = await readSpawnGauges({
      accounts: ACCOUNTS,
      deps: answeringDeps({ healthy: [] }),
      home: HOME,
      probesPort: memoryClaudePlanProbesPort(),
    });

    expect(gauges).toStrictEqual([]);
  });

  it("probes nothing, answers nothing and records nothing for no plans", async () => {
    const probesPort = memoryClaudePlanProbesPort();
    const gauges = await readSpawnGauges({
      accounts: [],
      deps: answeringDeps({ healthy: ["plan-one"] }),
      home: HOME,
      probesPort,
    });

    expect(gauges).toStrictEqual([]);
    expect(unwrap(await probesPort.read({ home: HOME }))).toStrictEqual([]);
  });
});

describe("readSpawnGauges files each plan's EFFECTIVE probe for the owner's sign-in note", () => {
  it("records a repaired plan as ok, never the refusal its first probe met", async () => {
    const one = storeOnDisk({ alias: "plan-one" });
    const probesPort = memoryClaudePlanProbesPort();
    const gauges = await readSpawnGauges({
      accounts: [one],
      deps: refusingDeps({ expired: ["plan-one"] }),
      home: HOME,
      probesPort,
    });

    const records = unwrap(await probesPort.read({ home: HOME }));
    expect(gauges.map((gauge) => gauge.alias)).toStrictEqual(["plan-one"]);
    expect(records.map((record) => [record.alias, record.latest, record.fault])).toStrictEqual([
      ["plan-one", "ok", undefined],
    ]);
  });

  it("records a token refused with hours of life left as the sign-in fault it is", async () => {
    const one = storeOnDisk({ alias: "plan-one" });
    const probesPort = memoryClaudePlanProbesPort();
    await readSpawnGauges({ accounts: [one], deps: refusingDeps({ expired: [] }), home: HOME, probesPort });

    const records = unwrap(await probesPort.read({ home: HOME }));
    expect(records.map((record) => [record.alias, record.storeDir, record.latest])).toStrictEqual([
      ["plan-one", one.storeDir, "fault"],
    ]);
    expect(records[0]!.fault!.code).toBe("CREDENTIAL_REJECTED");
  });

  it("records nothing of a paused plan, even when one is handed in", async () => {
    const one = storeOnDisk({ alias: "plan-one" });
    const paused: ClaudeAccount = {
      ...storeOnDisk({ alias: "plan-two" }),
      paused: { reason: "the subscription lapsed", sinceIso: "2026-10-01T00:00:00.000Z" },
    };
    const probesPort = memoryClaudePlanProbesPort();
    await readSpawnGauges({
      accounts: [one, paused],
      deps: answeringDeps({ healthy: ["plan-one", "plan-two"] }),
      home: HOME,
      probesPort,
    });

    const records = unwrap(await probesPort.read({ home: HOME }));
    expect(records.map((record) => record.alias)).toStrictEqual(["plan-one"]);
  });

  it("routes on the same gauges when the register cannot be written", async () => {
    const gauges = await readSpawnGauges({
      accounts: ACCOUNTS,
      deps: answeringDeps({ healthy: ["plan-two"] }),
      home: HOME,
      probesPort: unavailableClaudePlanProbesPort(),
    });

    expect(gauges.map((gauge) => gauge.alias)).toStrictEqual(["plan-two"]);
  });

  it("routes on the same gauges when the register's port rejects outright", async () => {
    const rejecting: ClaudePlanProbesPort = {
      read: async () => ok([]),
      record: () => Promise.reject(new Error("store crashed")),
    };
    const gauges = await readSpawnGauges({
      accounts: ACCOUNTS,
      deps: answeringDeps({ healthy: ["plan-two"] }),
      home: HOME,
      probesPort: rejecting,
    });

    expect(gauges.map((gauge) => gauge.alias)).toStrictEqual(["plan-two"]);
  });
});
