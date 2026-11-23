/**
 * The local read behind `codex-plan-signed-out`: the plan register's Codex rows, each store's directory and
 * `auth.json` SHAPE (never a value, `../codex/auth.ts`) and stamp, and the observation the fleet's live read filed in
 * the store (`../codex/signInRecordStore.ts`). Nothing here talks to the provider — a pass stays a local read, and
 * the live batch that can see a revoked sign-in runs inside the routing read instead.
 */
import { existsSync } from "node:fs";

import { type CodexAuthReport, readCodexAuth } from "../codex/auth.js";
import { readCodexAuthStamp } from "../codex/signInAuthStamp.js";
import type { CodexSignInAliasRead, CodexSignInPort } from "../codex/signInPort.js";
import type { CodexAuthStamp } from "../codex/signInRecord.js";
import type { PlanRegisterPort } from "../plans/port.js";
import { plansForProvider } from "../plans/register.js";
import type { RegisteredPlan } from "../plans/types.js";

import { type CodexStoreInput, evaluateCodexPlanSignedOut } from "./evaluate.js";
import type { MonitorReading } from "./types.js";

/**
 * Classify a store's `auth.json` by shape: no file, unparseable, parseable with no sign-in, or signed in.
 *
 * @returns the classification
 */
function codexAuthFile({
  auth,
  authStamp,
}: {
  auth: CodexAuthReport;
  authStamp: CodexAuthStamp;
}): CodexStoreInput["authFile"] {
  if (authStamp.kind === "absent") {
    return "absent";
  }
  if (!auth.readable) {
    return "unreadable";
  }
  if (auth.hasTokens || auth.hasApiKey) {
    return "signed-in";
  }
  return "no-sign-in";
}

/**
 * Project one registered Codex store onto what `codex-plan-signed-out` turns on.
 *
 * @param filed what the store holds for the plan's alias
 * @param plan the register row
 * @returns the projected store
 */
function codexStoreInput({ filed, plan }: { filed: CodexSignInAliasRead; plan: RegisteredPlan }): CodexStoreInput {
  const codexHome = plan.storeDir;
  const authStamp = readCodexAuthStamp({ codexHome });
  return {
    alias: plan.alias,
    authFile: codexAuthFile({ auth: readCodexAuth({ codexHome }), authStamp }),
    authStamp,
    codexHome,
    email: plan.email,
    pausedReason: plan.paused?.reason,
    record: filed.kind === "record" ? filed.record : undefined,
    recordUnreadable: filed.kind === "refused" ? filed.error.message : undefined,
    storeExists: existsSync(codexHome),
  };
}

/**
 * Read and evaluate `codex-plan-signed-out` over every registered Codex store.
 *
 * @param home the Slopweaver home whose store holds the register and the observations
 * @param port where the plan register is read; a store outage makes the reading unmeasurable, never clear
 * @param signInPort where the observations are read, every alias over one connection; an outage is unmeasurable too
 * @returns the reading, unmeasurable when the register or the observations will not read
 */
export async function readCodexPlanSignedOut({
  home,
  port,
  signInPort,
}: {
  home: string;
  port: PlanRegisterPort;
  signInPort: CodexSignInPort;
}): Promise<MonitorReading> {
  const register = await port.read({ home });
  if (register.isErr()) {
    return {
      because: `the plan register could not be read: ${register.error.message}`,
      monitorId: "codex-plan-signed-out",
      state: "unmeasurable",
    };
  }
  const plans = plansForProvider({ plans: register.value.plans, provider: "codex" });
  const filed = await signInPort.read({ aliases: plans.map((plan) => plan.alias), home });
  if (filed.isErr()) {
    return {
      because: `the Codex sign-in observations could not be read: ${filed.error.message}`,
      monitorId: "codex-plan-signed-out",
      state: "unmeasurable",
    };
  }
  return evaluateCodexPlanSignedOut({
    stores: plans.map((plan, index) => codexStoreInput({ filed: filed.value[index]!, plan })),
  });
}
