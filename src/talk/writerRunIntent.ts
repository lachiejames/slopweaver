/**
 * A writer's intent held for its WHOLE run, not only its wait for a lock. A writer that has been
 * handed its words — a transcript batch the page posted, a landing a session asked for — reads, resolves and masks
 * before it ever reaches a lock, and a fence checking for waiting appends in that interval would see none and bind
 * words the run is about to cut or re-place. So each such run announces at its start, before any read, and withdraws
 * only once its last write is done; `./callWriteIntent.ts`'s drained holds wait for it as for any waiting append. The
 * transcript route announces earlier still, before it spawns the verb (`site/lib/writerIntent.ts`).
 *
 * A transcript run announces on the call AND the landing ledger, since it lands cards after it appends — and a
 * landing it writes may be for another call's words (its sweep), which only the ledger's drain sees. The LEDGER's is
 * published first and withdrawn last, by this verb and by the route, and every fence waits on the ledger last
 * (`./callFence.ts`): two intents published one after the other leave a moment with only the first up, and a fence
 * checking the ledger last can never pass through it.
 *
 * A batch is ADMITTED once the route's intent is published; one parsed but not yet announced is, like one still in
 * flight over HTTP, not yet admitted. The route's intent is a HANDOFF: it counts while the
 * route runs and, once the route is gone, for `HANDOFF_MS` — the route's own bound on the verb — and the verb, once
 * its own intents are published, writes nothing unless the handoff is still open. So from publication to the run's
 * last write some intent a fence counts is always there: a server killed between spawning the verb and the verb's
 * own announcement leaves the handoff counting until the verb either shows itself or can no longer write.
 */
import { chmodSync } from "node:fs";
import { join } from "node:path";

import { err, ok, type Result } from "../lib/result.js";
import { ensureDirectory } from "../lib/writeAtomic.js";

import { isCallId } from "./callId.js";
import { callsDir } from "./callStore.js";
import { announceCallWrite, handoffOpen } from "./callWriteIntent.js";
import { announceCardLanding } from "./cardLandingStore.js";
import { type TalkError, TalkErrors } from "./errors.js";
import { processStartOf } from "./relayLease.js";

/**
 * Announce a `talk transcript` run on its call and on the landing ledger, before it reads anything.
 *
 * @param callId the call the batch is for, refused when it is not a call id, so no intent is written outside the calls
 * @param home the Slopweaver home the run writes
 * @param handoff the route's handoff intent the run was spawned under (`--handoff`), absent on a hand run
 * @param now the clock the handoff's age is judged by
 * @returns what withdraws both intents, run once the run's last write is done, or why they could not be written —
 *   `HANDOFF_LAPSED` when the route's handoff was gone or stale once this run was visible
 */
export function announceTranscriptRun({
  callId,
  home,
  handoff,
  now = Date.now,
}: {
  callId: string;
  home: string;
  handoff: string | undefined;
  now?: () => number;
}): Result<() => void, TalkError> {
  if (!isCallId({ callId })) {
    return err(TalkErrors.callInvalid({ callId }));
  }
  // The ledger's intent is published first and withdrawn last, so a fence whose last wait is the ledger's sees this
  // run at every instant one of its intents is up.
  const ledger = announceCardLanding({ home });
  if (ledger.isErr()) {
    return err(TalkErrors.pathUnreadable({ cause: ledger.error.message, path: ledger.error.path }));
  }
  const dir = callsDir({ home });
  const path = join(dir, `${callId}.jsonl`);
  let withdrawCall: () => void;
  try {
    ensureDirectory({ directory: dir });
    chmodSync(dir, 0o700);
    withdrawCall = announceCallWrite({ path, pid: process.pid, start: processStartOf({ pid: process.pid }).start });
  } catch (cause) {
    ledger.value();
    return err(TalkErrors.pathUnreadable({ cause, path }));
  }
  const withdraw = (): void => {
    try {
      withdrawCall();
    } finally {
      ledger.value();
    }
  };
  // Judged only now this run is visible itself, so there is no instant a fence could pass both unseen.
  if (handoff !== undefined && !handoffOpen({ intent: handoff, now })) {
    withdraw();
    return err(TalkErrors.handoffLapsed({ intent: handoff }));
  }
  return ok(withdraw);
}
