/**
 * `listen`'s witness wiring: resolve the witnessed bots and open the thread snapshot at START (a typed refusal
 * before Socket Mode opens), then tap every live connection so witnessed messages reach stdout and `--queue`
 * as `{"kind":"witness",…}` lines.
 *
 * `--follow` only. A one-shot or deadline listener's stdout is ONE object a caller parses, so a witness line
 * there would break the very contract it shares a stream with; the loop that judges witness lines is the
 * continuous one (`skills/loop`). Outside `--follow` the configured bots are named as inert and nothing is
 * tapped.
 *
 * Two watches share the tap: a PEER bot's threads (`witnessBotHandles`) and this bot's OWN — a thread a person
 * tagged it in, which needs no configuration and is live whenever this bot's user id is known.
 */
import { err, ok, type Result } from "#lib/result.js";
import { logger } from "../../../lib/logger.js";
import { parseMentionEvent } from "../../../live/listen/mention.js";
import { appendQueueLine } from "../../../live/listen/queueFile.js";
import type { ListenLog } from "../../../live/listen/socket.js";
import type { WitnessHandler } from "../../../live/listen/witness.js";
import type { WitnessIdentityError, WitnessStateError } from "../../../live/listen/witnessErrors.js";
import { loadResolvedWitnessBots, type ResolvedWitnessBot } from "../../../live/listen/witnessIdentity.js";
import { openWitnessGate, type WitnessGate } from "../../../live/listen/witnessStateStore.js";
import { createWitnessTap, type WitnessTapPolicy, witnessingConnection } from "../../../live/listen/witnessTap.js";
import { readWitnessJournal } from "../../../live/witness/journalStore.js";
import { threadStandDown } from "../../../live/witness/standDown.js";
import type { Profile } from "../../../profile.js";
import type { ListenDeps } from "./loop.js";

/** What a witnessing listener starts with: who it witnesses, and the durable thread snapshot. */
export interface WitnessSetup {
  readonly bots: readonly ResolvedWitnessBot[];
  readonly gate: WitnessGate;
  /** Whether a thread stood the bot down, read fresh off the witness journal each time it is asked. */
  readonly stoodDown: WitnessTapPolicy["stoodDown"];
}

/**
 * The tap's stand-down read over one home's witness journal.
 *
 * @param home the Slopweaver home
 * @returns the predicate, answering the journal's read error as text
 */
export function journalStoodDown({ home }: { home: string }): WitnessTapPolicy["stoodDown"] {
  return ({ channel, threadTs }) =>
    readWitnessJournal({ home })
      .map((events) => threadStandDown({ channel, events, threadTs }) !== undefined)
      .mapErr((error) => error.message);
}

/** The configured peer bots, resolved — none when no handle is configured. */
function resolvedPeers({
  home,
  profile,
}: {
  home: string;
  profile: Profile | null;
}): Result<readonly ResolvedWitnessBot[], WitnessIdentityError> {
  const handles = profile?.slackBot?.witnessBotHandles;
  if (handles === undefined || handles.length === 0) {
    return ok([]);
  }
  return loadResolvedWitnessBots({ handles, home });
}

/**
 * Resolve `slackBot.witnessBotHandles` and open the thread snapshot.
 *
 * The snapshot opens even with no peer configured: the bot's OWN watch — a thread a person tagged it in, where
 * it may later help unprompted — needs no handle. A corrupt snapshot refuses the start only when a PEER is
 * configured, the watch the operator asked for; with none it is warned and the own watch alone goes inert, so
 * an optional watch never stops the address path a tag needs.
 *
 * @param home the Slopweaver home
 * @param profile the parsed profile, or `null` when there is none
 * @param warn where an own watch gone inert is said, loudly
 * @returns the setup (its peer list possibly empty), `undefined` when the own watch went inert, or why the
 *   listener cannot start
 */
export function loadWitnessSetup({
  home,
  profile,
  warn,
}: {
  home: string;
  profile: Profile | null;
  warn: (args: { line: string }) => void;
}): Result<WitnessSetup | undefined, WitnessIdentityError | WitnessStateError> {
  const bots = resolvedPeers({ home, profile });
  if (bots.isErr()) {
    return err(bots.error);
  }
  const gate = openWitnessGate({ home });
  if (gate.isErr()) {
    if (bots.value.length > 0) {
      return err(gate.error);
    }
    warn({
      line: `witness: own watch OFF — ${gate.error.message}; tags are still answered, unprompted help waits until the snapshot is repaired`,
    });
    return ok(undefined);
  }
  return ok({ bots: bots.value, gate: gate.value, stoodDown: journalStoodDown({ home }) });
}

/** What the run says it witnesses: the peers by handle, and the own watch when this bot's id is known. */
function witnessedNames({
  bots,
  selfUserId,
}: {
  bots: readonly ResolvedWitnessBot[];
  selfUserId: string | undefined;
}): string {
  const peers = bots.map((bot) => `every thread tagging @${bot.handle} (${bot.userId})`);
  const own = selfUserId === undefined ? [] : [`every thread a person tagged this bot (${selfUserId}) in`];
  return [...peers, ...own].join(", ");
}

/**
 * The live witness handler: one JSONL line on stdout, and the same line in the `--queue` file when there is
 * one — the queue first, so a crash between the two never loses the durable copy.
 *
 * @param queuePath the durability file, when `--queue` was given
 * @param appendLine the queue-file append edge
 * @param sink where the stdout line goes
 * @returns the handler
 */
export function witnessEmitter({
  appendLine,
  queuePath,
  sink,
}: {
  appendLine: (args: { path: string; line: string }) => void;
  queuePath: string | undefined;
  sink: (args: { line: string }) => void;
}): WitnessHandler {
  return async (line) => {
    const json = JSON.stringify(line);
    if (queuePath !== undefined) {
      appendLine({ line: json, path: queuePath });
    }
    sink({ line: json });
    await Promise.resolve();
  };
}

/**
 * Tap the listener's connections for witnessing, when a setup exists and the listener follows.
 *
 * @param deps the assembled live seams
 * @param follow whether the listener stays connected (`--follow`)
 * @param progressLog where the narration goes
 * @param queuePath the durability file, when `--queue` was given
 * @param witness the setup, or `undefined` when it was never read (a one-shot listener)
 * @returns the seams, every opened connection tapped — or unchanged when there is nothing to witness
 */
export function withWitnessTap({
  deps,
  follow,
  progressLog,
  queuePath,
  witness,
}: {
  deps: ListenDeps;
  follow: boolean;
  progressLog: ListenLog;
  queuePath: string | undefined;
  witness: WitnessSetup | undefined;
}): ListenDeps {
  const { scope, selfBotId, selfUserId, threadReplyChannels } = deps;
  if (witness === undefined || (witness.bots.length === 0 && selfUserId === undefined)) {
    return deps;
  }
  const named = witnessedNames({ bots: witness.bots, selfUserId });
  if (!follow) {
    progressLog({ line: `witness: ${named} — inert, witnessing runs under --follow only` });
    return deps;
  }
  progressLog({
    line: `witness: ${named} — witnessed silently, each message there becomes a {"kind":"witness"} line; nothing is posted from here`,
  });
  const tap = createWitnessTap({
    policy: {
      gate: witness.gate,
      handler: witnessEmitter({
        appendLine: appendQueueLine,
        queuePath,
        sink: ({ line }) => {
          logger.out({ line });
        },
      }),
      isAddress: ({ event }) =>
        parseMentionEvent({ enabledChannels: threadReplyChannels, event, selfBotId, selfUserId }).isOk(),
      log: progressLog,
      scope,
      selfBotId,
      selfUserId,
      stoodDown: witness.stoodDown,
      witnessUserIds: witness.bots.map((bot) => bot.userId),
    },
  });
  return {
    ...deps,
    openConnection: async (args) => {
      const connection = await deps.openConnection(args);
      return connection === undefined ? undefined : witnessingConnection({ connection, tap });
    },
  };
}
