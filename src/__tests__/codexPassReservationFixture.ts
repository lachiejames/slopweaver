/**
 * Seams for a test that routes a Codex pass through the REAL reservation port (`src/codex/passReservationStore.ts`):
 * the file-backed port over an in-memory register, fleet-cap and sign-in port and a fake live reader, a stepping
 * wait clock that never really sleeps, and a wrapper that logs every acquire and release. Plain functions of the
 * port's own types — seams, never mocks (`.claude/rules/testing.md`).
 *
 * A home handed to {@link reservationHome} carries a real `plans.json` and real store directories, so the fleet read
 * imports the register exactly as an install with an empty store does.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ReadCodexAccountsLive } from "../codex/accountLive.js";
import type { CodexAccountLive } from "../codex/accountLiveParse.js";
import {
  type CodexPassReservationPort,
  type CodexPassReservationSeams,
  codexPassFleetRead,
  fileCodexPassReservationPort,
} from "../codex/passReservationStore.js";
import { ok } from "../lib/result.js";
import type { PlanRegisterPort } from "../plans/port.js";
import { stateHomePaths } from "../stateHome.js";
import type { WaitClock } from "../wait/loop.js";
import { memoryCodexFleetCapPort } from "./codexFleetCapFixture.js";
import { liveReaderFrom } from "./codexLiveFake.js";
import { memoryCodexSignInPort } from "./codexSignInFixture.js";
import { memoryPlanRegisterPort } from "./planRegisterFixture.js";

/** The instant every reservation fixture reads the fleet at unless a test names another. */
export const RESERVATION_NOW = "2026-11-05T06:00:00.000Z";

/** One registered row a {@link reservationHome} writes. */
export interface ReservationRow {
  readonly alias: string;
  readonly usageLimitPercent?: number;
  readonly paused?: boolean;
  /** Any other register fields, written onto the row as given — an allowance, a pin. */
  readonly extra?: Readonly<Record<string, unknown>>;
}

/** A home and each row's store directory, by alias. */
export interface ReservationHome {
  readonly root: string;
  readonly home: string;
  readonly storeOf: Readonly<Record<string, string>>;
}

/**
 * A throwaway root holding a state home whose register carries `rows`, each on a store directory that exists.
 *
 * @param rows the Codex rows, in register order
 * @returns the root to remove afterwards, the home, and each row's store
 */
export function reservationHome({ rows }: { rows: readonly ReservationRow[] }): ReservationHome {
  const root = mkdtempSync(join(tmpdir(), "codex-reserve-"));
  const home = join(root, "home");
  mkdirSync(home, { recursive: true });
  const storeOf: Record<string, string> = {};
  const registered = rows.map((row) => {
    const storeDir = join(root, row.alias, ".codex");
    mkdirSync(storeDir, { recursive: true });
    storeOf[row.alias] = storeDir;
    const pause = { reason: "the owner took it out of the fleet", sinceIso: "2026-11-01T00:00:00.000Z" };
    return {
      alias: row.alias,
      provider: "codex",
      storeDir,
      ...(row.usageLimitPercent === undefined ? {} : { usageLimitPercent: row.usageLimitPercent }),
      ...(row.paused === true ? { paused: pause } : {}),
      ...row.extra,
    };
  });
  writeFileSync(stateHomePaths({ home }).plansJson, JSON.stringify({ rows: registered, version: 1 }), "utf8");
  return { home, root, storeOf };
}

/**
 * A signed-in live answer whose weekly window reads `weeklyPercent`, observed at `nowIso`.
 *
 * @param codexHome the store answering
 * @param accountId the provider account id, when the answer carries one
 * @param email the signed-in address, when the answer carries one
 * @returns the live row
 */
export function signedInLive({
  accountId,
  codexHome,
  email,
  nowIso = RESERVATION_NOW,
  weeklyPercent,
}: {
  accountId?: string;
  codexHome: string;
  email?: string;
  nowIso?: string;
  weeklyPercent: number;
}): CodexAccountLive {
  const weekly = {
    label: "weekly",
    resetAtIso: "2026-11-12T06:00:00.000Z",
    slot: "primary",
    usedPercent: weeklyPercent,
    windowMinutes: 10080,
  } as const;
  return {
    accountId,
    codexHome,
    email,
    gauges: [
      {
        credits: undefined,
        limitId: "codex",
        observedAtIso: nowIso,
        planType: "pro",
        reached: undefined,
        reachedType: undefined,
        windows: [weekly],
      },
    ],
    kind: "signed-in",
    ordinaryUsageAllowed: undefined,
    planType: "pro",
    readAtIso: nowIso,
    resetCreditsAvailable: 0,
  };
}

/**
 * A wait clock whose sleep advances its own time and yields one turn of the event loop, so a contended wait lets
 * the holder finish and still reaches its deadline in no real time.
 *
 * @returns the clock
 */
function steppingWaitClock(): WaitClock {
  let nowMs = 0;
  return {
    nowMs: () => nowMs,
    sleep: ({ ms }) => {
      nowMs += ms;
      return new Promise((resolve) => {
        setImmediate(resolve);
      });
    },
  };
}

/** The live reader a case named, or one answering from `byHome` when it named none. */
function readerFor({
  byHome,
  readLive,
}: {
  byHome: Readonly<Record<string, CodexAccountLive>>;
  readLive: ReadCodexAccountsLive | undefined;
}): ReadCodexAccountsLive {
  if (readLive !== undefined) {
    return readLive;
  }
  return liveReaderFrom({ byHome });
}

/**
 * The real file-backed reservation port over in-memory ports and a fake live reader.
 *
 * @param options the {@link testReservationSeams} fields the port is built over
 * @returns the port
 */
export function testReservationPort(
  options: Parameters<typeof testReservationSeams>[0] = {},
): CodexPassReservationPort {
  return fileCodexPassReservationPort({ seams: testReservationSeams(options) });
}

/**
 * The seams {@link testReservationPort} runs the real port over, for a case that drives one step of it directly.
 *
 * @param byHome each store's live answer; any store not named reads `unreadable`
 * @param nowIso the instant every read, lock attempt and release is dated at
 * @param ids the reservation ids handed out in order, then `reservation-<n>`
 * @param lockWaitSeconds how long a contended lock is waited for
 * @param registerPort where the register is read
 * @returns the seams
 */
export function testReservationSeams({
  byHome = {},
  ids = [],
  lockWaitSeconds = 60,
  nowIso = () => RESERVATION_NOW,
  pid = 4242,
  readLive,
  registerPort = memoryPlanRegisterPort(),
}: {
  byHome?: Readonly<Record<string, CodexAccountLive>>;
  ids?: readonly string[];
  lockWaitSeconds?: number;
  nowIso?: () => string;
  pid?: number;
  readLive?: ReadCodexAccountsLive;
  registerPort?: PlanRegisterPort;
} = {}): CodexPassReservationSeams {
  let minted = 0;
  return {
    emit: () => {},
    lockWaitSeconds,
    newId: () => {
      minted += 1;
      const named = ids[minted - 1];
      if (named !== undefined) {
        return named;
      }
      return `reservation-${String(minted)}`;
    },
    nowIso,
    pid,
    readFleet: codexPassFleetRead({
      fleetCap: memoryCodexFleetCapPort(),
      port: registerPort,
      readLive: readerFor({ byHome, readLive }),
      signInPort: memoryCodexSignInPort(),
    }),
    waitClock: steppingWaitClock(),
  };
}

/**
 * A port that logs `acquire` before every acquire and `release` before every release, around a real one.
 *
 * @param inner the port that really routes
 * @param log the shared sequence
 * @returns the logging port
 */
export function loggingReservationPort({
  inner,
  log,
}: {
  inner: CodexPassReservationPort;
  log: string[];
}): CodexPassReservationPort {
  return {
    acquire: async (request) => {
      log.push("acquire");
      const route = await inner.acquire(request);
      if (route.isErr() || route.value.kind === "refused") {
        return route;
      }
      const routed = route.value;
      return ok({
        ...routed,
        release: () => {
          log.push("release");
          return routed.release();
        },
      });
    },
  };
}
