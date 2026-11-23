/**
 * The scripted Codex app-server, fake clock and line builders every `PlanCall` test file beside this one drives a
 * call through: one plan call's lifecycle over a fake child and a fake clock. The child is a plain fake port that
 * answers requests from a script; nothing is mocked. These lived in one 4,229-line test file; each behaviour's
 * tests now sit in a file of their own, and only what two or more of them share lives here.
 */

import { expect } from "vitest";
import { ANNOUNCE_LEAD_MS } from "../../../lib/announceCue";
import { MeetingLedger } from "../../../lib/meetingLedger";
import { type SequencedEvent } from "../../../lib/planCallContract";
import { TalkNoticeLedger } from "../../../lib/talkNoticeLedger";
import { PlanCall, type PlanCallClock } from "../../../lib/talkPlanCall";
import type { PlanComposition } from "../../../lib/talkPlanProtocol";
import { type SpokenRecordLine } from "../../../lib/talkVoiceRecord";

export const COMPOSITION: PlanComposition = {
  argv: [],
  backendModel: "gpt-6-astra",
  codexHome: "/stores/plan-one",
  continuity: undefined,
  executable: "/vendored/codex",
  model: "realtime-v3",
  pack: undefined,
  planAlias: "plan-one",
  realtime: { delegationAckFiller: false, version: "v3", voice: "sol" },
  reopenReminder: null,
  thread: { ephemeral: true, model: "gpt-6-astra" },
  tools: ["read_page"],
  unsetEnv: [],
  voice: "sol",
  writers: [],
};

/**
 * A clock whose time moves only when the test says.
 *
 * @returns the clock, with `advance` to move it and run every timer now due
 */
export function fakeClock(): PlanCallClock & { advance: (input: { ms: number }) => void } {
  let now = 0;
  const timers: { at: number; run: () => void; live: boolean }[] = [];
  return {
    advance: ({ ms }) => {
      now += ms;
      for (const timer of timers.filter((t) => t.live && t.at <= now)) {
        timer.live = false;
        timer.run();
      }
    },
    after: ({ ms, run }) => {
      const timer = { at: now + ms, live: true, run };
      timers.push(timer);
      return () => {
        timer.live = false;
      };
    },
    elapsedMs: () => now,
    nowMs: () => now,
  };
}

/** The methods written, in order, and a way to answer by method. */
export type Script = Record<string, (input: { id: number }) => string | undefined>;

/** Let every queued answer land: the handshake's requests resolve through `startPlanThread`'s nested async frame. */
export async function settle(): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    await Promise.resolve();
  }
}

/**
 * One unasked line's outcome once its herald's lead is up: the line has started and emitted its chime, and the clock
 * is moved past {@link ANNOUNCE_LEAD_MS} so the write it holds goes out.
 *
 * @param line the line, started and not yet awaited
 * @returns how it landed
 */
export async function afterLead<T>({
  clock,
  line,
}: {
  clock: ReturnType<typeof fakeClock>;
  line: Promise<T>;
}): Promise<T> {
  await settle();
  clock.advance({ ms: ANNOUNCE_LEAD_MS });
  return line;
}

/** A wire value as an object, or a throw naming `what` — what the call writes is checked, never asserted. */
function recordOf({ value, what }: { value: unknown; what: string }): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${what} is not an object: ${JSON.stringify(value)}`);
  }
  return Object.fromEntries(Object.entries(value));
}

/** A wire value as a number, or a throw naming `what`. */
function numberOf({ value, what }: { value: unknown; what: string }): number {
  if (typeof value !== "number") {
    throw new Error(`${what} is not a number: ${JSON.stringify(value)}`);
  }
  return value;
}

/** A wire value as a string, or a throw naming `what`. */
function stringOf({ value, what }: { value: unknown; what: string }): string {
  if (typeof value !== "string") {
    throw new Error(`${what} is not a string: ${JSON.stringify(value)}`);
  }
  return value;
}

/**
 * A call over a scripted child.
 *
 * @param script how the child answers each method, as the line(s) it writes back
 * @param mint what the call's minter returns instead of a fresh `token-<n>` each time
 * @param meetings a ledger shared with another call, as a rollover's fresh call shares the server's
 * @param notices a window-notice ledger shared the same way
 * @returns the call, what was written, the kill count and the clock
 */
export function harness({
  script,
  mint,
  meetings,
  notices,
}: {
  script: Script;
  mint?: () => string;
  meetings?: MeetingLedger;
  notices?: TalkNoticeLedger;
}): {
  call: PlanCall;
  written: Record<string, unknown>[];
  kills: { count: number };
  ended: string[];
  clock: ReturnType<typeof fakeClock>;
  journal: string[];
} {
  const written: Record<string, unknown>[] = [];
  const kills = { count: 0 };
  const ended: string[] = [];
  const journal: string[] = [];
  const clock = fakeClock();
  let tokens = 0;
  const holder: { call?: PlanCall } = {};
  let ledger = new MeetingLedger();
  if (meetings !== undefined) {
    ledger = meetings;
  }
  let noticeLedger = new TalkNoticeLedger();
  if (notices !== undefined) {
    noticeLedger = notices;
  }
  const call = new PlanCall({
    clock,
    id: "call-1",
    journal: {
      close: () => journal.push("close"),
      observe: ({ method }) => journal.push(`observe ${method}`),
      threadNeverStarted: () => journal.push("never started"),
      threadStarted: ({ threadId }) => journal.push(`started ${threadId}`),
      threadStarting: ({ surface }) => journal.push(`starting ${surface}`),
      toolAnswered: ({ call: answered, success }) =>
        journal.push(`answered ${answered.tool} ${String(success)} after ${String(written.length)} writes`),
    },
    meetings: ledger,
    notices: noticeLedger,
    mintToken: () => {
      tokens += 1;
      if (mint !== undefined) {
        return mint();
      }
      return `token-${String(tokens)}`;
    },
    onEnded: ({ id }) => ended.push(id),
    port: {
      kill: () => {
        kills.count += 1;
      },
      write: ({ line }) => {
        const message = recordOf({ value: JSON.parse(line), what: "a line the call wrote" });
        written.push(message);
        const answer = typeof message["method"] === "string" ? script[message["method"]] : undefined;
        const reply = answer?.({ id: numberOf({ value: message["id"], what: "an answered request's id" }) });
        if (reply !== undefined) {
          queueMicrotask(() => {
            holder.call!.receive({ chunk: reply });
          });
        }
      },
    },
  });
  holder.call = call;
  return { call, clock, ended, journal, kills, written };
}

/**
 * A script answer that succeeds with `value`.
 *
 * @returns the answer, writing a JSON-RPC result line under the request's id
 */
export const result =
  (value: unknown): ((input: { id: number }) => string) =>
  ({ id }: { id: number }) =>
    `${JSON.stringify({ id, result: value })}\n`;

/**
 * A script answer that fails with `message`.
 *
 * @returns the answer, writing a JSON-RPC error line under the request's id
 */
export const failure =
  (message: string): ((input: { id: number }) => string) =>
  ({ id }: { id: number }) =>
    `${JSON.stringify({ error: { code: -1, message }, id })}\n`;

export const PLAN_LOGIN: Script = {
  "account/read": result({ account: { planType: "pro", type: "chatgpt" } }),
  initialize: result({ userAgent: "codex" }),
  "thread/start": result({ thread: { id: "thread-1" } }),
};

export const SDP_LINE = `${JSON.stringify({ method: "thread/realtime/sdp", params: { sdp: "v=0 answer", threadId: "thread-1" } })}\n`;

/** A plan login that accepts realtime and sends its SDP. */
export const OPENS: Script = {
  ...PLAN_LOGIN,
  "thread/realtime/start": ({ id }) => `${JSON.stringify({ id, result: {} })}\n${SDP_LINE}`,
};

/**
 * Open a call on the {@link OPENS} script, or on one extending it.
 *
 * @param mint what the call's minter returns, when a test needs it to repeat
 * @param script how the child answers, when a test needs more than the handshake answered
 * @returns the harness, opened
 */
export async function opened({
  meetings,
  notices,
  mint,
  script = OPENS,
}: { meetings?: MeetingLedger; notices?: TalkNoticeLedger; mint?: () => string; script?: Script } = {}): Promise<
  ReturnType<typeof harness>
> {
  const h = harness({ meetings, mint, notices, script });
  const outcome = await h.call.open({ composition: COMPOSITION, offerSdp: "v=0 offer" });
  expect(outcome).toEqual({ kind: "open", sdp: "v=0 answer", threadId: "thread-1" });
  return h;
}

export const TOOL_REQUEST = `${JSON.stringify({
  id: 77,
  method: "item/tool/call",
  params: {
    arguments: { query: "q" },
    callId: "c1",
    namespace: null,
    threadId: "thread-1",
    tool: "search_corpus",
    turnId: "u1",
  },
})}\n`;

/** A claim of {@link TOOL_REQUEST}: the tool and its arguments as this server received them. */
export const CLAIMED = {
  arguments: JSON.stringify({ query: "q" }),
  kind: "claimed",
  tool: "search_corpus",
  turnId: "u1",
};

/**
 * A `turn/started` or `turn/completed` notification line, as the app-server writes it.
 *
 * @returns the line, newline-terminated
 */
export const turnLine = ({
  method,
  threadId = "thread-1",
  turnId,
  status,
  error = null,
}: {
  method: "turn/started" | "turn/completed";
  threadId?: string;
  turnId: string;
  status: string;
  error?: unknown;
}): string => `${JSON.stringify({ method, params: { threadId, turn: { error, id: turnId, items: [], status } } })}\n`;

/**
 * An `item/*` notification line inside a turn.
 *
 * @returns the line, newline-terminated
 */
export const itemLine = ({ method, turnId, item }: { method: string; turnId: string; item?: unknown }): string =>
  `${JSON.stringify({ method, params: { item, threadId: "thread-1", turnId } })}\n`;

/**
 * Every event a subscriber saw, without its sequence number.
 *
 * @returns the events, in the order seen
 */
export const eventsOf = ({ seen }: { seen: readonly SequencedEvent[] }): SequencedEvent["event"][] =>
  seen.map(({ event }) => event);

/** A child that takes the nudge's developer message and its interrupt, and the speech of an ack or look line. */
export const NUDGES: Script = {
  ...OPENS,
  "thread/realtime/appendSpeech": result({}),
  "thread/realtime/appendText": result({}),
  "turn/interrupt": result({}),
};

/**
 * The speech written after `before`.
 *
 * @returns the text of every `appendSpeech` written since, in order
 */
export const spokenAfter = ({ h, before }: { h: Awaited<ReturnType<typeof opened>>; before: number }): string[] =>
  h.written
    .slice(before)
    .filter((message) => message["method"] === "thread/realtime/appendSpeech")
    .map((message) =>
      stringOf({
        value: recordOf({ value: message["params"], what: "a speech request's params" })["text"],
        what: "a speech request's text",
      }),
    );

/**
 * A call opened with the page's event stream attached, as a live call always has — unattached, the call stops at
 * {@link PLAN_CALL_LIMITS.streamAbsentMs}, which is the same window as a progress cue.
 *
 * @param script how the child answers
 * @returns the harness, opened, and every event the stream saw
 */
export async function listening({
  script,
}: {
  script: Script;
}): Promise<Awaited<ReturnType<typeof opened>> & { seen: SequencedEvent[] }> {
  const h = await opened({ script });
  const seen: SequencedEvent[] = [];
  h.call.subscribe({ after: 0, listener: (event) => seen.push(event) });
  return { ...h, seen };
}

/**
 * How many progress cues the page's stream has been sent.
 *
 * @returns the count of `progress` events seen
 */
export const cuesOf = ({ seen }: { seen: readonly SequencedEvent[] }): number =>
  seen.filter(({ event }) => event.kind === "progress").length;

/**
 * A realtime transcript fragment of either side, as the app-server writes it.
 *
 * @returns the line, newline-terminated
 */
export const transcriptLine = ({ role }: { role: "user" | "assistant" }): string =>
  `${JSON.stringify({ method: "thread/realtime/transcript/delta", params: { delta: "so", role, threadId: "thread-1" } })}\n`;

/**
 * The `done` that closes an utterance of the owner's, carrying it whole.
 *
 * @returns the line, newline-terminated
 */
export const heardDoneLine = ({ text }: { text: string }): string =>
  `${JSON.stringify({ method: "thread/realtime/transcript/done", params: { role: "user", text, threadId: "thread-1" } })}\n`;

/**
 * The owner's words heard, then handed off: the Codex turn they became starts.
 *
 * @param h the harness
 * @param turnId the turn the hand-off becomes
 */
export function handOff({ h, turnId }: { h: Awaited<ReturnType<typeof opened>>; turnId: string }): void {
  h.call.receive({ chunk: transcriptLine({ role: "user" }) });
  h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId }) });
}

/** A child that takes a resume's developer message, and the speech of a nudge, ack or look line. */
export const RESUMES: Script = { ...NUDGES, "thread/realtime/appendText": result({}) };

/** A Slack thread link as the owner pasted one into the box, its channel and timestamp made up. */
export const PASTED = "https://acme.slack.com/archives/C0SYNTESTCHAN1/p1791351441819519";

/**
 * Every `appendText` written after `before`.
 *
 * @returns each one's params, role and text, in order
 */
export const appendsAfter = ({ h, before }: { h: Awaited<ReturnType<typeof opened>>; before: number }): unknown[] =>
  h.written
    .slice(before)
    .filter((line) => line["method"] === "thread/realtime/appendText")
    .map((line) => line["params"]);

/** A held reply, as the page's watch posts it. */
export const HELD_SEND = {
  noticeId: "2026-10-07T05:52:56.000Z https://acme.slack.com/archives/C0SYN000001/p1791351441819519",
  outcome: { state: "held", why: "Lena is named but not tagged" },
} as const;

/** One triage card's visit, as the page's pass names it. */
export const VISIT = "0b6c1f7e-2a4d-4e5b-9c3a-7d8e9f0a1b2c-3";

/**
 * One `item/tool/call` request line for a triage tool.
 *
 * @param id the request's JSON-RPC id
 * @param tool the tool it calls
 * @returns the line
 */
export function triageRequest({ args = {}, id, tool }: { args?: object; id: number; tool: string }): string {
  const params = {
    arguments: args,
    callId: `c${String(id)}`,
    namespace: null,
    threadId: "thread-1",
    tool,
    turnId: "u1",
  };
  return `${JSON.stringify({ id, method: "item/tool/call", params })}\n`;
}

/** The voice's fourteen, then the owner's question — the order the record carries them in. */
export const SAID: readonly SpokenRecordLine[] = [
  { id: "v1", text: "That covers fourteen cards. That's the last one.", who: "voice" },
  { id: "h1", text: "Where did fourteen come from?", who: "owner" },
];

/**
 * The owner's words as the realtime session transcribes them.
 *
 * @returns the line, newline-terminated
 */
export const heardLine = ({ delta }: { delta: string }): string =>
  `${JSON.stringify({ method: "thread/realtime/transcript/delta", params: { delta, role: "user", threadId: "thread-1" } })}\n`;

/** What `NOTE_ANSWER_LINE`'s final answer says. */
export const NOTE_ANSWER = "The note says groups are manual now.";

/** A final answer of turn `t-1` completing, the same item as `ANSWER_LINE` saying `NOTE_ANSWER`. */
export const NOTE_ANSWER_LINE = itemLine({
  item: { id: "a-1", phase: "final_answer", text: NOTE_ANSWER, type: "agentMessage" },
  method: "item/completed",
  turnId: "t-1",
});
