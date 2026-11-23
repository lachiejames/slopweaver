/**
 * Durable I/O for the witnessed-thread snapshot (`$SLOPWEAVER_HOME/live/slack/witness-state.json`), and the
 * one stateful object the listener holds it through — `./witnessState.ts` stays pure.
 *
 * The snapshot survives a reconnect AND a restart: a thread Helpbot was tagged in yesterday is still read
 * today by a listener that was not running when the tag landed. Three read outcomes, never collapsed: missing
 * (a fresh install — nothing witnessed yet), unreadable, and malformed. The last two refuse listen start
 * rather than quietly forgetting every witnessed thread.
 */

import { readFileSync } from "node:fs";
import { z } from "zod";
import { parseJson } from "#lib/jsonParse.js";
import { isRecord } from "#lib/parsers.js";
import { err, ok, type Result } from "#lib/result.js";
import { writeFileAtomic } from "#lib/writeAtomic.js";
import { stateHomePaths } from "../../stateHome.js";
import { type WitnessStateError, WitnessStateErrors } from "./witnessErrors.js";
import {
  emptyWitnessState,
  observeWitnessMessage,
  pruneWitnessState,
  type WitnessObservation,
  type WitnessState,
  type WitnessVerdict,
} from "./witnessState.js";

// Both watches are optional fields so a snapshot written before the own watch existed (every row carrying
// `witnessUserId`) parses unchanged; a row carrying NEITHER watches nothing and is refused as malformed.
const witnessThreadSchema = z
  .strictObject({
    channel: z.string().min(1),
    dayCounts: z.record(z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.number().int().nonnegative()),
    lastObservedTs: z.string().min(1),
    ownTaggedTs: z.string().min(1).optional(),
    threadTs: z.string().min(1),
    witnessUserId: z.string().min(1).optional(),
  })
  .refine((thread) => thread.witnessUserId !== undefined || thread.ownTaggedTs !== undefined, {
    message: "a witnessed thread names a peer bot (witnessUserId) or this bot's own tag (ownTaggedTs)",
  });

const witnessStateSchema = z.strictObject({
  threads: z.record(z.string(), witnessThreadSchema),
  version: z.literal(1),
});

/**
 * Decode a snapshot's bytes. Pure.
 *
 * @param path where the bytes came from, for the error
 * @param text the file's contents
 * @returns the snapshot, or why it is malformed
 */
export function parseWitnessState({
  path,
  text,
}: {
  path: string;
  text: string;
}): Result<WitnessState, WitnessStateError> {
  const decoded = parseJson({ text });
  if (decoded.isErr()) {
    return err(WitnessStateErrors.malformed({ path, why: "not JSON" }));
  }
  const parsed = witnessStateSchema.safeParse(decoded.value);
  if (!parsed.success) {
    return err(
      WitnessStateErrors.malformed({ path, why: parsed.error.issues.map((issue) => issue.message).join("; ") }),
    );
  }
  return ok(parsed.data);
}

/**
 * Read the snapshot. A missing file is the empty snapshot; anything else that is not a valid one refuses.
 *
 * @param home the Slopweaver home
 * @returns the snapshot, or why it could not be trusted
 */
export function readWitnessState({ home }: { home: string }): Result<WitnessState, WitnessStateError> {
  const path = stateHomePaths({ home }).live.slack.witnessStateJson;
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if (isRecord(error) && error["code"] === "ENOENT") {
      return ok(emptyWitnessState());
    }
    return err(WitnessStateErrors.unreadable({ cause: error, path }));
  }
  return parseWitnessState({ path, text });
}

/**
 * Write the snapshot atomically.
 *
 * @param home the Slopweaver home
 * @param state the snapshot to persist
 * @returns nothing on success, or the write failure
 */
export function writeWitnessState({
  home,
  state,
}: {
  home: string;
  state: WitnessState;
}): Result<void, WitnessStateError> {
  const path = stateHomePaths({ home }).live.slack.witnessStateJson;
  try {
    writeFileAtomic({ contents: `${JSON.stringify(state, null, 2)}\n`, path });
  } catch (error: unknown) {
    return err(WitnessStateErrors.writeFailed({ cause: error, path }));
  }
  return ok(undefined);
}

/** The listener's handle on the snapshot: judge one message, persisting what changed before answering. */
export interface WitnessGate {
  observe(args: { observation: WitnessObservation; handOff: boolean }): Result<WitnessVerdict, WitnessStateError>;
}

/**
 * A gate over an initial snapshot, a clock and a save edge — the whole gate, with its two effects injected so
 * a test drives it in memory.
 *
 * Persist-then-answer: a verdict is returned only after its snapshot saved, and a failed save leaves the
 * in-memory snapshot where the disk is, so what this process believes and what a restart reads never part.
 *
 * @param initial the snapshot to start from
 * @param now the clock, epoch ms
 * @param save persists a changed snapshot
 * @returns the gate
 */
export function witnessGateOver({
  initial,
  now,
  save,
}: {
  initial: WitnessState;
  now: () => number;
  save: (args: { state: WitnessState }) => Result<void, WitnessStateError>;
}): WitnessGate {
  let current = initial;
  return {
    observe: ({ handOff, observation }) => {
      const nowMs = now();
      const step = observeWitnessMessage({ handOff, nowMs, observation, state: current });
      if (step.verdict.kind === "inactive") {
        return ok(step.verdict);
      }
      const next = pruneWitnessState({ nowMs, state: step.state });
      const saved = save({ state: next });
      if (saved.isErr()) {
        return err(saved.error);
      }
      current = next;
      return ok(step.verdict);
    },
  };
}

/**
 * Open the live gate: read the snapshot (refusing a corrupt one), on the wall clock, saving to the home.
 *
 * @param home the Slopweaver home
 * @returns the gate, or why the snapshot could not be trusted
 */
export function openWitnessGate({ home }: { home: string }): Result<WitnessGate, WitnessStateError> {
  return readWitnessState({ home }).map((initial) =>
    witnessGateOver({ initial, now: () => Date.now(), save: ({ state }) => writeWitnessState({ home, state }) }),
  );
}
