/**
 * The Slack side of the incident-read tests: a plain fake of the two reads, the clocks that keep a read inside its
 * deadline, and INC-98's root and thread. Shared by `read.test.ts` (the channel walk) and `runIncidentRead.test.ts`
 * (the walk with its lock and its store).
 */
import type { IncidentReadApi } from "../../../orgHealth/read.js";
import { announcement, update } from "./incidentIoFixtures.js";
import { NOW_MS } from "./orgIncidentFixture.js";

/**
 * A plain fake of the two Slack reads, recording what it was asked.
 *
 * @param history the channel's messages, or the error its history read fails with
 * @param threads each root `ts`'s replies; a root missing here fails its read
 * @returns the api, and the calls it recorded
 */
export function fakeApi({
  history,
  threads = {},
}: {
  history: readonly unknown[] | Error;
  threads?: Readonly<Record<string, readonly unknown[]>>;
}): { api: IncidentReadApi; historyCalls: { oldest: string; includeAllMetadata: unknown }[]; repliesAsked: string[] } {
  const historyCalls: { oldest: string; includeAllMetadata: unknown }[] = [];
  const repliesAsked: string[] = [];
  const api: IncidentReadApi = {
    history: (args) => {
      historyCalls.push({ includeAllMetadata: args.includeAllMetadata, oldest: args.oldest });
      if (history instanceof Error) {
        return Promise.reject(history);
      }
      return Promise.resolve({ hasMore: false, messages: history });
    },
    replies: (args) => {
      repliesAsked.push(args.ts);
      const messages = threads[args.ts];
      if (messages === undefined) {
        return Promise.reject(new Error(`the fake holds no thread ${args.ts}`));
      }
      return Promise.resolve({ hasMore: false, messages });
    },
  };
  return { api, historyCalls, repliesAsked };
}

/**
 * A wall clock that never moves, so no read reaches its deadline.
 *
 * @returns the fixture's fixed instant, {@link NOW_MS}
 */
export const STILL = (): number => NOW_MS;

/**
 * A timer that never fires, so no call loses its race.
 *
 * @returns a promise that never settles
 */
export const NEVER = (): Promise<void> => new Promise(() => undefined);

/** INC-98, still fixing: its root. */
export const FIXING = announcement({ editedTs: "1790138100.000000", status: "Fixing" });

/** INC-98's thread: its root, and the update that moved it to Fixing. */
export const FIXING_THREAD = [FIXING, update({ from: "Investigating", to: "Fixing", ts: "1790138037.887319" })];

/**
 * The morning INC-98 was declared, inside the live window of its declaration — {@link NOW_MS} is eleven
 * days later, when an open incident first seen is no longer news.
 */
export const DECLARATION_DAY_MS = Date.parse("2026-09-23T09:00:00.000Z");
