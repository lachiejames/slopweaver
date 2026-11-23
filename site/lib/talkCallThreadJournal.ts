/**
 * One call's thread journal, as this server keeps it: what the Codex thread was told at its start, its id, each turn
 * frame and completed item, and every tool answer the console handed it, queued in memory and written through
 * `slopweaver talk call-thread-append` (`./talkCallThreadAppend.ts`) into `$SLOPWEAVER_HOME/talk/threads/`. The
 * thread is started `ephemeral`, so without this nothing on the machine keeps
 * what the thinking model reasoned or read.
 *
 * ## Never in the call's way
 *
 * Recording is synchronous and cannot fail; writing is not awaited by anything the call does. One batch is in flight
 * at a time and what arrives meanwhile queues behind it, so a starved verb only makes the next batch bigger.
 *
 * - A batch the verb could not write (`EXIT_ERROR`, a timeout, a spawn failure) is posted again, the same `writeId`s,
 *   after a back-off; the verb writes an entry it already holds once.
 * - A batch it REFUSED (`EXIT_USAGE`) can never succeed by retrying, so the journal stops and says so on the server's
 *   stderr, naming the call — loudly, never silently — and keeps the entries in memory rather than inventing a fix.
 *
 * ## What it does not keep
 *
 * A notification of another thread, any method but a turn frame or a completed item (no delta, no realtime transcript —
 * the call file `talk/calls` has those), and an entry whose ids the verb would refuse (`./talkCallThreadWire.ts`).
 * Notifications that arrive before `thread/start` answers are held, at most {@link PRE_BIND_MAX}, and kept once the
 * thread id is known if they are that thread's; when the thread never starts, the close says how many were held.
 *
 * ## The residue
 *
 * The queue is in this process. A clean shutdown drains it within a bound (`drainCallThreadJournals`, the registry's
 * signal path); a SIGKILL, a crash or a drain past its bound loses what had not been written yet.
 */
import { VERB_USAGE_EXIT } from "./relayRetry";
import {
  CALL_THREAD_NOTIFICATION_METHODS,
  type CallThreadCapture,
  type CallThreadWireEntry,
  wireCapture,
} from "./talkCallThreadWire";

/** The most entries one batch carries: the verb's own ceiling. */
export const CALL_THREAD_BATCH_MAX = 500;

/** Notifications held before the thread id is known. */
export const PRE_BIND_MAX = 200;

/** The first retry's wait, doubled each failure up to {@link RETRY_MAX_MS}. */
const RETRY_FIRST_MS = 1000;

/** The longest wait between retries. */
const RETRY_MAX_MS = 30_000;

/** What a journal needs from the world. */
export interface CallThreadJournalPort {
  /** Write one batch: `undefined` once written, else why not and the verb's exit code when it ran. */
  readonly append: (input: {
    readonly callId: string;
    readonly jsonl: string;
  }) => Promise<{ readonly why: string; readonly exitCode: number | undefined } | undefined>;
  readonly nowIso: () => string;
  readonly newWriteId: () => string;
  readonly wait: (input: { readonly ms: number }) => Promise<void>;
  /** Say something on the server's stderr. */
  readonly report: (input: { readonly line: string }) => void;
}

/** One tool answer as the call hands it to its journal. */
interface ToolAnswer {
  readonly call: {
    readonly tool: string;
    readonly arguments: string;
    readonly callId: string;
    readonly threadId: string;
    readonly turnId: string | undefined;
  };
  readonly contentItems: readonly unknown[];
  readonly success: boolean;
}

/** What a call records into its journal; {@link CallThreadJournal} is the one real one. */
export interface CallThreadTap {
  readonly threadStarting: (input: { readonly params: unknown; readonly surface: "voice" | "typed" }) => void;
  readonly threadStarted: (input: { readonly threadId: string }) => void;
  readonly threadNeverStarted: () => void;
  readonly observe: (input: { readonly method: string; readonly params: unknown }) => void;
  readonly toolAnswered: (input: ToolAnswer) => void;
  readonly close: () => void;
}

const UNDRAINED_KEY = Symbol.for("slopweaver.talk.callThreadJournals");

/**
 * Every journal with entries still to write, for a shutdown to drain — process-global, like the call registry, because
 * Next dev re-evaluates this module while the registry's exit hooks, installed once, keep calling the first copy's
 * drain: a module-local set would hide every journal made after a reload from them.
 */
const undrained: Set<CallThreadJournal> = (() => {
  const holder = globalThis as typeof globalThis & { [UNDRAINED_KEY]?: Set<CallThreadJournal> };
  let found = holder[UNDRAINED_KEY];
  if (found === undefined) {
    found = new Set();
    holder[UNDRAINED_KEY] = found;
  }
  return found;
})();

/**
 * The `threadId` a notification's params name.
 *
 * @param params the params
 * @returns the id, or `undefined` when they name none
 */
function threadIdIn({ params }: { params: unknown }): string | undefined {
  if (typeof params !== "object" || params === null || !("threadId" in params)) {
    return undefined;
  }
  return typeof params.threadId === "string" ? params.threadId : undefined;
}

/** One call's journal. */
export class CallThreadJournal implements CallThreadTap {
  private readonly callId: string;
  private readonly port: CallThreadJournalPort;
  private readonly queue: CallThreadWireEntry[] = [];
  private readonly preBind: { readonly method: string; readonly params: unknown; readonly receivedAtIso: string }[] =
    [];
  private preBindDropped = 0;
  private threadId: string | undefined = undefined;
  /** `thread/start` failed, so nothing held can ever be attributed to a thread. */
  private threadAbsent = false;
  private inFlight = false;
  private refused = false;
  /** Entries recorded after the refusal: never queued, said at close. */
  private afterRefusal = 0;
  private closed = false;
  private retryMs = RETRY_FIRST_MS;
  private readonly idleWaiters: (() => void)[] = [];

  /**
   * A journal for one call.
   *
   * @param callId the call's id, which names its journal file
   * @param port the world
   */
  constructor({ callId, port }: { callId: string; port: CallThreadJournalPort }) {
    this.callId = callId;
    this.port = port;
  }

  /**
   * The call this journal belongs to.
   *
   * @returns the call's id
   */
  get id(): string {
    return this.callId;
  }

  /**
   * How many entries are not written yet.
   *
   * @returns the count, the one in flight included
   */
  get pendingCount(): number {
    return this.queue.length;
  }

  /**
   * How many accepted captures will never be written by this journal as it stands: everything queued, and every
   * capture recorded after a refusal.
   *
   * @returns the count the exit report names
   */
  get unwrittenCount(): number {
    return this.queue.length + this.afterRefusal;
  }

  /**
   * Whether the verb refused a batch, so this journal writes nothing more.
   *
   * @returns `true` once refused
   */
  get stopped(): boolean {
    return this.refused;
  }

  /**
   * Record the `thread/start` request about to be sent.
   *
   * @param params exactly what the thread is told
   * @param surface the call's surface
   */
  threadStarting({ params, surface }: { params: unknown; surface: "voice" | "typed" }): void {
    this.record({ capture: { kind: "thread-start-requested", params, surface } });
  }

  /**
   * Bind the thread, record its id, and keep what it said before the bind.
   *
   * @param threadId the id `thread/start` answered
   */
  threadStarted({ threadId }: { threadId: string }): void {
    this.threadId = threadId;
    // What arrived before the bind is journalled first, at its own arrival time, so the journal keeps arrival order
    //.
    for (const { method, params, receivedAtIso } of this.preBind.splice(0)) {
      if (threadIdIn({ params }) === threadId) {
        this.record({ capture: { kind: "notification", method, params }, receivedAtIso });
      }
    }
    this.record({ capture: { kind: "thread-started", threadId } });
    if (this.preBindDropped > 0) {
      this.port.report({
        line: `talk call-thread (call ${this.callId}): ${String(this.preBindDropped)} notification(s) before the thread started were past the hold of ${String(PRE_BIND_MAX)} and are not in the journal`,
      });
    }
  }

  /**
   * `thread/start` failed: what was held has no thread to be attributed to, so it is said, never silently dropped.
   */
  threadNeverStarted(): void {
    if (this.threadId !== undefined || this.threadAbsent) {
      return;
    }
    this.threadAbsent = true;
    const unbound = this.preBind.splice(0).length + this.preBindDropped;
    if (unbound > 0) {
      this.port.report({
        line: `talk call-thread (call ${this.callId}): ${String(unbound)} notification(s) arrived before a thread that never started, so they are not in the journal`,
      });
    }
  }

  /**
   * One notification the app-server sent: kept when it is a turn frame or a completed item of this call's thread.
   *
   * @param method which JSON-RPC notification arrived; only turn frames and completed items are kept
   * @param params the notification's payload, whose `threadId` must name this call's thread
   */
  observe({ method, params }: { method: string; params: unknown }): void {
    if (!CALL_THREAD_NOTIFICATION_METHODS.has(method)) {
      return;
    }
    if (this.threadId === undefined) {
      if (this.threadAbsent) {
        this.port.report({
          line: `talk call-thread (call ${this.callId}): a ${method} notification arrived for a thread that never started, so it is not in the journal`,
        });
        return;
      }
      // Still held after close(): a `thread/start` reply read in the same stdout chunk as the close binds the thread
      // only when its continuation runs, after close() — and binding then journals all of this.
      if (this.preBind.length < PRE_BIND_MAX) {
        this.preBind.push({ method, params, receivedAtIso: this.port.nowIso() });
      } else {
        this.preBindDropped += 1;
      }
      return;
    }
    if (threadIdIn({ params }) === this.threadId) {
      this.record({ capture: { kind: "notification", method, params } });
    }
  }

  /**
   * One tool answer, recorded before it is written to the thread.
   *
   * @param call the tool call it answers
   * @param contentItems the answer
   * @param success whether it succeeded
   */
  toolAnswered({ call, contentItems, success }: ToolAnswer): void {
    // A tool call outside any turn carries none; the wire spells that absence `null`, by design.
    let turnId: string | null = null;
    if (call.turnId !== undefined) {
      turnId = call.turnId;
    }
    this.record({
      capture: {
        arguments: call.arguments,
        contentItems,
        kind: "tool-answer",
        success,
        threadId: call.threadId,
        tool: call.tool,
        toolCallId: call.callId,
        turnId,
      },
    });
  }

  /**
   * The call ended: what is queued is still written, and a late capture of the bound thread is still recorded.
   * Notifications held for a thread not yet bound stay held: a `thread/start` reply already read binds it when its
   * continuation runs, and a failed one says them through {@link threadNeverStarted}, so neither drops them silently.
   */
  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    if (this.afterRefusal > 0) {
      this.port.report({
        line: `talk call-thread (call ${this.callId}): ${String(this.afterRefusal)} more entr(ies) arrived after the refused batch and are not in the journal`,
      });
    }
    this.settleIfIdle();
  }

  /**
   * Wait until everything queued is written, the journal is refused, or `timeoutMs` passes.
   *
   * @param timeoutMs the bound
   * @returns how many entries were still unwritten when it returned
   */
  async drained({ timeoutMs }: { timeoutMs: number }): Promise<number> {
    if (this.queue.length === 0 || this.refused) {
      return this.queue.length;
    }
    const idle = new Promise<void>((resolve) => {
      this.idleWaiters.push(resolve);
    });
    await Promise.race([idle, this.port.wait({ ms: timeoutMs })]);
    return this.queue.length;
  }

  /**
   * Queue one capture and start writing if nothing is in flight.
   *
   * @param capture what was recorded
   * @param receivedAtIso when a held notification first arrived; a live capture is stamped now
   */
  private record({ capture, receivedAtIso }: { capture: CallThreadCapture; receivedAtIso?: string }): void {
    // A capture after close() is still queued: buffered app-server output can land after the call stops, and it is
    // the thread's own record, so it is written or counted unwritten at exit, never dropped.
    if (this.refused) {
      this.afterRefusal += 1;
      if (this.closed) {
        // close() has already said its count, so one arriving after both is said now.
        this.port.report({
          line: `talk call-thread (call ${this.callId}): a ${capture.kind} entry arrived after the refused batch and the call's close, so it is not in the journal`,
        });
      }
      return;
    }
    const wired = wireCapture({ capture });
    if (wired === undefined) {
      this.port.report({
        line: `talk call-thread (call ${this.callId}): a ${capture.kind} entry carried an id the journal verb refuses, so it is not in the journal`,
      });
      return;
    }
    let stampedIso = this.port.nowIso();
    if (receivedAtIso !== undefined) {
      stampedIso = receivedAtIso;
    }
    const entry = {
      callId: this.callId,
      capture: wired,
      receivedAtIso: stampedIso,
      version: 1,
      writeId: this.port.newWriteId(),
    } as const;
    this.queue.push(entry);
    undrained.add(this);
    void this.pump();
  }

  /** Write batches until the queue is empty, the verb refuses one, or one fails (then retry after a back-off). */
  private async pump(): Promise<void> {
    if (this.inFlight || this.refused) {
      return;
    }
    this.inFlight = true;
    try {
      // A refusal breaks out of this loop where it is set, so the queue's length is the only condition.
      while (this.queue.length > 0) {
        const batch = this.queue.slice(0, CALL_THREAD_BATCH_MAX);
        const jsonl = batch.map((entry) => `${JSON.stringify(entry)}\n`).join("");
        const failed = await this.port.append({ callId: this.callId, jsonl });
        if (failed === undefined) {
          this.queue.splice(0, batch.length);
          this.retryMs = RETRY_FIRST_MS;
          continue;
        }
        if (failed.exitCode === VERB_USAGE_EXIT) {
          this.refused = true;
          this.port.report({
            line: `talk call-thread (call ${this.callId}): the journal verb REFUSED a batch, so this call's thread journal stops here with ${String(this.queue.length)} entr(ies) unwritten: ${failed.why}`,
          });
          break;
        }
        this.port.report({
          line: `talk call-thread (call ${this.callId}): a batch of ${String(batch.length)} was not written, retrying in ${String(this.retryMs / 1000)}s: ${failed.why}`,
        });
        await this.port.wait({ ms: this.retryMs });
        this.retryMs = Math.min(this.retryMs * 2, RETRY_MAX_MS);
      }
    } finally {
      this.inFlight = false;
      this.settleIfIdle();
    }
  }

  /**
   * Tell every drain waiting that the journal has nothing more it will write. A refused journal still holding entries
   * stays where the exit report reads, so what it never wrote is named at exit as well as at the refusal.
   */
  private settleIfIdle(): void {
    if (this.inFlight || (this.queue.length > 0 && !this.refused)) {
      return;
    }
    if (this.unwrittenCount === 0) {
      undrained.delete(this);
    }
    for (const resolve of this.idleWaiters.splice(0)) {
      resolve();
    }
  }
}

/**
 * Drain every journal of this server, all at once, within one bound — for a shutdown.
 *
 * @param timeoutMs the bound
 * @returns how many entries across them were still unwritten
 */
export async function drainCallThreadJournals({ timeoutMs }: { timeoutMs: number }): Promise<number> {
  const left = await Promise.all([...undrained].map((journal) => journal.drained({ timeoutMs })));
  return left.reduce((sum, n) => sum + n, 0);
}

/**
 * One line per call whose journal still holds entries unwritten, read synchronously — for a shutdown drain that
 * returned, or a process `exit` hook where nothing asynchronous runs, to say per call what is lost.
 *
 * @param when the moment the count was read, as each line names it ("at exit", "after the shutdown drain")
 * @returns the lines, none when every journal is written
 */
export function unwrittenCallThreadLines({ when }: { when: string }): string[] {
  return [...undrained]
    .filter((journal) => journal.unwrittenCount > 0)
    .map(
      (journal) =>
        `talk call-thread (call ${journal.id}): ${String(journal.unwrittenCount)} journal entr(ies) unwritten ${when}`,
    );
}
