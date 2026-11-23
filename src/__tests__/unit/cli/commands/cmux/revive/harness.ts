/*
 * What the `cmux revive` test files share: the app's process row, the two knocks, this process's pid, the throwaway
 * homes each case journals into (removed after every case by the `afterEach` that `useFreshHomes()` registers), the
 * deps over a fake process table, knock and restart, the seeders of refused readings and seats' inside calls, the
 * journal's event kinds, and the standard request. It moved here when `revive.test.ts` was split by behaviour.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach } from "vitest";

import { ok, unwrap } from "#lib/result.js";

import type { ReviveRequest } from "../../../../../../cli/commands/cmux/revive.js";
import type { ReviveDeps } from "../../../../../../cli/commands/cmux/reviveProbe.js";
import type { PsRow } from "../../../../../../cmux/appProcess.js";
import {
  type InsideCallOutcome,
  readInsideCallEvidence,
  recordInsideCall,
} from "../../../../../../cmux/insideCalls.js";
import type { RestartEnd, SocketKnock } from "../../../../../../cmux/reviveEffects.js";
import type { FleetPort } from "../../../../../../fleet/port.js";

export const APP: PsRow = {
  command: "/Applications/cmux.app/Contents/MacOS/cmux",
  pid: 5088,
  ppid: 1,
  start: "Sat Oct 10 08:00:00 2026",
};
export const SELF = 777;
export const REFUSED: SocketKnock = { connectRefused: true, detail: "ECONNREFUSED on cmux.sock", replied: false };
export const ANSWERED: SocketKnock = { connectRefused: false, detail: "ERROR: Access denied", replied: true };

let homes: string[] = [];

/** Register the `afterEach` that removes every home minted since the last case. Call it once per test file. */
export function useFreshHomes(): void {
  afterEach(() => {
    for (const home of homes) {
      rmSync(home, { force: true, recursive: true });
    }
    homes = [];
  });
}

/**
 * A fresh home.
 *
 * @returns the new directory's path, recorded for the registered cleanup
 */
export function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "revive-"));
  homes.push(home);
  return home;
}

/**
 * Deps over one process table and one knock, at minute `MM` of a fixed hour; `restarts` collects each restart asked.
 *
 * @returns revive deps whose restart always reopens the app as pid 24622, answering
 */
export function deps({
  fleet,
  rows,
  knock,
  minute,
  restarts = [],
  insideCmuxEnv = false,
}: {
  fleet: FleetPort;
  rows: readonly PsRow[];
  knock: SocketKnock;
  minute: number;
  restarts?: number[];
  insideCmuxEnv?: boolean;
}): ReviveDeps {
  const end: RestartEnd = { detail: "quit on TERM; reopened as pid 24622", newAppPid: 24622, outcome: "answering" };
  return {
    fleet,
    insideCmuxEnv,
    knock: () => Promise.resolve(knock),
    listProcesses: () => ok(rows),
    nowIso: () => `2026-10-10T10:${String(minute).padStart(2, "0")}:00.000Z`,
    pid: SELF,
    readInsideCalls: readInsideCallEvidence,
    restart: ({ appPid }) => {
      restarts.push(appPid);
      return Promise.resolve(end);
    },
  };
}

/** Seed refused readings of an app at each `10:MM`. */
export async function seedRefused({
  fleet,
  home,
  minutes,
  app = APP,
}: {
  fleet: FleetPort;
  home: string;
  minutes: readonly number[];
  app?: PsRow;
}): Promise<void> {
  for (const minute of minutes) {
    const atIso = `2026-10-10T10:${String(minute).padStart(2, "0")}:00.000Z`;
    const reading = { appPid: app.pid, appStart: app.start, atIso, detail: "refused", state: "refused" } as const;
    unwrap(await fleet.appendCmuxReviveEvent({ event: { ...reading, kind: "reading", schemaVersion: 1 }, home }));
  }
}

/** Stamp a seat's call ending at `10:MM`. */
export function stampInside({
  home,
  minute,
  outcome,
}: {
  home: string;
  minute: number;
  outcome: InsideCallOutcome;
}): void {
  const atIso = `2026-10-10T10:${String(minute).padStart(2, "0")}:00.000Z`;
  unwrap(recordInsideCall({ atIso, home, outcome }));
}

/**
 * The journal's event kinds, in order.
 *
 * @returns each journalled event's `kind`, oldest first
 */
export async function kinds({ fleet, home }: { fleet: FleetPort; home: string }): Promise<readonly string[]> {
  return unwrap(await fleet.readCmuxReviveJournal({ home })).events.map((event) => event.kind);
}

/**
 * The request every pass in these files makes: a ten-minute bound, JSON output, into one home.
 *
 * @returns a JSON revive request over that home, a dry run only when asked
 */
export const request = ({ home, dryRun = false }: { home: string; dryRun?: boolean }): ReviveRequest => ({
  boundMs: 10 * 60_000,
  dryRun,
  home,
  json: true,
});
