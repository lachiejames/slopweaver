/**
 * The shape of the control plane's memory of the sessions it hosts: an entry, the registry, the events the reducer
 * takes and the step it answers, and how a handle addresses an entry. The reducer that moves it is
 * `sessionRegistry.ts`; this module holds no delivery rule.
 */
import type { AppSessionFacts } from "./pictureWire";
import type { AppHarnessDelivery, AppLaunchSpec, AppSessionSnapshot } from "./sessionControlProtocol";
import { APP_SESSION_HANDLE_PREFIX } from "./sessionControlProtocol";
import type { SessionUsageState } from "./sessionUsage";
import type { FromWorker, ToWorker } from "./sessionWorker/workerWire";

/** One hosted session: what the card shows, and the messages held for the turn's end. */
export interface RegistryEntry {
  readonly snapshot: AppSessionSnapshot;
  /** The token a `launch.deliver` or `launch.abort` must present; cleared once the launch is settled. */
  readonly launchToken: string | undefined;
  /** Messages waiting for the running turn to end, in the order they will be sent. */
  readonly pending: readonly string[];
  /** How many of `pending`, from its front, are `now` messages: they go ahead of every `later` one held. */
  readonly urgent: number;
  /** What the session has spent in this run of the app, beside the card rather than on it. */
  readonly usage: SessionUsageState;
  /** Which tools the session has called in this run of the app, as a `picture.read` answers them. */
  readonly facts: AppSessionFacts;
}

/** Every hosted session, by the control plane's id. */
export type SessionRegistry = ReadonlyMap<string, RegistryEntry>;

/** What can happen to a session. */
export type RegistryEvent =
  | {
      readonly kind: "prepared";
      readonly sessionId: string;
      readonly launchToken: string;
      readonly spec: AppLaunchSpec;
      readonly atIso: string;
    }
  | { readonly kind: "launch-settled"; readonly sessionId: string }
  | {
      readonly kind: "message";
      readonly sessionId: string;
      readonly text: string;
      readonly delivery: AppHarnessDelivery;
      readonly atIso: string;
    }
  | { readonly kind: "interrupt"; readonly sessionId: string }
  | { readonly kind: "stopping"; readonly sessionId: string }
  | { readonly kind: "worker"; readonly report: FromWorker; readonly atIso: string }
  | { readonly kind: "gone"; readonly sessionId: string; readonly failed: boolean; readonly atIso: string };

/** One instruction for one session's worker. */
export interface WorkerSend {
  readonly sessionId: string;
  readonly instruction: ToWorker;
}

/** What one event did: the next registry, what to send, and whether a message the caller sent was refused. */
export interface RegistryStep {
  readonly registry: SessionRegistry;
  readonly sends: readonly WorkerSend[];
  /** Set only for a `message` the registry would not take, saying why. */
  readonly refusal?: { readonly code: "SESSION_NOT_FOUND" | "DELIVERY_UNSUPPORTED"; readonly message: string };
  /** Set only for a `message`: whether it cancelled a running turn. */
  readonly interrupted?: boolean;
  /** Set only for a `message`: whether another turn runs before it, rather than it being sent now or next. */
  readonly queued?: boolean;
}

/** The registry before any session. */
export const EMPTY_REGISTRY: SessionRegistry = new Map();

/**
 * The handle a session is addressed by.
 *
 * @param sessionId the control plane's id
 * @returns `app:` and the id
 */
export function appHandleOf({ sessionId }: { sessionId: string }): string {
  return `${APP_SESSION_HANDLE_PREFIX}${sessionId}`;
}

/**
 * The session a handle or a bare id names, when the registry holds it.
 *
 * @param registry the sessions
 * @param handle `app:<id>` or the id itself
 * @returns the entry, or `undefined`
 */
export function entryForHandle({
  registry,
  handle,
}: {
  registry: SessionRegistry;
  handle: string;
}): RegistryEntry | undefined {
  const id = handle.startsWith(APP_SESSION_HANDLE_PREFIX) ? handle.slice(APP_SESSION_HANDLE_PREFIX.length) : handle;
  return registry.get(id);
}

/**
 * The registry with one entry changed, or the same registry when it holds no such session.
 *
 * @param sessionId the entry to change
 * @param change what to make of that entry
 * @returns a new registry carrying the changed entry, or the one given when the id is unknown
 */
export function withEntry({
  registry,
  sessionId,
  change,
}: {
  registry: SessionRegistry;
  sessionId: string;
  change: (entry: RegistryEntry) => RegistryEntry;
}): SessionRegistry {
  const entry = registry.get(sessionId);
  if (entry === undefined) {
    return registry;
  }
  const next = new Map(registry);
  next.set(sessionId, change(entry));
  return next;
}
