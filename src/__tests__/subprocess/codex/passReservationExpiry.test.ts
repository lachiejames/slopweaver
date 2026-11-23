/**
 * A pass whose process ended without releasing holds its point until the row's own expiry, and not one millisecond
 * longer — proved with a real process that reserves and exits.
 *
 * A dead PID is deliberately NOT a release (`codex/passReservation.ts` § Expiry is the only recovery): the row's pid
 * is diagnostic, and a pass whose parent died may still be spending. So the witness is a child that reserves the
 * account's last point under a ten-minute bound and exits, and two later reads judged either side of
 * `acquiredAt + bound + 15 minutes`. Re-run with
 * `yarn vitest run --config config/vitest/subprocess.ts src/__tests__/subprocess/codex/passReservationExpiry.test.ts`.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { makePassBound } from "../../../codex/bounds.js";
import { readCodexPassReservations } from "../../../codex/passReservationDocument.js";
import { unwrap } from "../../../lib/result.js";
import { stateHomePaths } from "../../../stateHome.js";
import {
  RESERVATION_NOW,
  reservationHome,
  signedInLive,
  testReservationPort,
} from "../../codexPassReservationFixture.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const TSX = join(repoRoot, "node_modules", ".bin", "tsx");
const CONTENDER = join(repoRoot, "src", "__tests__", "subprocess", "codex", "passReservationContender.entry.ts");

/** `RESERVATION_NOW` + the ten-minute bound + the fifteen-minute margin. */
const EXPIRES = "2026-11-05T06:25:00.000Z";
const JUST_BEFORE = "2026-11-05T06:24:59.999Z";

const BOUND = unwrap(makePassBound({ boundSeconds: 600 }));

const roots: string[] = [];

afterEach(() => {
  roots.splice(0).forEach((root) => {
    rmSync(root, { force: true, recursive: true });
  });
});

/** Where a later pass, judged at `nowIso` with the week still reading 49%, goes. */
async function laterPass({
  home,
  nowIso,
  storeDir,
}: {
  home: string;
  nowIso: string;
  storeDir: string;
}): Promise<string> {
  const byHome = {
    [storeDir]: signedInLive({ accountId: "acct-one", codexHome: storeDir, nowIso, weeklyPercent: 49 }),
  };
  const route = unwrap(
    await testReservationPort({ byHome, ids: ["res-later"], nowIso: () => nowIso }).acquire({ bound: BOUND, home }),
  );
  return route.kind;
}

describe("a reservation whose process exited without releasing", () => {
  it("holds the account's last point until its expiry instant, then gives it to the next pass", async () => {
    const { home, root, storeOf } = reservationHome({ rows: [{ alias: "plan-one", usageLimitPercent: 50 }] });
    roots.push(root);
    const storeDir = storeOf["plan-one"]!;
    const outcomeFile = join(mkdtempSync(join(tmpdir(), "codex-reserve-out-")), "outcome.txt");
    roots.push(dirname(outcomeFile));

    const child = spawnSync(TSX, [CONTENDER, home, outcomeFile, "0", storeDir, RESERVATION_NOW, "49"], {
      encoding: "utf8",
    });
    expect(child.status).toBe(0);
    const [pid, outcome] = readFileSync(outcomeFile, "utf8").trim().split(" ");
    expect(outcome).toBe("reserved");

    const path = stateHomePaths({ home }).live.codexPassReservationsJson;
    const standing = unwrap(readCodexPassReservations({ path })).reservations;
    expect(standing.map((row) => [row.pid, row.expiresAtIso])).toEqual([[Number(pid), EXPIRES]]);

    expect(await laterPass({ home, nowIso: JUST_BEFORE, storeDir })).toBe("refused");
    expect(await laterPass({ home, nowIso: EXPIRES, storeDir })).toBe("routed");
    expect(unwrap(readCodexPassReservations({ path })).reservations.map((row) => row.id)).toEqual(["res-later"]);
  });
});
