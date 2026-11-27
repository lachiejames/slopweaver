/*
 * The typed twin's fake child, clock and notification lines, shared by the files that test it. The child is a plain
 * fake port that answers requests from a script; nothing is mocked.
 */
import { expect } from "vitest";

import { isRecord } from "../../lib/desktopShellWire";
import { MeetingLedger } from "../../lib/meetingLedger";
import type { PlanCallEvent, SequencedEvent } from "../../lib/planCallContract";
import { TalkNoticeLedger } from "../../lib/talkNoticeLedger";
import type { PlanComposition } from "../../lib/talkPlanProtocol";
import { TypedPlanSession } from "../../lib/talkTypedSession";
import { fakeClock, COMPOSITION as PLAN_CALL_COMPOSITION } from "./talkPlanCall/harness";

export const COMPOSITION: PlanComposition = { ...PLAN_CALL_COMPOSITION, tools: ["slack_thread_after"] };

/** How the child answers each method. */
export type Script = Record<string, (input: { id: number }) => string | undefined>;

/** Let every queued answer land. */
export async function settle(): Promise<void> {
  for (let i = 0; i < 10; i += 1) {
    await Promise.resolve();
  }
}

/**
 * A script answer that returns one value as the request's result.
 *
 * @returns the answer for one request id
 */
export const result =
  (value: unknown): ((input: { id: number }) => string) =>
  ({ id }) =>
    `${JSON.stringify({ id, result: value })}\n`;

export const PLAN_LOGIN: Script = {
  "account/read": result({ account: { planType: "pro", type: "chatgpt" } }),
  initialize: result({ userAgent: "codex" }),
  "thread/start": result({ thread: { id: "thread-1" } }),
};

/**
 * A plan login whose thread takes every turn, numbering them.
 *
 * @returns the script
 */
export function accepting(): Script {
  let turns = 0;
  return {
    ...PLAN_LOGIN,
    "turn/start": ({ id }) => {
      turns += 1;
      return result({ turn: { id: `t-${String(turns)}`, status: "inProgress" } })({ id });
    },
  };
}

/**
 * A typed conversation over a scripted child.
 *
 * @param script how the child answers each method
 * @returns the session, what was written, the kill count, the clock and every event it emitted
 */
export function harness({ script }: { script: Script }): {
  session: TypedPlanSession;
  written: Record<string, unknown>[];
  kills: { count: number };
  clock: ReturnType<typeof fakeClock>;
  seen: SequencedEvent[];
} {
  const written: Record<string, unknown>[] = [];
  const kills = { count: 0 };
  const clock = fakeClock();
  const holder: { session?: TypedPlanSession } = {};
  const session = new TypedPlanSession({
    clock,
    id: "typed-1",
    journal: {
      close: () => undefined,
      observe: () => undefined,
      threadNeverStarted: () => undefined,
      threadStarted: () => undefined,
      threadStarting: () => undefined,
      toolAnswered: () => undefined,
    },
    meetings: new MeetingLedger(),
    mintToken: () => "token-1",
    notices: new TalkNoticeLedger(),
    onEnded: () => undefined,
    port: {
      kill: () => {
        kills.count += 1;
      },
      write: ({ line: request }) => {
        const message: unknown = JSON.parse(request);
        if (!isRecord(message)) {
          throw new Error(`the session wrote a line that is not an object: ${request}`);
        }
        written.push(message);
        const { id, method } = message;
        const answer = typeof method === "string" ? script[method] : undefined;
        const reply = typeof id === "number" ? answer?.({ id }) : undefined;
        if (reply !== undefined) {
          queueMicrotask(() => {
            holder.session!.receive({ chunk: reply });
          });
        }
      },
    },
  });
  holder.session = session;
  const seen: SequencedEvent[] = [];
  session.subscribe({ after: 0, listener: (event) => seen.push(event) });
  return { clock, kills, seen, session, written };
}

/**
 * A typed conversation, opened.
 *
 * @param script how the child answers, when a test needs more than an accepting thread
 * @returns the harness
 */
export async function opened({ script = accepting() }: { script?: Script } = {}): Promise<ReturnType<typeof harness>> {
  const h = harness({ script });
  expect(await h.session.openTyped({ composition: COMPOSITION })).toEqual({ kind: "open", threadId: "thread-1" });
  return h;
}

/**
 * A notification line, as the app-server writes it.
 *
 * @returns the newline-terminated JSON line
 */
export function line({ method, params }: { method: string; params: unknown }): string {
  return `${JSON.stringify({ method, params })}\n`;
}

/**
 * A `turn/completed` for one of thread-1's turns.
 *
 * @returns the notification line
 */
export function completed({ turnId }: { turnId: string }): string {
  return line({
    method: "turn/completed",
    params: { threadId: "thread-1", turn: { error: null, id: turnId, items: [], status: "completed" } },
  });
}

/**
 * A `turn/started` for one of thread-1's turns.
 *
 * @returns the notification line
 */
export function started({ turnId }: { turnId: string }): string {
  return line({
    method: "turn/started",
    params: { threadId: "thread-1", turn: { id: turnId, items: [], status: "inProgress" } },
  });
}

/**
 * One delta of an agent message.
 *
 * @param text the piece of the message this delta carries
 * @returns the notification line
 */
export function delta({ text, threadId = "thread-1" }: { text: string; threadId?: string }): string {
  return line({
    method: "item/agentMessage/delta",
    params: { delta: text, itemId: "msg-1", threadId, turnId: "t-1" },
  });
}

/**
 * Only the `written` events, in order.
 *
 * @param seen every event the session emitted
 * @returns the written events alone
 */
export function writtenOf({ seen }: { seen: readonly SequencedEvent[] }): PlanCallEvent[] {
  return seen.map(({ event }) => event).filter((event) => event.kind === "written");
}
