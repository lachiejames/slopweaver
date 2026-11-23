/*
 * `deleteOwnedMessage` — the ownership-checked delete both `slack delete` and a correction turn go through.
 *
 * Every transport here is a plain injected function over a recorded call log, never a mock: the property
 * under test is an ORDER as much as an outcome, because "read it back, confirm it is ours, THEN delete" is
 * the whole guarantee and a passing outcome assertion is true of code that deletes first.
 *
 * What these test files share: the target and the genuine answer standing at it, the fake transport over a call
 * log, and the throwaway homes `useFreshHomes()` removes after each case. It moved here when one test file was split
 * by behaviour.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";

import type { DeleteMessageOutcome, PostedMessage } from "../../../../../corpus/slack/writeTransport.js";
import { ASSISTANT_ANSWER_EVENT_TYPE_V2 } from "../../../../../outbound/assistant/answerMessage.js";
import type { OwnedDeleteTransport } from "../../../../../outbound/slack/deleteOwnedMessage.js";
import type { ReadSlackMessage, SlackSelfIdentity } from "../../../../../outbound/slack/lifecycleGuards.js";

/** This bot, as `auth.test` reports it. */
const SELF: SlackSelfIdentity = { botId: "B_SELF", teamId: "T1", userId: "U_SELF" };

/** The one metadata kind every case here accepts — a real assistant answer, the supersession target's shape. */
export const ACCEPTED: readonly string[] = [ASSISTANT_ANSWER_EVENT_TYPE_V2];

export const TARGET: PostedMessage = { channel: "C_THREAD", ts: "1790054484.916599" };

/** A genuine V2 assistant answer this bot posted — the only shape that reaches the door. */
export const OURS: ReadSlackMessage = {
  botId: "B_SELF",
  fileIds: [],
  metadataEventType: ASSISTANT_ANSWER_EVENT_TYPE_V2,
  renderer: "slack-assistant-answer-v2",
  ts: TARGET.ts,
  userId: "U_SELF",
};

/** Every transport call this operation made, in the order it made them. */
interface CallLog {
  readonly calls: string[];
  readonly deletes: PostedMessage[];
}

/**
 * A transport over a call log. `message` is what a read of {@link TARGET} answers; any other `ts` reads as
 * absent, which is what makes the missing-target case a real read rather than a special case.
 *
 * @returns a transport recording each call into `log`, throwing where the case asked it to
 */
export function fakeTransport({
  log,
  message,
  deleteOutcome = { kind: "gone" },
  readThrows,
  whoAmIThrows,
  deleteThrows,
}: {
  log: CallLog;
  message: ReadSlackMessage | undefined;
  deleteOutcome?: DeleteMessageOutcome;
  readThrows?: string;
  whoAmIThrows?: string;
  deleteThrows?: string;
}): OwnedDeleteTransport {
  return {
    deleteMessageOnce: async ({ posted }: { posted: PostedMessage }): Promise<DeleteMessageOutcome> => {
      log.calls.push("deleteMessageOnce");
      if (deleteThrows !== undefined) {
        throw new Error(deleteThrows);
      }
      log.deletes.push(posted);
      return deleteOutcome;
    },
    readMessage: async ({ posted }: { posted: PostedMessage }): Promise<ReadSlackMessage | undefined> => {
      log.calls.push("readMessage");
      if (readThrows !== undefined) {
        throw new Error(readThrows);
      }
      return posted.ts === message?.ts ? message : undefined;
    },
    whoAmI: async (): Promise<SlackSelfIdentity> => {
      log.calls.push("whoAmI");
      if (whoAmIThrows !== undefined) {
        throw new Error(whoAmIThrows);
      }
      return SELF;
    },
  };
}

/**
 * An empty call log for one case.
 *
 * @returns a log with no calls and no deletes recorded
 */
export function freshLog(): CallLog {
  return { calls: [], deletes: [] };
}

const fixtureDirs: string[] = [];

/** Register the `afterEach` that removes every home minted since the last case. Call it once per test file. */
export function useFreshHomes(): void {
  afterEach(() => {
    for (const dir of fixtureDirs.splice(0)) {
      rmSync(dir, { force: true, recursive: true });
    }
  });
}

/**
 * A throwaway home — `meta.home` on the door request names it; the decision itself is recorded in memory.
 *
 * @returns the new directory's path, recorded for the registered cleanup
 */
export function freshHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-owned-delete-"));
  fixtureDirs.push(dir);
  return dir;
}
