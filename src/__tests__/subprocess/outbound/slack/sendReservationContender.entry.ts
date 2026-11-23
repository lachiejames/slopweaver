/**
 * One contender in the send-reservation race (`sendReservationRace.test.ts`): spins until a shared start
 * instant, then works one Slack send slot and records what it got to its own outcome file as
 * `<pid> fresh=<n> duplicate=<n> confirmed=<n>`. Not a test file: it is the process the race test spawns
 * under `tsx`.
 *
 * Three modes, one per way the slot was measured double-winning:
 *
 * - `reserve` takes the slot ONCE at the barrier, the identical-send race the gate exists for.
 * - `reserve-loop` takes it again and again until the deadline, so it reads the slot while a peer rewrites it.
 * - `confirm-loop` confirms the slot again and again until the deadline, the in-place rewrite a reader can
 *   catch empty.
 *
 * The spin absorbs `tsx` start-up skew and nothing else, exactly as in the operation-lock contender.
 */
import { writeFileSync } from "node:fs";

import { confirmSend, reserveSend } from "../../../../outbound/slack/sendReservation.js";

const [home, outcomeFile, startAtMs, mode, durationMs, duplicateKey] = process.argv.slice(2);
if (
  home === undefined ||
  outcomeFile === undefined ||
  startAtMs === undefined ||
  mode === undefined ||
  durationMs === undefined ||
  duplicateKey === undefined
) {
  throw new Error("usage: sendReservationContender <home> <outcomeFile> <startAtMs> <mode> <durationMs> <key>");
}
// Bound after the guard so the narrowing reaches the function below, which TypeScript does not carry into.
const slotHome: string = home;
const slotKey: string = duplicateKey;

while (Date.now() < Number(startAtMs)) {
  // A clock barrier: whatever of the tsx start-up skew happened before this instant is absorbed here.
}

// Measured from when THIS contender passed the barrier, not from the barrier itself: one that booted late
// still works the slot for the whole duration instead of finding its deadline already gone.
const deadline = Date.now() + Number(durationMs);
const counts = { confirmed: 0, duplicate: 0, fresh: 0 };

/** Take the slot once and count the verdict. */
function reserveOnce(): void {
  const verdict = reserveSend({
    duplicateKey: slotKey,
    home: slotHome,
    nowIso: new Date().toISOString(),
    windowHours: 24,
  });
  counts[verdict.kind] += 1;
}

if (mode === "reserve") {
  reserveOnce();
} else if (mode === "reserve-loop") {
  while (Date.now() < deadline) {
    reserveOnce();
  }
} else if (mode === "confirm-loop") {
  while (Date.now() < deadline) {
    confirmSend({ duplicateKey, home, nowIso: new Date().toISOString(), sentTs: "1785000000.000100" });
    counts.confirmed += 1;
  }
} else {
  throw new Error(`unknown mode ${mode}`);
}

writeFileSync(
  outcomeFile,
  `${String(process.pid)} fresh=${String(counts.fresh)} duplicate=${String(counts.duplicate)} confirmed=${String(counts.confirmed)}\n`,
);
