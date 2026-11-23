/**
 * The local read behind `claude-plan-unusable`: the plan register's unpaused Claude rows, what each one's last probe
 * recorded (`../claude/planProbes.ts`), and which of this monitor's cards the owner closed themselves. Nothing here probes — a
 * pass stays a local read, and the probe runs in `claude gauge`, `claude watch` and the pre-spawn routing gate, which
 * record what they found.
 */
import { err, ok, type Result } from "#lib/result.js";

import type { ClaudePlanProbesPort } from "../claude/planProbes.js";
import { handRegisterPath, readHandRows } from "../hand/store.js";
import { planRegisterReadError } from "../plans/errors.js";
import type { PlanRegisterPort } from "../plans/port.js";
import { plansForProvider } from "../plans/register.js";

import { evaluateClaudePlanUnusable, evaluateClaudeRegisterFault } from "./claudePlanUnusable.js";
import { closedByOwner, passSettleOpenings } from "./heldKeys.js";
import { MONITOR_STEP_PREFIX, monitorDefinition } from "./registry.js";
import { signInCardHistory } from "./resyncSignedOutSource.js";
import type { MonitorReading } from "./types.js";

/** This monitor's cards off one hand-register read: the keys the owner closed themselves, and the keys still open. */
function readCardHistory({
  home,
}: {
  home: string;
}): Result<{ readonly closedByOwner: ReadonlyMap<string, string>; readonly openKeys: ReadonlySet<string> }, string> {
  const register = readHandRows({ missing: "empty", path: handRegisterPath({ home }) });
  if (register.isErr()) {
    return err(`the hand register could not be read: ${register.error.message}`);
  }
  const definition = monitorDefinition({ monitorId: "claude-plan-unusable" });
  const prefix = `${MONITOR_STEP_PREFIX}${definition.prefix}-`;
  const { rows } = register.value;
  const history = signInCardHistory({ prefix, rows });
  return ok({
    closedByOwner: closedByOwner({ passOpenings: passSettleOpenings({ definition }), prefix, rows }),
    openKeys: new Set([...history].flatMap(([key, card]) => (card.open ? [key] : []))),
  });
}

/**
 * Read and evaluate `claude-plan-unusable`.
 *
 * @param home the Slopweaver home whose store holds the register and the probes, and whose hand register the owner's Done
 * @param port where the plan register is read; a register that does not read, an outage included, fires one card
 *   about the register itself, never clear
 * @param probesPort where each plan's last probe is read; an outage is unmeasurable too
 * @returns the reading
 */
export async function readClaudePlanUnusable({
  home,
  port,
  probesPort,
}: {
  home: string;
  port: PlanRegisterPort;
  probesPort: ClaudePlanProbesPort;
}): Promise<MonitorReading> {
  const unmeasurable = ({ because }: { because: string }): MonitorReading => ({
    because,
    monitorId: "claude-plan-unusable",
    state: "unmeasurable",
  });
  const register = await port.read({ home });
  if (register.isErr()) {
    // A register that does not read is itself the card: every spawn refuses on it, so the owner hears it this pass.
    const readError = planRegisterReadError({ error: register.error });
    if (readError === undefined) {
      return unmeasurable({ because: `the plan register could not be read: ${register.error.message}` });
    }
    return evaluateClaudeRegisterFault({ error: readError });
  }
  const records = await probesPort.read({ home });
  if (records.isErr()) {
    return unmeasurable({ because: `the Claude plan probes could not be read: ${records.error.message}` });
  }
  // Without the owner's Done history a card they closed would be posted again over it, so the pass answers nothing.
  const cards = readCardHistory({ home });
  if (cards.isErr()) {
    return unmeasurable({ because: cards.error });
  }
  const byAlias = new Map(records.value.map((record) => [record.alias, record] as const));
  // A paused plan is the owner's decision to take it out: it is not read, and an open card on it settles.
  const plans = plansForProvider({ plans: register.value.plans, provider: "claude" }).filter(
    (plan) => plan.paused === undefined,
  );
  return evaluateClaudePlanUnusable({
    closedByOwner: cards.value.closedByOwner,
    openKeys: cards.value.openKeys,
    plans: plans.map((plan) => ({
      alias: plan.alias,
      email: plan.email,
      record: byAlias.get(plan.alias),
      storeDir: plan.storeDir,
    })),
  });
}
