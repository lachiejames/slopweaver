/**
 * The local read behind `resync-signed-out`: every still-defined resync row's remembered state, the hand register's history
 * of this monitor's own cards, and whether the Chrome pin shim is written. Nothing here opens a browser or writes a
 * file — the pin is written by every browser leg's attach (`../browser/profilePin.ts`), and a pass only asks
 * whether it is there.
 */
import { existsSync } from "node:fs";

import { readSignInProbes } from "../browser/signInProbeStore.js";
import { type HandRow, isSettledRow } from "../hand/row.js";
import { handRegisterPath, readHandRows } from "../hand/store.js";
import { err, ok, type Result } from "../lib/result.js";
import { readActiveResyncStates } from "../live/resync/activeState.js";
import { stateHomePaths } from "../stateHome.js";

import { MONITOR_STEP_PREFIX, monitorDefinition, occurrenceBase } from "./registry.js";
import { evaluateResyncSignedOut, type SignInCardHistory } from "./resyncSignedOut.js";
import type { MonitorReading } from "./types.js";

/**
 * Fold the hand register's rows into each `resync-signed-out` key's card history.
 *
 * @param rows every row the register holds, in the order written
 * @param prefix the step-id opening this monitor's cards carry, `mon-signin-`
 * @returns each key's history
 */
export function signInCardHistory({
  rows,
  prefix,
}: {
  rows: readonly HandRow[];
  prefix: string;
}): ReadonlyMap<string, SignInCardHistory> {
  const open = new Set<string>();
  const settled = new Map<string, string>();
  for (const row of rows) {
    const id = isSettledRow(row) ? row.id : row.step.id;
    if (!id.startsWith(prefix)) {
      continue;
    }
    const key = occurrenceBase({ id }).slice(prefix.length);
    if (!isSettledRow(row)) {
      open.add(id);
      if (row.settles !== undefined) {
        open.delete(row.settles.id);
        recordSettled({ iso: row.settles.settledIso, key, settled });
      }
      continue;
    }
    open.delete(id);
    recordSettled({ iso: row.settledIso, key, settled });
  }
  const openKeys = new Set([...open].map((id) => occurrenceBase({ id }).slice(prefix.length)));
  const keys = new Set([...openKeys, ...settled.keys()]);
  return new Map([...keys].map((key) => [key, { lastSettledIso: settled.get(key), open: openKeys.has(key) }] as const));
}

/** Keep the latest settling instant seen for one key. */
function recordSettled({ iso, key, settled }: { iso: string; key: string; settled: Map<string, string> }): void {
  const seen = settled.get(key);
  if (seen === undefined || iso > seen) {
    settled.set(key, iso);
  }
}

/**
 * Every `resync-signed-out` card's history, read off the hand register.
 *
 * @param home the Slopweaver home holding the hand register
 * @returns each subject key's card history, or why the register did not read
 */
export function readSignInCards({ home }: { home: string }): Result<ReadonlyMap<string, SignInCardHistory>, string> {
  const register = readHandRows({ missing: "empty", path: handRegisterPath({ home }) });
  if (register.isErr()) {
    return err(`the hand register could not be read: ${register.error.message}`);
  }
  const prefix = `${MONITOR_STEP_PREFIX}${monitorDefinition({ monitorId: "resync-signed-out" }).prefix}-`;
  return ok(signInCardHistory({ prefix, rows: register.value.rows }));
}

/**
 * Read and evaluate `resync-signed-out`.
 *
 * @param home the Slopweaver home holding the resync state, the hand register, the pin and the sign-in looks
 * @returns the reading, unmeasurable when the hand register itself will not read
 */
export function readResyncSignedOut({ home }: { home: string }): MonitorReading {
  const paths = stateHomePaths({ home });
  // Only rows that still exist: a retired row's last wall is never met again, so it is not the owner's to clear.
  const { states, corrupt, definitionProblem } = readActiveResyncStates({
    definitionsDir: paths.live.recipe.definitionsDir,
    stateDir: paths.live.recipe.resyncStateDir,
  });
  const cards = readSignInCards({ home });
  if (cards.isErr()) {
    // Without the card history a held card would be re-posted over the owner's Done, so the pass answers nothing.
    return { because: cards.error, monitorId: "resync-signed-out", state: "unmeasurable" };
  }
  // An unreadable look ledger holds every Datadog or GitHub wall as unlooked — the fleet's to press — and says so,
  // rather than reading as a look that reached the owner's hands.
  const probes = readSignInProbes({ home });
  const blind: string[] = [];
  if (corrupt.length > 0) {
    blind.push(
      `${String(corrupt.length)} resync record(s) could not be read: ${corrupt.map((problem) => problem.message).join("; ")}`,
    );
  }
  if (definitionProblem !== null) {
    blind.push(`${definitionProblem}, so a retired row's wall may still be carried`);
  }
  if (probes.isErr()) {
    blind.push(`the sign-in looks could not be read, so every Datadog or GitHub wall is held: ${probes.error.message}`);
  }
  const blindSpot = blind.length === 0 ? undefined : blind.join("; ");
  return evaluateResyncSignedOut({
    blindSpot,
    cards: cards.value,
    nowIso: new Date().toISOString(),
    pinPath: existsSync(paths.chromePin) ? paths.chromePin : undefined,
    probes: probes.isOk() ? probes.value : [],
    states: [...states.values()],
  });
}
