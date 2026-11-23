/* Shared fixtures for the spawnStore gate tests: a throwaway home, credential kinds, and probe-repair deps. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ClaudeAmbientCredential } from "../../../claude/ambientCredential.js";
import type { ClaudeAccount, ClaudeAccountGauge } from "../../../claude/contracts.js";
import type { StoreLife } from "../../../claude/credentialRepair.js";
import { ClaudeRotationErrors } from "../../../claude/errors.js";
import type { ClaudePlanProbesPort } from "../../../claude/planProbes.js";
import type { ProbeRepairDeps } from "../../../claude/probeRepair.js";
import type { ClaudeProbeResult } from "../../../claude/probeStore.js";
import { ACCOUNTS_PATH } from "../../../claude/spawnAccounts.js";
import { err, ok } from "../../../lib/result.js";
import { memoryClaudePlanProbesPort } from "../../claudePlanProbesFixture.js";
import { memoryPlanRegisterPort, unavailablePlanRegisterPort } from "../../planRegisterFixture.js";

/** The two stores a gate context reaches: the plan register it decides from, and the probe record it files. */
type GatePorts = { port: ReturnType<typeof memoryPlanRegisterPort>; probesPort: ClaudePlanProbesPort };

/**
 * Both of a gate context's ports, spread into the context in place of naming each. The probe record is always in
 * memory; the plan register is too, unless the case is one whose register store cannot be reached.
 *
 * @param registerUnreachable whether the plan register fails every read, as an unreachable store does
 * @returns a fresh plan register and probe record
 */
export const memoryGatePorts = ({
  registerUnreachable = false,
}: { registerUnreachable?: boolean } = {}): GatePorts => ({
  port: registerUnreachable ? unavailablePlanRegisterPort() : memoryPlanRegisterPort(),
  probesPort: memoryClaudePlanProbesPort(),
});

/** The instant every gate fixture's deps report as now, so a recorded spend reading can be made fresh against it. */
export const NOW = "2026-09-12T06:00:00.000Z";
const ALIVE = "2026-09-12T14:00:00.000Z";

/** Two configured plans with no usage limit, the default fleet of the gate tests. */
export const TWO_PLANS = JSON.stringify([
  { alias: "plan-one", storeDir: "/stores/plan-one" },
  { alias: "plan-two", storeDir: "/stores/plan-two" },
]);

let gateHome = "";

/**
 * Mint a throwaway home with an empty claude-accounts directory; {@link cleanGateHome} removes it.
 *
 * @returns the absolute path of the new home
 */
export const makeGateHome = (): string => {
  gateHome = mkdtempSync(join(tmpdir(), "spawn-gate-"));
  mkdirSync(join(gateHome, "claude-accounts"), { recursive: true });
  return gateHome;
};

/**
 * Remove the home {@link makeGateHome} last minted, if any. Wire it as the test file's `afterEach`.
 *
 * @returns nothing meaningful, only the side effect of the removal
 */
export const cleanGateHome = (): void => {
  if (gateHome !== "") {
    rmSync(gateHome, { force: true, recursive: true });
    gateHome = "";
  }
};

/**
 * Write the accounts file under a home.
 *
 * @param dir the home to write under
 * @param text the accounts file's content
 * @returns nothing meaningful, only the side effect of the write
 */
export const writeAccounts = ({ dir, text }: { dir: string; text: string }): void => {
  writeFileSync(join(dir, ACCOUNTS_PATH), text);
};

const aliasOf = ({ account }: { account: ClaudeAccount }): string => account.alias;

/** No Anthropic-issued credential configured, so a session really does spend its store's own plan login. */
export const SUBSCRIPTION: ClaudeAmbientCredential = {
  kind: "subscription",
  reason: "no Anthropic-issued credential is configured",
};

/** An API key outranks every store, so no store decides what a session spends. */
export const SHADOWED: ClaudeAmbientCredential = {
  kind: "shadowed",
  reason: "an API key outranks every credential store",
  source: "ANTHROPIC_API_KEY",
};

/** A live store reading, so nothing in these fixtures looks repairable by accident. */
const liveLife = ({ alias }: { alias: string }): StoreLife => ({
  alias,
  expiresAtIso: ALIVE,
  hasCredential: true,
  hasRefreshToken: true,
  refreshExpiresAtIso: "2026-10-11T12:00:12.000Z",
});

const allowedGauge = ({ alias }: { alias: string }): ClaudeAccountGauge => ({
  alias,
  fiveHour: { resetAtIso: ALIVE, status: "allowed", utilization: 0.2 },
  observedAtIso: NOW,
  sevenDay: { resetAtIso: ALIVE, status: "allowed", utilization: 0.3 },
});

const spentGauge = ({ alias }: { alias: string }): ClaudeAccountGauge => ({
  alias,
  fiveHour: { resetAtIso: ALIVE, status: "rejected", utilization: 1 },
  observedAtIso: NOW,
  sevenDay: { resetAtIso: ALIVE, status: "rejected", utilization: 1 },
});

/**
 * Deps whose probes never get an answer — the offline case, which must attempt no refresh.
 *
 * @returns the deps
 */
export const offlineDeps = (): ProbeRepairDeps => ({
  nowIso: () => NOW,
  probe: async ({ alias }): Promise<ClaudeProbeResult> => ({
    life: liveLife({ alias }),
    outcome: { alias, problem: "no answer" },
    reading: err(ClaudeRotationErrors.probeTransportFailed({ alias })),
  }),
  readLife: ({ account }) => liveLife({ alias: aliasOf({ account }) }),
  refresh: () => {
    throw new Error("a transport failure must never reach a refresh command");
  },
});

/**
 * Deps where exactly one named plan answers and every other is unreachable.
 *
 * @param healthy the alias of the one plan that answers
 * @returns the deps
 */
export const oneHealthyDeps = ({ healthy }: { healthy: string }): ProbeRepairDeps => ({
  nowIso: () => NOW,
  probe: async ({ alias }): Promise<ClaudeProbeResult> =>
    alias === healthy
      ? {
          life: liveLife({ alias }),
          outcome: { alias, gauge: allowedGauge({ alias }) },
          reading: ok(allowedGauge({ alias })),
        }
      : {
          life: liveLife({ alias }),
          outcome: { alias, problem: "no answer" },
          reading: err(ClaudeRotationErrors.probeTransportFailed({ alias })),
        },
  readLife: ({ account }) => liveLife({ alias: aliasOf({ account }) }),
  refresh: () => {
    throw new Error("a transport failure must never reach a refresh command");
  },
});

/**
 * Deps whose every probe answers under ONE alias no account configures — a counterexample. It is a
 * reading routing can choose and the account lookup cannot resolve, which used to come back as neither a store
 * nor a refusal.
 *
 * @returns the deps
 */
export const foreignAliasDeps = (): ProbeRepairDeps => ({
  nowIso: () => NOW,
  probe: async (): Promise<ClaudeProbeResult> => ({
    life: liveLife({ alias: "plan-elsewhere" }),
    outcome: { alias: "plan-elsewhere", gauge: allowedGauge({ alias: "plan-elsewhere" }) },
    reading: ok(allowedGauge({ alias: "plan-elsewhere" })),
  }),
  readLife: ({ account }) => liveLife({ alias: aliasOf({ account }) }),
  refresh: () => {
    throw new Error("a successfully-read gauge must never reach a refresh command");
  },
});

/**
 * Deps where every plan reads fine and every plan is spent.
 *
 * @returns the deps
 */
export const spentDeps = (): ProbeRepairDeps => ({
  nowIso: () => NOW,
  probe: async ({ alias }): Promise<ClaudeProbeResult> => ({
    life: liveLife({ alias }),
    outcome: { alias, gauge: spentGauge({ alias }) },
    reading: ok(spentGauge({ alias })),
  }),
  readLife: ({ account }) => liveLife({ alias: aliasOf({ account }) }),
  refresh: () => {
    throw new Error("a readable spent gauge must never reach a refresh command");
  },
});

/**
 * Deps that count probes, for asserting a configuration case performs no provider call at all.
 *
 * @param onProbe called once per probe
 * @returns the deps
 */
export const countingDeps = ({ onProbe }: { onProbe: () => void }): ProbeRepairDeps => ({
  nowIso: () => NOW,
  probe: async ({ alias }): Promise<ClaudeProbeResult> => {
    onProbe();
    return {
      life: liveLife({ alias }),
      outcome: { alias, gauge: allowedGauge({ alias }) },
      reading: ok(allowedGauge({ alias })),
    };
  },
  readLife: ({ account }) => liveLife({ alias: aliasOf({ account }) }),
  refresh: () => undefined,
});
