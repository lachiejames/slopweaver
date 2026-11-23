/**
 * The local read behind `turn-signed-out`: the ask-lifecycle log's waiting blocks, the hand register's history of
 * this monitor's own cards, the sign-in looks, and whether the Chrome pin shim is written. Nothing here opens a
 * browser or writes a file.
 */
import { existsSync } from "node:fs";

import { readSignInProbes } from "../browser/signInProbeStore.js";
import { readJsonlLines } from "../corpus/corpusStore.js";
import { handRegisterPath, readHandRows } from "../hand/store.js";
import { err, ok, type Result } from "../lib/result.js";
import { type AskLifecycleEvent, foldAskLifecycle, parseAskLifecycleLog } from "../live/ask/lifecycle.js";
import { askLifecyclePath } from "../live/ask/store.js";
import { blockedAsks } from "../live/turn/blockedOnHuman.js";
import { stateHomePaths } from "../stateHome.js";

import { MONITOR_STEP_PREFIX, monitorDefinition } from "./registry.js";
import { signInCardHistory } from "./resyncSignedOutSource.js";
import { blockBearingUnreadable, evaluateTurnSignedOut } from "./turnSignedOut.js";
import type { MonitorReading } from "./types.js";

/**
 * The ask-lifecycle log's events, streamed a line at a time, and the 1-based line numbers of every unreadable line
 * that could have been a block or its lift: nothing when no ask was ever captured, or why it would not read. Not
 * `readAskLifecycleText`, which reads every failure as an empty log — here that would read clear and settle a card
 * whose turn is still blocked.
 */
function readLifecycle({
  home,
}: {
  home: string;
}): Result<{ readonly events: readonly AskLifecycleEvent[]; readonly hidden: readonly number[] }, string> {
  const events: AskLifecycleEvent[] = [];
  const hidden: number[] = [];
  try {
    readJsonlLines({
      onLine: ({ line, index }) => {
        const parsed = parseAskLifecycleLog({ text: line });
        events.push(...parsed.events);
        if (blockBearingUnreadable({ text: line, unreadable: parsed.unreadable }).length > 0) {
          hidden.push(index + 1);
        }
      },
      path: askLifecyclePath({ home }),
    });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return ok({ events: [], hidden: [] });
    }
    return err(`the ask-lifecycle log could not be read: ${String(error)}`);
  }
  return ok({ events, hidden });
}

/**
 * Read and evaluate `turn-signed-out`.
 *
 * @param home the Slopweaver home holding the ask log, the hand register, the pin and the sign-in looks
 * @returns the reading, unmeasurable when the ask log or the hand register will not read
 */
export function readTurnSignedOut({ home }: { home: string }): MonitorReading {
  const lifecycle = readLifecycle({ home });
  if (lifecycle.isErr()) {
    return { because: lifecycle.error, monitorId: "turn-signed-out", state: "unmeasurable" };
  }
  const register = readHandRows({ missing: "empty", path: handRegisterPath({ home }) });
  if (register.isErr()) {
    // Without the card history a held card would be re-posted over the owner's Done, so the pass answers nothing.
    return {
      because: `the hand register could not be read: ${register.error.message}`,
      monitorId: "turn-signed-out",
      state: "unmeasurable",
    };
  }
  const prefix = `${MONITOR_STEP_PREFIX}${monitorDefinition({ monitorId: "turn-signed-out" }).prefix}-`;
  const probes = readSignInProbes({ home });
  const blind: string[] = [];
  const hidden = lifecycle.value.hidden;
  if (hidden.length > 0) {
    blind.push(
      `${String(hidden.length)} ask-lifecycle line(s) could not be read (lines ${hidden.join(", ")}), so a blocked turn may be missing`,
    );
  }
  if (register.value.unparsed.length > 0) {
    // A skipped line may be the owner's Done on one of these cards, so a block it covers could be carded over their answer.
    blind.push(
      `${String(register.value.unparsed.length)} hand-register line(s) did not read, so your Done on a card may be missing: ${register.value.unparsed.map((problem) => problem.message).join("; ")}`,
    );
  }
  if (probes.isErr()) {
    blind.push(`the sign-in looks could not be read, so every Datadog or GitHub wall is held: ${probes.error.message}`);
  }
  const chromePin = stateHomePaths({ home }).chromePin;
  return evaluateTurnSignedOut({
    asks: blockedAsks({ folded: foldAskLifecycle({ events: lifecycle.value.events }) }),
    blindSpot: blind.length === 0 ? undefined : blind.join("; "),
    cards: signInCardHistory({ prefix, rows: register.value.rows }),
    nowIso: new Date().toISOString(),
    pinPath: existsSync(chromePin) ? chromePin : undefined,
    probes: probes.isOk() ? probes.value : [],
  });
}
