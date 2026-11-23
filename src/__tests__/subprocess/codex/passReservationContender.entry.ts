/**
 * One contender for a Codex pass reservation (`passReservationRace.test.ts`, `passReservationExpiry.test.ts`): spins
 * until a shared start instant, routes one pass through the REAL file-backed port against one usage-limited store,
 * and records `<pid> <reserved|refused|unlimited>` to its own outcome file. Not a test file: it is the process those
 * tests spawn under `tsx`.
 *
 * It never releases what it reserved — a pass whose process ended without its `finally` is exactly the case expiry
 * exists for, and a race winner holding its row is what the loser has to see. The spin absorbs `tsx` start-up skew
 * and nothing else, as in the operation-lock contender.
 */
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";

import { makePassBound } from "../../../codex/bounds.js";
import { codexPassFleetRead, fileCodexPassReservationPort } from "../../../codex/passReservationStore.js";
import { unwrap } from "../../../lib/result.js";
import { realWaitClock } from "../../../wait/loop.js";
import { memoryCodexFleetCapPort } from "../../codexFleetCapFixture.js";
import { liveReaderFrom } from "../../codexLiveFake.js";
import { signedInLive } from "../../codexPassReservationFixture.js";
import { memoryCodexSignInPort } from "../../codexSignInFixture.js";
import { memoryPlanRegisterPort } from "../../planRegisterFixture.js";

const [home, outcomeFile, startAtMs, storeDir, nowIso, weeklyPercent] = process.argv.slice(2);
if (
  home === undefined ||
  outcomeFile === undefined ||
  startAtMs === undefined ||
  storeDir === undefined ||
  nowIso === undefined ||
  weeklyPercent === undefined
) {
  throw new Error(
    "usage: passReservationContender <home> <outcomeFile> <startAtMs> <storeDir> <nowIso> <weeklyPercent>",
  );
}
const at: string = nowIso;

const port = fileCodexPassReservationPort({
  seams: {
    emit: () => {},
    lockWaitSeconds: 30,
    newId: () => randomUUID(),
    nowIso: () => at,
    pid: process.pid,
    readFleet: codexPassFleetRead({
      fleetCap: memoryCodexFleetCapPort(),
      port: memoryPlanRegisterPort(),
      readLive: liveReaderFrom({
        byHome: {
          [storeDir]: signedInLive({
            accountId: "acct-one",
            codexHome: storeDir,
            nowIso: at,
            weeklyPercent: Number(weeklyPercent),
          }),
        },
      }),
      signInPort: memoryCodexSignInPort(),
    }),
    waitClock: realWaitClock(),
  },
});

while (Date.now() < Number(startAtMs)) {
  // A clock barrier: whatever of the tsx start-up skew happened before this instant is absorbed here.
}

const route = unwrap(await port.acquire({ bound: unwrap(makePassBound({ boundSeconds: 600 })), home }));
let outcome = "refused";
if (route.kind === "routed") {
  outcome = route.reservation === undefined ? "unlimited" : "reserved";
}
writeFileSync(outcomeFile, `${String(process.pid)} ${outcome}\n`);
