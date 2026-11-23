/**
 * Record what one sweep of Claude probes found, so `claude-plan-unusable` can float a fault the pass it is seen
 * (`./planProbeRecord.ts` says why the record exists). Shared by everything that probes the fleet: `claude gauge`, the
 * `claude watch` keep-alive, and the pre-spawn routing gate (`./spawnGauges.ts`), which every spawn and `claude route`
 * pass through.
 *
 * A failure to record is a DIAGNOSTIC, never the verb's failure: the gauge's reading, the keep-alive's touch and the
 * spawn gate's route are still right without it, and the next sweep records again — a port that throws included. The monitor reads a plan with no record as unmeasured,
 * never as well.
 */
import { existsSync } from "node:fs";

import { errorMessage } from "#lib/errorMessage.js";
import type { Result } from "#lib/result.js";

import type { ClaudeRotationError } from "./errors.js";
import { observationOfReading } from "./planProbeRecord.js";
import type { ClaudePlanProbesPort } from "./planProbes.js";

/** One plan's probe as a sweep produced it. */
export interface SweptPlanProbe {
  readonly alias: string;
  readonly storeDir: string;
  readonly reading: Result<unknown, ClaudeRotationError>;
}

/**
 * The probes of one sweep that may be recorded: a named probe of a PAUSED plan still prints, but files nothing, since
 * the owner's pause is what keeps that plan off the card and a probe taken during it must not fire on resume.
 *
 * @param accounts every configured plan, paused ones carrying their pause
 * @param probes what the sweep probed, in any order
 * @returns the probes of plans that are configured and not paused, in the sweep's order
 */
export function recordableProbes({
  accounts,
  probes,
}: {
  accounts: readonly { readonly alias: string; readonly paused?: unknown }[];
  probes: readonly SweptPlanProbe[];
}): readonly SweptPlanProbe[] {
  const unpaused = new Set(accounts.filter((account) => account.paused === undefined).map((account) => account.alias));
  return probes.filter((probe) => unpaused.has(probe.alias));
}

/**
 * Record every probe of one sweep.
 *
 * @param home the Slopweaver home whose store keeps the record
 * @param nowIso when the sweep ran — every probe of it is recorded at that instant
 * @param port where the record is kept
 * @param probes each probed plan, its store and its typed reading
 * @param storeExists whether a store directory is on disk — the machine's own check unless a test passes one
 * @returns one diagnostic line per thing that went wrong; none when every probe was recorded
 */
export async function recordPlanProbes({
  home,
  nowIso,
  port,
  probes,
  storeExists = existsSync,
}: {
  home: string;
  nowIso: string;
  port: ClaudePlanProbesPort;
  probes: readonly SweptPlanProbe[];
  storeExists?: (path: string) => boolean;
}): Promise<readonly string[]> {
  if (probes.length === 0) {
    return [];
  }
  const notRecorded = "the plans' probes were not recorded, so no plan-fault note can follow this sweep";
  // The production port answers every failure as a Result and never rejects (`./planProbes.ts`), but this is the
  // last step of three verbs that are right without it, so a port that does throw — an injected one, or a defect —
  // is still a diagnostic here rather than a spawn, a gauge or a keep-alive tick that falls over.
  let recorded: Awaited<ReturnType<ClaudePlanProbesPort["record"]>>;
  try {
    recorded = await port.record({
      home,
      observed: probes.map((probe) => ({
        alias: probe.alias,
        observation: observationOfReading({ reading: probe.reading, storeExists: storeExists(probe.storeDir) }),
        observedAtIso: nowIso,
        storeDir: probe.storeDir,
      })),
    });
  } catch (cause) {
    return [`${notRecorded}: the record call threw (${errorMessage({ error: cause })})`];
  }
  if (recorded.isErr()) {
    return [`${notRecorded}: ${recorded.error.message}`];
  }
  return recorded.value.kept.map((why) => `a probe was not recorded: ${why}`);
}
