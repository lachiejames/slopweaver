/**
 * The plain fakes `liveSyncRun.test.ts` and `liveSyncRead.test.ts` share: two synthetic chat ids, a pacer that never
 * waits, a listed chat, a whole-conversation body, and a GET edge answering from a table. No I/O happens here.
 */
import { type ChatgptError, ChatgptErrors } from "../../../../../cli/commands/chatgpt/errors.js";
import type { ListedChatgptConversation } from "../../../../../cli/commands/chatgpt/listing.js";
import { err, type Result } from "../../../../../lib/result.js";
import { chatId } from "../../../../chatgptFixture.js";
import { conversation, liveBody } from "../../../corpus/chatgpt/ingest/harness.js";

/** A synthetic chat id, the newer of the two in most cases. */
export const Y = chatId({ name: "conv-y" });

/** A second synthetic chat id. */
export const Z = chatId({ name: "conv-z" });

/** A pacer that lets every request through at once. */
export const NO_PACE = { beforeRequest: (): Promise<void> => Promise.resolve() };

/** An epoch later than every listing the tests use, so a body at it is current. */
const CURRENT_UPDATE = 1794000000;

/** An epoch earlier than every listing the tests use, so a body at it is older than its listing. */
export const STALE_UPDATE = 1790100000;

/**
 * A listed chat at an update.
 *
 * @returns the active-lane listing entry
 */
export function listed({ id, updatedIso }: { id: string; updatedIso: string }): ListedChatgptConversation {
  return { createdIso: "2026-01-01T00:00:00.000Z", id, lane: "active", projectId: null, title: "Secret", updatedIso };
}

/**
 * The whole-conversation body for one named chat, current unless an older update is given.
 *
 * @param name the synthetic chat's name, which its id derives from
 * @param text the one message the chat carries
 * @param updateTime the body's own epoch update, current by default
 * @returns the body as the backend serves it
 */
export function bodyOf({
  name,
  text,
  updateTime = CURRENT_UPDATE,
}: {
  name: string;
  text: string;
  updateTime?: number;
}): string {
  return JSON.stringify(liveBody({ chat: conversation({ id: name, text, updateTime }) }));
}

/**
 * A GET edge answering from a table, recording each path asked; an unlisted path answers 404.
 *
 * @param answers each path's answer
 * @returns the paths asked, in order, and the edge
 */
export function tableFetch({ answers }: { answers: ReadonlyMap<string, Result<string, ChatgptError>> }): {
  asked: string[];
  fetchText: (args: { path: string }) => Promise<Result<string, ChatgptError>>;
} {
  const asked: string[] = [];
  return {
    asked,
    fetchText: ({ path }) => {
      asked.push(path);
      const answer = answers.get(path);
      if (answer === undefined) {
        return Promise.resolve(err(ChatgptErrors.httpRefused({ path, status: 404 })));
      }
      return Promise.resolve(answer);
    },
  };
}
