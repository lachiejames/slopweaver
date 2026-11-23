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

import { type ConversationWanted, conversationRuling, type LiveConversation } from "./talkArbiter";
import { drainCallThreadJournals, unwrittenCallThreadLines } from "./talkCallThreadJournal";
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

/** One held call, and the synchronous SIGKILL of its child. */
interface HeldCall {
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
 * @param killNow SIGKILLs its child at once, for a signal that may never reach an `exit` event
 */
export function holdPlanCall({ call, killNow }: { call: PlanCall; killNow: () => void }): void {
  const registry = state();
  registry.calls.set(call.id, { call, killNow });
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
 * Every conversation held now, by id and surface alone — what `/api/talk/held` answers the desktop e2e call leg's
 * preflight with, so it can see one of the owner's that holds no lease.
 *
 * @returns each held one, in the order they were held
 */
export function heldConversations(): readonly { readonly id: string; readonly surface: "voice" | "typed" }[] {
  return livePlanCalls().map((call) => ({ id: call.id, surface: call.surface }));
}

/**
 * The live ones as the arbiter reads them: a call is never `replying` to it, since only a typed answer holds a call.
 *
 * @returns each live one's surface and whether it is answering now
 */
export function liveConversations(): readonly LiveConversation[] {
  return livePlanCalls().map((call) => ({
    replying: call instanceof TypedPlanSession && call.replying,
    surface: call.surface,
  }));
}

/**
 * Make room for a conversation on `wanted` if the arbiter allows one now, ending the live ones it names.
 *
 * @param wanted the surface about to start
 * @param why what the ended ones are told
 * @returns `undefined` when the start may go ahead, else why not
 */
export function makeRoomFor({ wanted, why }: { wanted: ConversationWanted; why: string }): string | undefined {
  const live = livePlanCalls();
  const ruling = conversationRuling({ live: liveConversations(), wanted });
  if (ruling.kind === "refused") {
    return ruling.reason;
  }
  for (const [index, call] of live.entries()) {
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
