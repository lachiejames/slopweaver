/**
 * The console's live plan calls, by opaque id — one map for the whole server process.
 *
 * It hangs off `globalThis` under a symbol because the offer, events, answer and stop routes are separate
 * modules, and `next dev` re-evaluates a module when it recompiles it: a module-level `Map` would leave the
 * events route looking at an empty map the moment the offer route's file was touched. The symbol makes every
 * route and every re-evaluation read the same one.
 *
 * It also installs, once per process, an `exit` hook that kills every child still held, so stopping the dev
 * server never leaves an app-server — and the model thread it runs — behind it. A hang-up (a closed terminal pane)
 * or any other catchable ending signal ends Node without an `exit` event, so those are hooked too: each child is
 * killed there directly.
 */
import { constants } from "node:os";

import { MeetingLedger } from "./meetingLedger";
import {
  type ConversationInstance,
  type ConversationWanted,
  conversationRuling,
  type LiveConversation,
  typedAtRest,
} from "./talkArbiter";
import { drainCallThreadJournals, unwrittenCallThreadLines } from "./talkCallThreadJournal";
import { TalkNoticeLedger } from "./talkNoticeLedger";
import type { PlanCall } from "./talkPlanCall";
import { TypedPlanSession } from "./talkTypedSession";

/**
 * Every catchable signal whose default action ends the server. SIGINT and SIGTERM are among them although Next's own
 * cleanup ends in an `exit`: in production that cleanup first waits for every open response, and an attached
 * event stream stays open until its call is stopped, so waiting for `exit` to stop the call would wait forever.
 * Left out on purpose: SIGKILL and SIGSTOP, which no process can catch, and the fault signals (SIGSEGV, SIGBUS,
 * SIGFPE, SIGILL) and a native `abort()`, where no JavaScript runs before the process dies.
 */
const ENDING_SIGNALS = [
  "SIGINT",
  "SIGTERM",
  "SIGHUP",
  "SIGQUIT",
  "SIGABRT",
  "SIGUSR2",
  "SIGALRM",
  "SIGXCPU",
  "SIGXFSZ",
  "SIGVTALRM",
  "SIGPROF",
] as const;

/**
 * What a held call was made with beyond the call itself: whose it is, and the ledgers its meeting and notice lines are
 * claimed in — the server's own for the owner's, a pair of its own for a test call, so a test call never claims a line
 * the owner's call is still owed ({@link heldContextFor}).
 */
export interface HeldPlanCallContext {
  readonly instance: ConversationInstance;
  readonly meetings: MeetingLedger;
  readonly notices: TalkNoticeLedger;
}

/**
 * What a call is held with: the owner's share the server's ledgers; a test call gets a fresh pair of its own, so a
 * meeting or steer note it claims is still the owner's call's to say.
 *
 * @param instance whose the call is
 * @param ownerMeetings the server's own meeting ledger
 * @param ownerNotices the server's own notice ledger
 * @returns the context to hold it with
 */
export function heldContextFor({
  instance,
  ownerMeetings,
  ownerNotices,
}: {
  instance: ConversationInstance;
  ownerMeetings: MeetingLedger;
  ownerNotices: TalkNoticeLedger;
}): HeldPlanCallContext {
  if (instance === "e2e") {
    return { instance, meetings: new MeetingLedger(), notices: new TalkNoticeLedger() };
  }
  return { instance, meetings: ownerMeetings, notices: ownerNotices };
}

/** One held call, what it was made with, and the synchronous SIGKILL of its child. */
interface HeldCall extends HeldPlanCallContext {
  readonly call: PlanCall;
  readonly killNow: () => void;
}

/** The process-global state. */
interface RegistryState {
  readonly calls: Map<string, HeldCall>;
  exitHooked: boolean;
}

const KEY = Symbol.for("slopweaver.talk.planCalls");

/**
 * The one registry, made on first use.
 *
 * @returns the process-global state
 */
function state(): RegistryState {
  const holder = globalThis as typeof globalThis & { [KEY]?: RegistryState };
  let found = holder[KEY];
  if (found === undefined) {
    found = { calls: new Map(), exitHooked: false };
    holder[KEY] = found;
  }
  return found;
}

/**
 * Hold a call until it ends, and make sure the server's own exit ends it.
 *
 * @param call the call, whose `onEnded` must call {@link forgetPlanCall}
 * @param context whose it is and the ledgers it was made with
 * @param killNow SIGKILLs its child at once, for a signal that may never reach an `exit` event
 */
export function holdPlanCall({
  call,
  context,
  killNow,
}: {
  call: PlanCall;
  context: HeldPlanCallContext;
  killNow: () => void;
}): void {
  const registry = state();
  registry.calls.set(call.id, { ...context, call, killNow });
  if (!registry.exitHooked) {
    registry.exitHooked = true;
    process.once("exit", () => {
      for (const { call: live } of registry.calls.values()) {
        live.stop({ reason: "the console server exited" });
      }
      reportUnwrittenJournals();
    });
    // Kept, not `once`: a listener elsewhere may keep the server alive through one, and a later call still needs this.
    for (const signal of ENDING_SIGNALS) {
      process.on(signal, () => {
        endCallsOnSignal({
          held: [...registry.calls.values()].map(({ call: live, killNow: kill }) => ({
            kill,
            stop: live.stop.bind(live),
          })),
          afterDispatch: (then) => {
            setImmediate(then);
          },
          drain: drainJournals,
          exit: ({ code }) => process.exit(code),
          // This listener is one of them, so another is a count past one — read after dispatch, when a one-shot
          // listener this very signal spent is gone.
          othersListening: () => process.listenerCount(signal) > 1,
          signal,
        });
      });
    }
  }
}

/**
 * Stop every held call on a signal that would otherwise end the server with no `exit` event and SIGKILL its child
 * there and then, so no listener that keeps the server alive can leave a child waiting on a timer; then, once the
 * signal's other listeners have run, write what the thread journals hold, bounded, and end the server the way the
 * signal would have. When something else still listens for the signal by then, the drain still starts but ending
 * the server is left to that listener, as hooking the signal took the default away; what the drain leaves is said
 * once it returns, and the `exit` hook says what a process ending before then cut short.
 *
 * @param held each call still held, with its child's synchronous kill
 * @param afterDispatch runs a step once every listener for this signal has run
 * @param drain writes what the calls' thread journals still hold, within its own bound, before the server ends
 * @param exit ends the process with a status
 * @param othersListening whether another listener remains for this signal, asked after dispatch
 * @param signal the signal received
 */
export function endCallsOnSignal({
  held,
  afterDispatch,
  drain,
  exit,
  othersListening,
  signal,
}: {
  held: readonly { stop: (input: { reason: string }) => void; kill: () => void }[];
  afterDispatch: (then: () => void) => void;
  drain: () => Promise<void>;
  exit: (status: { code: number }) => void;
  othersListening: () => boolean;
  signal: (typeof ENDING_SIGNALS)[number];
}): void {
  for (const { stop, kill } of held) {
    stop({ reason: `the console server received ${signal}` });
    kill();
  }
  afterDispatch(() => {
    // The drain starts either way, and says what it could not write; a peer that ends the process sooner leaves that to
    // the `exit` hook. Ending the process waits on it only when nothing else will end it.
    const others = othersListening();
    void (async () => {
      await drain();
      if (!others) {
        exit({ code: 128 + constants.signals[signal] });
      }
    })();
  });
}

/**
 * The bound on writing what the calls' thread journals still hold before the server exits on a signal
 * (`./talkCallThreadJournal.ts`): one append on a starved machine took up to 33 s (`./talkCallAppend.ts`), so a bound
 * near that lets the last batch land without leaving a server that was told to stop running much longer. Past it, what
 * is unwritten is lost, and said.
 */
export const SHUTDOWN_DRAIN_MS = 30_000;

/**
 * Write what every journal still holds, within {@link SHUTDOWN_DRAIN_MS}, then say per call what is left — here, not
 * only in the `exit` hook, because a listener that keeps the server alive means the hook may never run. Each report
 * says what is true at its own moment, so an entry a drain left and the exit then lost is named by both.
 *
 * @returns once drained or past the bound, and what was left said
 */
async function drainJournals(): Promise<void> {
  await drainCallThreadJournals({ timeoutMs: SHUTDOWN_DRAIN_MS });
  writeUnwritten({ when: "after the shutdown drain" });
}

/** Say on stderr, synchronously, which calls' journal entries the ending process is losing. */
function reportUnwrittenJournals(): void {
  writeUnwritten({ when: "at exit" });
}

/**
 * One stderr line per call whose journal still holds entries — none says nothing.
 *
 * @param when the moment the count was read, as the line names it
 */
function writeUnwritten({ when }: { when: string }): void {
  for (const line of unwrittenCallThreadLines({ when })) {
    process.stderr.write(`${line}\n`);
  }
}

/**
 * Forget a call that ended.
 *
 */
export function forgetPlanCall({ id }: { id: string }): void {
  state().calls.delete(id);
}

/**
 * A live call by id.
 *
 * @returns the call, or `undefined` when none is live under that id
 */
export function planCallById({ id }: { id: string }): PlanCall | undefined {
  return state().calls.get(id)?.call;
}

/**
 * Every live call and typed conversation, in the order they were held — what `./talkArbiter.ts` rules over.
 *
 * @returns the live ones
 */
export function livePlanCalls(): readonly PlanCall[] {
  return [...state().calls.values()].map(({ call }) => call);
}

/**
 * What `/api/talk/held` answers of each conversation held: its id, its surface and whether it is a typed one at rest.
 */
export interface HeldConversationView {
  readonly id: string;
  readonly surface: "voice" | "typed";
  readonly atRest: boolean;
}

/**
 * Every conversation held now, the test instance's calls included — what `/api/talk/held` answers the desktop e2e call
 * leg's preflight with, so it can see one of the owner's that holds no lease, and whether a typed one is at rest.
 *
 * @param nowMs the server's clock now, read once for every row
 * @returns each held one, in the order they were held
 */
export function heldConversations({ nowMs }: { nowMs: number }): readonly HeldConversationView[] {
  return [...state().calls.values()].map((held) => ({
    atRest: viewOf({ held, nowMs }).atRest,
    id: held.call.id,
    surface: held.call.surface,
  }));
}

/**
 * One held call as the arbiter reads it.
 *
 * @param held the held call
 * @param nowMs the server's clock now
 * @returns its surface, whether it is answering, whether it is a test call and whether it is a typed one at rest
 */
function viewOf({ held, nowMs }: { held: HeldCall; nowMs: number }): LiveConversation {
  const { call, instance } = held;
  if (!(call instanceof TypedPlanSession)) {
    return { atRest: false, replying: false, surface: call.surface, test: instance === "e2e" };
  }
  return liveTypedConversationOf({
    activityMs: call.activityMs,
    nowMs,
    replying: call.replying,
    test: instance === "e2e",
  });
}

/**
 * A typed conversation as the arbiter reads it. Pure, so what makes one at rest is tested without a child.
 *
 * @param activityMs when it was last active
 * @param nowMs the server's clock now
 * @param replying whether its thread is answering, or a send is out
 * @param test whether a test instance holds it — never so today, and then never at rest
 * @returns the arbiter's row
 */
export function liveTypedConversationOf({
  activityMs,
  nowMs,
  replying,
  test,
}: {
  activityMs: number;
  nowMs: number;
  replying: boolean;
  test: boolean;
}): LiveConversation {
  const atRest = !test && typedAtRest({ lastActiveMs: activityMs, nowMs, replying });
  return { atRest, replying, surface: "typed", test };
}

/**
 * The live ones as the arbiter reads them: a call is never `replying` to it, since only a typed answer holds a call.
 *
 * @param nowMs the server's clock now, read once for every row
 * @returns each live one's surface, whether it is answering now, whether it is a test call and whether it is at rest
 */
export function liveConversations({ nowMs }: { nowMs: number }): readonly LiveConversation[] {
  return [...state().calls.values()].map((held) => viewOf({ held, nowMs }));
}

/**
 * Every live call with whether it is a test call — what the typed-in route picks the owner's voice call from
 * (`./talkArbiter.ts` `liveVoiceCallOf`), so the owner's words never go into a test call.
 *
 * @returns each live call, its surface, when it was made and whether it is a test call, in the order they were held
 */
export function liveCallsByInstance(): readonly {
  readonly call: PlanCall;
  readonly surface: "voice" | "typed";
  readonly madeMs: number;
  readonly test: boolean;
}[] {
  return [...state().calls.values()].map(({ call, instance }) => ({
    call,
    madeMs: call.madeMs,
    surface: call.surface,
    test: instance === "e2e",
  }));
}

/**
 * What a live call was made with: whose it is, and its own ledgers — what a route that claims a meeting or notice line
 * for one call reads, so a test call's claim never lands in the owner's ledger.
 *
 * @returns the context, or `undefined` when none is live under that id
 */
export function planCallContextById({ id }: { id: string }): HeldPlanCallContext | undefined {
  const held = state().calls.get(id);
  if (held === undefined) {
    return undefined;
  }
  return { instance: held.instance, meetings: held.meetings, notices: held.notices };
}

/**
 * Make room for a conversation on `wanted` if the arbiter allows one now, ending the live ones it names. One snapshot
 * of the registry and one instant: the ruling's indices are the calls ended.
 *
 * @param wanted the surface about to start
 * @param why what the ended ones are told
 * @returns `undefined` when the start may go ahead, else why not
 */
export function makeRoomFor({ wanted, why }: { wanted: ConversationWanted; why: string }): string | undefined {
  const held = [...state().calls.values()];
  const nowMs = Date.now();
  const ruling = conversationRuling({ live: held.map((one) => viewOf({ held: one, nowMs })), wanted });
  if (ruling.kind === "refused") {
    return ruling.reason;
  }
  for (const [index, { call }] of held.entries()) {
    if (ruling.end.includes(index)) {
      call.stop({ reason: why });
    }
  }
  return undefined;
}

/**
 * How many calls are live — what the stop route and the live proof read to show a child is gone.
 *
 * @returns the count
 */
export function livePlanCallCount(): number {
  return state().calls.size;
}
