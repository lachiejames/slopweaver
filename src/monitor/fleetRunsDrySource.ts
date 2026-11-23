/**
 * The effectful half of `fleet-runs-dry`: read the newest `machine capacity` reading the supervisor tick filed,
 * decode its ceilings strictly, read the plan register, judge the two together, and project the judgement onto
 * the monitor.
 *
 * Both reads are local — the readings ledger, bounded at the judged instant on both its recorded and its observed
 * side, and the register through its port — so a pass spends no probe and opens no provider connection. The
 * register keeps no history, so `--now` replays the filed reading exactly against the register as it stands.
 *
 * The register is judged as this pass READ it. A plan committed after that read is indistinguishable from one
 * committed after the verdict returns — a second read would only move the window, never close it — so it is the
 * next hourly pass's to see, which reads it unmeasurable until a filed reading measures it.
 */
import { parseStrictIsoInstantMs } from "#lib/date.js";
import { isRecord } from "#lib/parsers.js";

import type { CeilingsReading } from "../capacity/ceilings.js";
import { ceilingsReadingSchema } from "../capacity/ceilingsSchema.js";
import type { PlanRegisterPort } from "../plans/port.js";
import { lastReading } from "../readings/store.js";

import { fleetRunsDryReading, MIN_DRY_HOURS } from "./fleetRunsDry.js";
import { assessFleetDry, FLEET_DRY_MAX_AGE_MS } from "./fleetRunsDryCeilings.js";
import type { MonitorReading } from "./types.js";

/** The producer `supervisor tick-capture` files `machine capacity --json` under. */
export const CAPACITY_PRODUCER = "machine capacity";

/** An `unmeasurable` reading of this monitor, saying why. */
function unmeasurable({ because }: { because: string }): MonitorReading {
  return { because, monitorId: "fleet-runs-dry", state: "unmeasurable" };
}

/**
 * The newest filed reading's ceilings, decoded — the one read both dry monitors judge from.
 *
 * @param home the state home the readings ledger lives under
 * @param nowIso the instant the ledger is read as of, on both its recorded and its observed side
 * @param machineHold `refuse` where a held machine is itself a reason no seat starts (`fleet-runs-dry`); `read` where
 *   only the plans' windows matter, which are measured whatever the machine's load (`host-week-runs-out`)
 * @returns the ceilings, or why there are none to judge: no reading, no ceilings, a held or unsaid machine where
 *   refused, an undecodable document, or ceilings claiming an instant after their own ledger row
 */
export function filedCeilings({
  home,
  machineHold,
  nowIso,
}: {
  home: string;
  machineHold: "refuse" | "read";
  nowIso: string;
}): CeilingsReading | { because: string } {
  const filed = lastReading({ asOfIso: nowIso, home, observedByIso: nowIso, producer: CAPACITY_PRODUCER });
  if (filed.isErr()) {
    return { because: `no machine capacity reading could be read: ${filed.error.message}` };
  }
  const { document, record } = filed.value;
  if (!isRecord(document) || !("ceilings" in document)) {
    return { because: "the newest machine capacity reading carries no plans' ceilings" };
  }
  // The document's own hold is the machine's verdict, and both `--json` shapes carry it; the ceiling inside is
  // derived from it, so a document whose two disagree, or that carries no hold, proves no open machine.
  if (machineHold === "refuse" && document["hold"] !== false) {
    return {
      because: `the newest machine capacity reading does not say the machine is unheld: its hold is ${JSON.stringify(document["hold"])}`,
    };
  }
  const parsed = ceilingsReadingSchema.safeParse(document["ceilings"]);
  if (!parsed.success) {
    return {
      because: `the newest machine capacity reading's ceilings did not decode: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`,
    };
  }
  // The tick files a reading AFTER `machine capacity` measured it, so its ceilings are observed at or before the
  // ledger row. One claiming a later instant contradicts its own row, and freshness is judged on the nested instant
  // alone — so a stale row cannot pass as fresh through what its document says.
  const nestedMs = parseStrictIsoInstantMs({ text: parsed.data.observedAtIso });
  const rowMs = parseStrictIsoInstantMs({ text: record.observedAtIso });
  if (nestedMs !== undefined && rowMs !== undefined && nestedMs > rowMs) {
    return {
      because: `the newest machine capacity reading's ceilings claim ${parsed.data.observedAtIso}, after its ledger row was observed at ${record.observedAtIso}`,
    };
  }
  return parsed.data;
}

/**
 * Read and evaluate `fleet-runs-dry`.
 *
 * @param home the state home the readings ledger and the plan register live under
 * @param nowIso the instant to judge at — `--now` replays a past pass exactly
 * @param port where the plan register is read, so a plan configured since the reading is never read as spent
 * @returns the reading; a missing, undecodable or stale document, one whose ceilings postdate its own ledger row,
 *   or an unread register, is `unmeasurable`
 */
export async function readFleetRunsDry({
  home,
  nowIso,
  port,
}: {
  home: string;
  nowIso: string;
  port: PlanRegisterPort;
}): Promise<MonitorReading> {
  const reading = filedCeilings({ home, machineHold: "refuse", nowIso });
  if ("because" in reading) {
    return unmeasurable({ because: reading.because });
  }
  const register = await port.read({ home });
  if (register.isErr()) {
    return unmeasurable({ because: `the plan register could not be read: ${register.error.message}` });
  }
  const { claude, codex } = register.value.thresholds;
  const assessment = assessFleetDry({
    maxAgeMs: FLEET_DRY_MAX_AGE_MS,
    minDryHours: MIN_DRY_HOURS,
    nowIso,
    reading,
    registered: register.value.plans,
    // Claude's bars are fractions; a week's spend-out bar opens before its own reset, so it can still admit the week.
    routingBars: {
      claudeFiveHour: claude.routeAt * 100,
      claudeWeek: Math.max(claude.routeAt, claude.spendOutAt) * 100,
      codex: codex.pauseAtPercent,
    },
  });
  return fleetRunsDryReading({ assessment, reading });
}
