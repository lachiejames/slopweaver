/**
 * The ask-lifecycle log's effectful edge: append one event, read the log back.
 *
 * Thin on purpose — every decision lives in `./lifecycle.ts`, which is pure and testable by calling it
 * directly. What is here is the filesystem, and it is fsync'd per line the same way
 * `../listen/queueFile.ts`'s durability path is: the whole point of this log is surviving a crash between
 * "Slack accepted the answer" and "the local event was appended", and a write the OS still holds in its page
 * cache is exactly what a crash loses.
 */
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

import { appendLines } from "../../lib/appendSeparator.js";
import { stateHomePaths } from "../../stateHome.js";
import type { AskIdentity } from "./identity.js";
import {
  type AppendableAskLifecycleEvent,
  type AskLifecycle,
  askLifecycleEventLine,
  askLifecycleKey,
  foldAskLifecycle,
  parseAskLifecycleLog,
} from "./lifecycle.js";

/**
 * The ask-lifecycle log's absolute path.
 *
 * @param home the state home (defaults to the resolved home)
 * @returns the path to `live/slack/asks.jsonl`
 */
export function askLifecyclePath({ home }: { home?: string } = {}): string {
  return stateHomePaths(home === undefined ? {} : { home }).live.slack.asksJsonl;
}

/**
 * Append one event to the ask-lifecycle log, creating the directory if needed, fsync'd so the write survives
 * a crash immediately rather than whatever the OS still had buffered.
 *
 * Separated through `appendLines`: if the file already has content that does NOT end in a newline — a
 * hand-authored fixture missing its trailing `\n`, or a prior write truncated mid-line — appending straight on
 * would concatenate this event onto the end of that line, producing ONE invalid line `parseAskLifecycleLog`
 * must reject whole. That corrupts not just the new event but the PRIOR one too, and the next
 * `ensureCaptured…` call would then see neither and append yet again.
 *
 * @param event the event to append
 * @param home the state home (defaults to the resolved home)
 */
export function appendAskLifecycleEvent({ event, home }: { event: AppendableAskLifecycleEvent; home?: string }): void {
  const path = askLifecyclePath(home === undefined ? {} : { home });
  mkdirSync(dirname(path), { recursive: true });
  appendLines({ durable: true, path, text: `${askLifecycleEventLine({ event })}\n` });
}

/**
 * Read the ask-lifecycle log's raw text. An absent log — a home that has never captured an ask — is the
 * empty string, not an error.
 *
 * @param home the state home (defaults to the resolved home)
 * @returns the log contents, or `""` when there is no log yet
 */
export function readAskLifecycleText({ home }: { home?: string } = {}): string {
  try {
    return readFileSync(askLifecyclePath(home === undefined ? {} : { home }), "utf8");
  } catch {
    return "";
  }
}

/**
 * Ensure this exact ask has a `captured` event on the log, WITHOUT ever appending a second one for an ask
 * some earlier entrance already captured — the live listener's own `withCapturedLifecycle`, or a prior
 * `turn brief`/`turn dispatch` call for the same ask.
 *
 * Every entrance that could legitimately be the FIRST thing to see a given ask calls this before appending
 * anything else for it — a hand-driven `turn brief` never goes through the listener's wrapper at all, and a
 * brief a caller wrote by some other means never goes through `turn brief` either. Without an entry to open,
 * `foldAskLifecycle` silently IGNORES every later event for that key (see its own header for why that is the
 * fold's whole value, not a gap) — so a `dispatched`/`triaged-no-response` event appended for an ask nothing
 * ever captured would vanish from the fold entirely, breaking any later lease lookup or sweep for it.
 *
 * `text` is passed EXPLICITLY rather than read off a wider object the caller happens to hold. Before this
 * parameter existed, every live caller passed a whole `Mention` as `askIdentity`, so the mention's own
 * `text` reached the appended row as an untyped extra property — present on 196 of this home's 216
 * `captured` rows, and readable by nobody, because `capturedFromValue` never parsed a field the type did
 * not declare. Naming it here is what makes the field a contract instead of a spread's side effect.
 *
 * @param askIdentity the exact ask
 * @param surface which surface addressed the bot
 * @param text what was asked, when the caller has it — a hand-built brief entrance may not
 * @param userId who asked
 * @param home the state home (defaults to the resolved home)
 */
export function ensureCapturedAskLifecycle({
  askIdentity,
  surface,
  text,
  userId,
  home,
}: {
  askIdentity: AskIdentity;
  surface: "channel" | "dm";
  text?: string | undefined;
  userId: string;
  home?: string;
}): void {
  const folded = foldAskLifecycle({
    events: parseAskLifecycleLog({ text: readAskLifecycleText(home === undefined ? {} : { home }) }).events,
  });
  if (folded.has(askLifecycleKey({ askIdentity }))) {
    return;
  }
  appendAskLifecycleEvent({
    event: {
      channel: askIdentity.channel,
      kind: "captured",
      messageTs: askIdentity.messageTs,
      surface,
      threadTs: askIdentity.threadTs,
      tsIso: new Date().toISOString(),
      userId,
      ...(text === undefined ? {} : { text }),
    },
    ...(home === undefined ? {} : { home }),
  });
}

/**
 * Recover the capture-time checklist's `{turnId, workingTs}` for one ask, when the driving session never
 * passed `--turn-id`/`--working-ts` to `turn brief` itself. Reads and folds the whole log — this is a
 * best-effort recovery path called at most once per brief, never a hot loop.
 *
 * @param askIdentity the exact ask to look up
 * @param home the state home (defaults to the resolved home)
 * @returns the started ref, or `undefined` when no `checklist-posted` event was ever folded in for this ask
 */
export function startedRefForAsk({
  askIdentity,
  home,
}: {
  askIdentity: AskIdentity;
  home?: string;
}): { readonly turnId: string; readonly workingTs: string } | undefined {
  const folded = foldAskLifecycle({
    events: parseAskLifecycleLog({ text: readAskLifecycleText(home === undefined ? {} : { home }) }).events,
  });
  return folded.get(askLifecycleKey({ askIdentity }))?.started;
}

/**
 * One ask, as the lifecycle fold currently has it — the store read behind every verb that acts on an ask
 * some EARLIER turn captured.
 *
 * Lives here rather than beside its first caller because it is owned by neither of them: `turn ignore`
 * needs it to know whether an indicator was ever raised, and `turn settle-reaction` needs it to refuse a
 * message the bot never touched. A verb that skipped this read and settled on `--channel`/`--message-ts`
 * alone could stamp a lifecycle reaction onto any message in the workspace, which is a signal invented
 * rather than corrected.
 *
 * @param channel the ask's channel
 * @param home the resolved state home
 * @param messageTs the addressing message's own ts
 * @returns the folded entry, or `undefined` when the listener never captured this ask
 */
export function capturedAskFor({
  channel,
  home,
  messageTs,
}: {
  channel: string;
  home: string;
  messageTs: string;
}): AskLifecycle | undefined {
  const { events } = parseAskLifecycleLog({ text: readAskLifecycleText({ home }) });
  return foldAskLifecycle({ events }).get(JSON.stringify([channel, messageTs]));
}
