/**
 * The control plane's skeleton: one ledger row per session, written from what the seam DID rather than from what
 * each verb remembers to write. A decorator over any {@link SessionLauncher} and {@link SessionHarness}, so every
 * implementation behind the seam feeds the same one writer — the shape option C asks for ("one writer, fed by every
 * box"; `docs/session-harness.md`).
 *
 * The row lives in the existing session ledger (`$SLOPWEAVER_HOME/sessions/sessions.jsonl`, `../sessions/session.ts`):
 * a `spawned` event opens it, keyed for life by the harness's `sessionId` and labelled by the ledger key, with
 * `openedBy` naming the act; a `closed` event naming that `sessionId` ends it. Not the Postgres store: the store
 * refuses on an outage by design, and a ledger write must never stop a session opening or parking.
 *
 * Three properties are the design:
 *
 * - **A ledger write never changes the act.** A failed append is one warning naming what the ledger lost; the
 *   harness's own result is returned unchanged, and no exit code moves.
 * - **A session parking ITSELF is recorded before the park**, because the process does not outlive closing its own
 *   session; any other session is recorded only off a park that went through, so a held or failed park never
 *   reads closed.
 * - **A failed launch that left a session holding its initial message is recorded**, since that session is real
 *   and may be running the message; any other failed launch leaves no row.
 */
import { CODEX_MODEL } from "../codex/profiles.js";
import { type BootModel, bootModelForSpawn, type SessionEvent, type SessionOpenedBy } from "../sessions/session.js";
import type { HarnessLaunchAddress, HarnessLaunchOperation } from "./errors.js";
import { type HarnessLaunchSpec, launchLeftSessionOpen, type SessionLauncher } from "./launch.js";
import type { HarnessSession, SessionHarness } from "./sessionHarness.js";
import { absorb, describeThrown, settleQuietly } from "./untrustedSettle.js";

/** The ledger effects the decorator writes through — the real session log in production, a collector in a test. */
export interface SessionLedgerDeps {
  /**
   * Append one event. May throw — a filesystem failure — or return a promise that rejects, which the decorator turns
   * into a warning either way; anything it returns is otherwise ignored.
   *
   * @param options the event to append
   * @returns nothing the decorator reads, bar a promise whose rejection it catches
   */
  readonly append: (options: { event: SessionEvent }) => unknown;
  /**
   * The ledger key of the OPEN row this session holds, or `undefined` when the ledger tracks none. May throw — a
   * ledger present and unreadable — which the decorator turns into a warning rather than reading as untracked.
   *
   * @param options the session as the harness reported it
   * @returns the row's key, or `undefined`
   */
  readonly openSessionKey: (options: { session: HarnessSession }) => string | undefined;
  /**
   * The current instant, ISO 8601.
   *
   * @returns the instant
   */
  readonly nowIso: () => string;
  /**
   * Say one thing the ledger lost. May throw or reject; either is swallowed, since there is nowhere left to say it.
   *
   * @param options the line to print
   * @returns nothing the decorator reads, bar a promise whose rejection it swallows
   */
  readonly warn: (options: { message: string }) => unknown;
}

/**
 * Record one row, turning ANY throw on the way — the clock, building the event, the append — into one warning: the
 * act already happened (or, for a session's own park, is about to), and a missing note about it must not undo, block
 * or fail it.
 *
 * @param what the act it records and the row it belongs to, for the warning
 * @param event builds the event to append; called inside the guard, so its own reads are covered too
 */
function recordOrWarn({
  ledger,
  event,
  what,
}: {
  ledger: SessionLedgerDeps;
  event: () => SessionEvent;
  what: string;
}): void {
  // Typed by `settleQuietly`'s `onRejected`, the shape it is handed to.
  const lost: (error: unknown) => void = (error) => {
    warnBestEffort({
      ledger,
      message: () =>
        `session ledger: could not record ${what} (${describeThrown({ error })}) — the act itself went through; the ledger is missing this row`,
    });
  };
  try {
    // An async append rejects rather than throws: caught here too, never left unhandled.
    settleQuietly({ onRejected: lost, returned: callLedger({ args: [{ event: event() }], ledger, name: "append" }) });
  } catch (error: unknown) {
    absorb({ value: error });
    lost(error);
  }
}

/** Whether an address names a session at all: a handle, or an id a row can be bound by. */
function namesASession({ address }: { address: HarnessLaunchAddress }): boolean {
  return address.handle.length > 0 || (address.sessionId !== undefined && address.sessionId.length > 0);
}

/**
 * Warn, and swallow anything that throws on the way — building the message from a hostile thrown value, or a warning
 * sink that itself fails: the act already went through, and neither a lost row nor a broken diagnostic channel may
 * turn it into a failure.
 *
 * @param message builds the warning; called inside the guard, so a thrown value whose own conversion throws is covered
 */
function warnBestEffort({ ledger, message }: { ledger: SessionLedgerDeps; message: () => string }): void {
  try {
    absorb({ value: callLedger({ args: [{ message: message() }], ledger, name: "warn" }) });
  } catch (error: unknown) {
    // Nowhere left to say it: the sink that would carry this is the one that failed.
    absorb({ value: error });
  }
}

/**
 * The model a launch's session actually boots on, as the ledger records it.
 *
 * A Codex seat boots the repository's own pin whatever the spawn's `--model` said — both the cmux boot line
 * (`../cmux/seatRoute.ts`) and the app's launch spec (`./appLaunchSpec.ts`) pass `CODEX_MODEL` — so recording the
 * spec's Claude tier there wrote `pinned: sonnet` for a session running `gpt-*`. A Claude seat boots what the spec
 * pinned, or inherits the saved default when it pinned nothing.
 *
 * @param spec the launch spec, read for its host and its model
 * @returns the boot model to record
 */
export function bootModelForLaunch({ spec }: { spec: HarnessLaunchSpec }): BootModel {
  if (spec.host === "codex") {
    return { kind: "pinned", model: CODEX_MODEL };
  }
  return bootModelForSpawn({ model: spec.model });
}

/**
 * The `spawned` event a launch writes — one new row, keyed by the session's id.
 *
 * @param spec the launch spec
 * @param address the session the launch opened (or left open)
 * @param operation which launch act opened it
 * @param implementation which harness hosts it
 * @param tsIso when it was recorded
 * @returns the event
 */
export function spawnedEventOf({
  spec,
  address,
  operation,
  implementation,
  tsIso,
}: {
  spec: HarnessLaunchSpec;
  address: HarnessLaunchAddress;
  operation: HarnessLaunchOperation;
  implementation: string;
  tsIso: string;
}): SessionEvent {
  const openedBy: SessionOpenedBy = operation;
  return {
    // The last moment anything can say honestly which tier the session booted onto (`../sessions/session.ts`).
    bootModel: bootModelForLaunch({ spec }),
    branch: spec.branch,
    cwd: spec.directory,
    harness: implementation,
    kind: "spawned",
    openedBy,
    sessionKey: spec.ledgerKey,
    surfaceRef: address.endpointHandle,
    tsIso,
    workspaceRef: address.handle,
    ...(spec.slug === undefined ? {} : { slug: spec.slug }),
    // `workspaceId` stays beside `sessionId`: every reader of the ledger today binds a row to its live seat by it.
    ...(address.sessionId === undefined ? {} : { sessionId: address.sessionId, workspaceId: address.sessionId }),
  };
}

/**
 * Wrap a launcher so every session it opens — and every one a failed launch left holding its message — gets its row.
 *
 * @param launcher the implementation's launcher
 * @param ledger where the row is written
 * @param implementation the harness's name, recorded on the row
 * @returns the recording launcher
 */
export function recordingSessionLauncher({
  launcher,
  ledger,
  implementation,
}: {
  launcher: SessionLauncher;
  ledger: SessionLedgerDeps;
  implementation: string;
}): SessionLauncher {
  const recorded =
    ({ operation }: { operation: HarnessLaunchOperation }): SessionLauncher["open"] =>
    async ({ spec, resolveInitialMessage }) => {
      // The act the sent line was resolved for, when a resolver ran: it outranks the act called, because the boot
      // may have moved the state both were read from (`./launch.ts`'s `ResolvedInitialMessage`).
      let resolvedOperation: HarnessLaunchOperation | undefined;
      const launched = await launcher[operation]({
        spec,
        ...(resolveInitialMessage === undefined
          ? {}
          : {
              resolveInitialMessage: () =>
                resolveInitialMessage().map((resolved) => {
                  resolvedOperation = resolved.operation;
                  return resolved;
                }),
            }),
      });
      let openedBy = operation;
      if (resolvedOperation !== undefined) {
        openedBy = resolvedOperation;
      }
      recordLaunch({ implementation, launched, ledger, openedBy, spec });
      return launched;
    };
  return { open: recorded({ operation: "open" }), resume: recorded({ operation: "resume" }) };
}

/**
 * Write the `open` row for a session a caller booted in TWO halves — the boot, then the initial message once its own
 * record exists (`../live/turn/freshSession.ts`) — so no {@link SessionLauncher} ran to record it. The same writer
 * and the same never-fatal guard a launch's row goes through: a failed append is one warning, never a failed open.
 *
 * @param spec the launch spec the session booted from
 * @param address the session the boot opened
 * @param ledger where the row is written
 * @param implementation the harness's name, recorded on the row
 */
export function recordBootedSession({
  spec,
  address,
  ledger,
  implementation,
}: {
  spec: HarnessLaunchSpec;
  address: HarnessLaunchAddress;
  ledger: SessionLedgerDeps;
  implementation: string;
}): void {
  recordOrWarn({
    event: () => spawnedEventOf({ address, implementation, operation: "open", spec, tsIso: ledgerNowIso({ ledger }) }),
    ledger,
    what: `the open for ${spec.ledgerKey}`,
  });
}

/**
 * The recorded session a launch continued and left standing: delivered, or left holding a message it cannot prove
 * arrived. `undefined` for a new session, a resume that left nothing open, or one standing at no id.
 */
function resumedSessionOf({
  launched,
}: {
  launched: Awaited<ReturnType<SessionLauncher["open"]>>;
}): string | undefined {
  if (launched.isOk()) {
    return launched.value.resumed === true ? launched.value.sessionId : undefined;
  }
  const standing = launched.error.resumed === true && launchLeftSessionOpen({ failure: launched.error });
  return standing ? launched.error.opened?.sessionId : undefined;
}

/**
 * Write the row for one launch's outcome: the session it opened, or the one a failed launch left holding its
 * message; nothing otherwise. A session standing at no address it named is warned about, never written.
 */
function recordLaunch({
  implementation,
  launched,
  ledger,
  openedBy,
  spec,
}: {
  implementation: string;
  launched: Awaited<ReturnType<SessionLauncher["open"]>>;
  ledger: SessionLedgerDeps;
  openedBy: HarnessLaunchOperation;
  spec: HarnessLaunchSpec;
}): void {
  const resumedId = resumedSessionOf({ launched });
  if (resumedId !== undefined) {
    // The session its open row already records, continued: that row moves, and no second row opens beside it.
    recordOrWarn({
      event: () => ({
        kind: "resumed",
        sessionId: resumedId,
        sessionKey: spec.ledgerKey,
        tsIso: ledgerNowIso({ ledger }),
      }),
      ledger,
      what: `the resume of ${spec.ledgerKey}`,
    });
    return;
  }
  let address: HarnessLaunchAddress | undefined;
  let sessionStands = false;
  if (launched.isOk()) {
    const { endpointHandle, handle, sessionId } = launched.value;
    address = { endpointHandle, handle, sessionId };
    sessionStands = true;
  } else if (launchLeftSessionOpen({ failure: launched.error })) {
    address = launched.error.opened;
    sessionStands = true;
  }
  if (sessionStands && (address === undefined || !namesASession({ address }))) {
    // A session stands but the launcher named no address for it, and a row is keyed by one: say the ledger lost
    // it rather than skip it, or write a row naming nothing. cmux always names the workspace it opened.
    warnBestEffort({
      ledger,
      message: () =>
        `session ledger: could not record the ${openedBy} for ${spec.ledgerKey} (the launch left a session at no address it named) — the ledger is missing this row`,
    });
  } else if (address !== undefined) {
    const opened = address;
    recordOrWarn({
      event: () =>
        spawnedEventOf({ address: opened, implementation, operation: openedBy, spec, tsIso: ledgerNowIso({ ledger }) }),
      ledger,
      what: `the ${openedBy} for ${spec.ledgerKey}`,
    });
  }
}

/**
 * Call one ledger member — the ONLY way this module touches the ledger object, so every member read and every value it
 * answers is untrusted whatever its declared type. A member that is not a function (a getter answering a rejecting
 * promise, say) throws here, inside the caller's guard, with what it answered settled on our own promise so a
 * rejection is never left unhandled. Every call site sits inside `recordOrWarn`, `warnBestEffort` or the park's read
 * guard.
 *
 * @param name which member
 * @param args what it is called with, its declared parameters
 * @returns whatever it answered, as `unknown`
 */
function callLedger({
  ledger,
  name,
  args,
}: {
  ledger: SessionLedgerDeps;
  name: keyof SessionLedgerDeps;
  args: readonly unknown[];
}): unknown {
  const member: unknown = ledger[name];
  if (typeof member !== "function") {
    absorb({ value: member });
    throw new TypeError(`the ledger's ${name} is a ${typeof member}, not a function`);
  }
  return Reflect.apply(member, ledger, args);
}

/**
 * A string a ledger dependency answered, checked as `unknown`: one answering past its type (an object with a throwing
 * coercion, a promise) throws HERE, inside the caller's guard, never later where the value is spelled into the warning
 * or the row. A promise or thenable answered is refused like any other non-string, its rejection swallowed on our own
 * promise rather than left unhandled to end the process.
 *
 * @param reported what the dependency answered
 * @param what what it was asked for, for the refusal
 */
function answeredString({ reported, what }: { reported: unknown; what: string }): string {
  if (typeof reported !== "string") {
    absorb({ value: reported });
    throw new TypeError(`the ledger answered a ${typeof reported}, not ${what}`);
  }
  return reported;
}

/** The ledger's clock, checked by `answeredString`. */
function ledgerNowIso({ ledger }: { ledger: SessionLedgerDeps }): string {
  return answeredString({ reported: callLedger({ args: [], ledger, name: "nowIso" }), what: "a timestamp" });
}

/** The ledger's open-row key for a session, checked by `answeredString`; `undefined` when it holds no open row. */
function readOpenSessionKey({
  ledger,
  session,
}: {
  ledger: SessionLedgerDeps;
  session: HarnessSession;
}): string | undefined {
  const reported = callLedger({ args: [{ session }], ledger, name: "openSessionKey" });
  if (reported === undefined) {
    return undefined;
  }
  return answeredString({ reported, what: "a session key" });
}

/**
 * Wrap a harness so every park writes its row's close: before the park for the caller's own session, after a park
 * that went through for any other. Every other operation passes straight through.
 *
 * @param harness the implementation's harness
 * @param ledger where the row is written
 * @param callerSessionId the session the calling process runs in, when it runs in one
 * @returns the recording harness
 */
export function recordingSessionHarness({
  harness,
  ledger,
  callerSessionId,
}: {
  harness: SessionHarness;
  ledger: SessionLedgerDeps;
  callerSessionId: string | undefined;
}): SessionHarness {
  const recordClosed = ({ session: parkedSession }: { session: HarnessSession }): void => {
    // The ledger is handed a frozen COPY: the object being parked, and returned, is never one it can write to.
    const session: HarnessSession = Object.freeze({ ...parkedSession });
    let sessionKey: string | undefined;
    try {
      sessionKey = readOpenSessionKey({ ledger, session });
    } catch (error: unknown) {
      // A ledger that exists and cannot be read is not one that tracks nothing: say what it lost.
      absorb({ value: error });
      warnBestEffort({
        ledger,
        message: () =>
          `session ledger: could not read it to record the park of ${session.handle} (${describeThrown({ error })}) — the act itself went through; the ledger may be missing this row's close`,
      });
      return;
    }
    if (sessionKey === undefined) {
      return;
    }
    const key = sessionKey;
    recordOrWarn({
      event: () => ({
        kind: "closed",
        sessionId: session.id,
        sessionKey: key,
        tsIso: ledgerNowIso({ ledger }),
        workspaceRef: session.handle,
      }),
      ledger,
      what: `the park for ${key}`,
    });
  };
  return {
    ...harness,
    park: async ({ target, mode }) => {
      const own = target.session.id === callerSessionId;
      if (own) {
        recordClosed({ session: target.session });
      }
      const parked = await harness.park({ mode, target });
      if (!own && parked.isOk() && parked.value.kind === "parked") {
        recordClosed({ session: parked.value.session });
      }
      return parked;
    },
  };
}
