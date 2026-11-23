/**
 * Is this Claude Code session a bot turn right now, and for whose ask? The state read behind the bot-turn
 * live-write guard (`./botLiveWriteGuardRunner.ts`).
 *
 * ## What it reads, and why those two files
 *
 * The same pair `../cli/commands/github/answerFirstGate.ts` reads, for the same reason: the ask-lifecycle log
 * says which asks still hold an unsuperseded dispatch and WHO asked each one, and the per-ask worker-session
 * record (`../live/turn/workerSessionStore.ts#currentGenerationWorkerSession`) says which visible session is
 * holding it — generation-bound by `leaseExpiresAt`, so a record an earlier dispatch of the same ask left
 * behind never matches this one. The hook payload's own `session_id` is the key.
 *
 * ## The blind spot, stated rather than discovered
 *
 * A worker announces itself from `turn resume` and `turn status`. An INLINE turn — the loop answering in its
 * own session — writes no record, and neither does a worker that ran neither verb, so both read as not a bot
 * turn here. The alternative key, the worker's `cwd`, would match every session in the dispatcher's own
 * checkout (`answerFirstGate.ts` measured why). A tripwire that misses is `AGENTS.md` rule 3's shape: a block
 * confirms you were wrong; its absence means nothing.
 *
 * ## Absent is no bot turn; there but unreadable is NOT
 *
 * A state file that does not exist is a fresh home or an ask with no worker, and folds to not a bot turn. One
 * that exists and cannot be read answers `unreadable`, which the guard HOLDS on: read as empty, a log chmod-ed
 * out of reach turned a colleague's live bot turn into no bot turn and let its migration through. A torn log LINE is the same case one level down — it may be the very dispatch — and holds only
 * a session some worker record names, so an old torn line never reaches the owner's own sessions. Holding costs little, because it is asked only after a command already classified as a
 * live write. A file DELETED or rewritten by a process on this machine still reads as no bot turn — that is
 * tampering, not drift, and this guard is a tripwire against an honest mistake, never a fence against it.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { isRecord } from "#lib/parsers.js";
import { isAbsentError } from "#lib/presentFile.js";

import { askIdentityOf } from "../live/ask/identity.js";
import { foldAskLifecycle, parseAskLifecycleLog } from "../live/ask/lifecycle.js";
import { askLifecyclePath } from "../live/ask/store.js";
import { dispatchRecordPath } from "../live/turn/dispatchStore.js";
import { currentGenerationWorkerSession, workerSessionPath } from "../live/turn/workerSessionStore.js";
import { stateHomePaths } from "../stateHome.js";

/** One ask this session is the dispatched worker for. */
export interface BotTurnAsk {
  readonly channel: string;
  readonly messageTs: string;
  /** The Slack user who asked — the one fact that decides whether the owner's explicit ask can open the hatch. */
  readonly askerUserId: string;
  /** What was asked, when the capture recorded it. */
  readonly text: string | undefined;
}

/**
 * Whether the session is a bot turn. A list rather than one ask, because one visible session can hold more
 * than one live dispatch, and the hatch opens only when EVERY one of them is the owner's.
 */
export type BotTurnAskMatch =
  | { readonly kind: "not-bot-turn" }
  | { readonly kind: "unreadable"; readonly what: string }
  | { readonly kind: "bot-turn"; readonly asks: readonly [BotTurnAsk, ...BotTurnAsk[]] };

/** A state file's text: `""` when it is genuinely absent, `undefined` when it is there and cannot be read. */
function stateText({ path }: { path: string }): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    return isAbsentError({ error, path }) ? "" : undefined;
  }
}

/** Whether one worker record names this session — or cannot be read or parsed, which counts as naming it. */
function recordNames({ path, sessionId }: { path: string; sessionId: string }): boolean {
  const text = stateText({ path });
  if (text === undefined) return true;
  try {
    const raw: unknown = JSON.parse(text);
    return !isRecord(raw) || raw["sessionId"] === sessionId;
  } catch {
    return true;
  }
}

/**
 * Whether ANY worker record names this session, current or not. Asked only when the ask log has a line that
 * will not parse: the line may be the very dispatch that makes this session a bot turn, so a session some
 * worker record names holds, while one no record names — the owner's own, a fleet seat — never meets an old torn line.
 */
function namedAsWorker({ home, sessionId }: { home: string; sessionId: string }): boolean {
  const dir = stateHomePaths({ home }).live.slack.workerSessions;
  let names: readonly string[];
  try {
    names = readdirSync(dir);
  } catch (error) {
    return !isAbsentError({ error, path: dir });
  }
  return names.some((name) => recordNames({ path: join(dir, name), sessionId }));
}

/**
 * The asks this session is the dispatched, announced worker for.
 *
 * @param home the resolved state home holding the ask lifecycle log
 * @param sessionId the PreToolUse payload's `session_id`
 * @returns every matched ask, `not-bot-turn`, or the first state file (or log line) that is there but unreadable
 */
export function botTurnAskForSession({ home, sessionId }: { home: string; sessionId: string }): BotTurnAskMatch {
  const logPath = askLifecyclePath({ home });
  const text = stateText({ path: logPath });
  if (text === undefined) return { kind: "unreadable", what: logPath };
  const parsed = parseAskLifecycleLog({ text });
  if (parsed.unreadable.length > 0 && namedAsWorker({ home, sessionId })) {
    return { kind: "unreadable", what: `${logPath} line ${parsed.unreadable.join(", ")}` };
  }
  const asks: BotTurnAsk[] = [];
  for (const entry of foldAskLifecycle({ events: parsed.events }).values()) {
    if (entry.activeDispatch === undefined) continue;
    const askIdentity = askIdentityOf({ source: entry });
    const paths = [workerSessionPath({ askIdentity, home }), dispatchRecordPath({ askIdentity, home })];
    const blocked = paths.find((path) => stateText({ path }) === undefined);
    if (blocked !== undefined) return { kind: "unreadable", what: blocked };
    const worker = currentGenerationWorkerSession({ askIdentity, home });
    if (worker?.sessionId !== sessionId) continue;
    asks.push({ askerUserId: entry.userId, channel: entry.channel, messageTs: entry.messageTs, text: entry.text });
  }
  const [first, ...rest] = asks;
  return first === undefined ? { kind: "not-bot-turn" } : { asks: [first, ...rest], kind: "bot-turn" };
}
