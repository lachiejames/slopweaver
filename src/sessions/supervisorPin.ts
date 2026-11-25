/**
 * WHICH live session currently holds the supervisor pin — the scoping fact `../admit/cmuxSendSupervisorGuard.ts`
 * needs and a `PreToolUse` hook cannot afford to ask cmux for.
 *
 * The pin itself lives in cmux (`../cmux/pin.ts`), and reading it means a socket round-trip. A hook that ran
 * one on every `Bash` call would pay that cost hundreds of times a sweep and would block on a transport that
 * is allowed to be down. So the two verbs that MAKE a workspace the pinned supervisor — `cmux pin` and
 * `cmux takeover` — write what they just did to a small file, and the hook reads that file synchronously.
 * The socket stays the authority on the pin; this is a record of the last time a Slopweaver verb moved it.
 * A verb that moves the pin OFF the recorded workspace (`cmux unpin`, `cmux pin --workspace <other>`, a
 * takeover's unpin) removes the record rather than leave it naming a former holder, because the chair gate
 * reads a match here as "this is the chair" while cmux is silent (`../supervisor/chairGate.ts`).
 *
 * **The holder is a host AND an id** (owner: one plan of either provider runs all of Slopweaver, so
 * the chair may be a Codex thread). {@link isRegisteredSupervisor} compares both, exactly: a Claude session id and
 * a Codex thread id are both opaque strings, and the same string under two hosts is two sessions.
 *
 * **A record written before the chair could be Codex still reads**, as the Claude session it always named: the
 * file is read from a `PreToolUse` hook, synchronously and failure-open, so rejecting the old shape would make
 * every guard inert until the next `cmux pin`, and rewriting it on read would turn a hook's read into an
 * unrequested write. The next `cmux pin` or `cmux takeover` writes the canonical shape. A record carrying BOTH
 * shapes is refused: picking one by precedence could bind the guard to the wrong holder.
 *
 * **The scoping is deliberately narrow, and its gap is stated rather than discovered.** A workspace pinned by
 * hand in cmux, or one that held the pin before this record existed, is NOT registered and is therefore NOT
 * guarded — `slopweaver cmux pin` on that workspace registers it. Being unregistered can only ever make the
 * guard inert, never make it block the wrong session, so a successor that has not yet taken over inherits
 * nothing from its predecessor.
 *
 * Pure: text in, a record out. The file lives in `./supervisorPinStore.ts`.
 */
import { isRecord } from "../lib/parsers.js";
import { APP_SESSION_HANDLE_PREFIX } from "../sessionHarness/appProtocol.js";
import {
  parseVisibleSession,
  recordedSupervisorSession,
  type SupervisorSession,
  sameSupervisorSession,
  type VisibleSupervisorSession,
} from "../supervisor/session.js";
import { isBareSessionId } from "./liveSessionStore.js";

/* What both arms carry: the vendor identity holding the pin, and when it was recorded. */
interface SupervisorPinCommon {
  /** The session holding the pin — a Claude Code session or a Codex thread, matched on host and id together. */
  readonly session: VisibleSupervisorSession;
  /** When the pin was recorded. */
  readonly pinnedAtIso: string;
}

/**
 * A pin on a cmux workspace — the shape every record carried before the desktop app could host the chair, read
 * and written byte for byte as it always was. It carries no discriminant field, so an existing file needs no
 * migration; {@link supervisorPinTarget} supplies the discriminant in memory.
 */
export interface CmuxSupervisorPinRecord extends SupervisorPinCommon {
  /** cmux's own id for the pinned workspace. */
  readonly workspaceId: string;
  /** The addressable ref (`workspace:936`), so a human reading the file can open it. */
  readonly workspaceRef: string;
}

/**
 * A pin on a session the desktop app hosts. `appSessionId` is the control plane's id for it, the one the
 * harness addresses as `app:<id>`; the label is derived from it rather than stored, so it cannot disagree.
 */
export interface AppSupervisorPinRecord extends SupervisorPinCommon {
  /** The desktop control plane's id for the hosted session. */
  readonly appSessionId: string;
}

/** The last session a Slopweaver verb pinned as the supervisor, hosted in a cmux workspace or by the desktop app. */
export type SupervisorPinRecord = CmuxSupervisorPinRecord | AppSupervisorPinRecord;

/** Where a pin's holder is hosted — the discriminant product code branches on. */
export type SupervisorPinTarget =
  | { readonly kind: "cmux"; readonly workspaceId: string; readonly workspaceRef: string }
  | { readonly kind: "app"; readonly appSessionId: string };

/** A cmux pin a Claude Code session holds — the only kind a cmux resume of a Claude chair can take. */
export type ClaudeCmuxSupervisorPin = CmuxSupervisorPinRecord & { readonly session: { readonly host: "claude-code" } };

/**
 * Where a pin's holder is hosted, as a discriminated value, so no reader probes the record's fields itself.
 *
 * @returns the cmux workspace or the app session the pin names
 */
export function supervisorPinTarget({ pin }: { pin: SupervisorPinRecord }): SupervisorPinTarget {
  if ("appSessionId" in pin) {
    return { appSessionId: pin.appSessionId, kind: "app" };
  }
  return { kind: "cmux", workspaceId: pin.workspaceId, workspaceRef: pin.workspaceRef };
}

/**
 * The label a reader is shown for where the chair is: the workspace ref for cmux, `app:<id>` for the app.
 *
 * @returns the addressable label of the pinned seat
 */
export function supervisorPinLabel({ pin }: { pin: SupervisorPinRecord }): string {
  const target = supervisorPinTarget({ pin });
  return target.kind === "app" ? `${APP_SESSION_HANDLE_PREFIX}${target.appSessionId}` : target.workspaceRef;
}

/**
 * The pin narrowed to its cmux arm, so a path that reads a workspace can never be handed an app session id.
 *
 * @returns the pin when it names a cmux workspace, else `undefined`
 */
export function cmuxHeldPin({ pin }: { pin: SupervisorPinRecord }): CmuxSupervisorPinRecord | undefined {
  return "appSessionId" in pin ? undefined : pin;
}

/**
 * The cmux workspace the pin names, for a path that protects or finds the chair's workspace. An app-hosted chair
 * sits in no workspace, so it names none, exactly as no pin does.
 *
 * @param pin the recorded pin, or `undefined` when none is recorded
 * @returns cmux's id for the pinned workspace, or `undefined` for no pin or an app pin
 */
export function pinnedCmuxWorkspaceId({ pin }: { pin: SupervisorPinRecord | undefined }): string | undefined {
  if (pin === undefined) {
    return undefined;
  }
  return cmuxHeldPin({ pin })?.workspaceId;
}

/**
 * The pin narrowed to its app arm.
 *
 * @returns the pin when it names a session the desktop app hosts, else `undefined`
 */
export function appHeldPin({ pin }: { pin: SupervisorPinRecord }): AppSupervisorPinRecord | undefined {
  return "appSessionId" in pin ? pin : undefined;
}

/**
 * The pin narrowed to a Claude Code holder in a cmux workspace, so cold-chair recovery (a cmux resume of a
 * Claude session by id) can be handed neither a Codex thread nor an app-hosted session.
 *
 * @returns the pin when a Claude Code session in cmux holds it, else `undefined`
 */
export function claudeCmuxHeldPin({ pin }: { pin: SupervisorPinRecord }): ClaudeCmuxSupervisorPin | undefined {
  const cmux = cmuxHeldPin({ pin });
  if (cmux?.session.host !== "claude-code") {
    return undefined;
  }
  return { ...cmux, session: { host: cmux.session.host, id: cmux.session.id } };
}

function parseAppArm({
  parsed,
  pinnedAtIso,
}: {
  parsed: Readonly<Record<string, unknown>>;
  pinnedAtIso: string;
}): AppSupervisorPinRecord | undefined {
  const appSessionId = parsed["appSessionId"];
  const canonical = parsed["session"];
  const mixed =
    parsed["workspaceId"] !== undefined ||
    parsed["workspaceRef"] !== undefined ||
    parsed["claudeSessionId"] !== undefined;
  if (mixed || canonical === undefined || typeof appSessionId !== "string") {
    return undefined;
  }
  const session = parseVisibleSession({ value: canonical });
  if (session === undefined || !isBareSessionId({ sessionId: appSessionId })) {
    return undefined;
  }
  return { appSessionId, pinnedAtIso, session };
}

/**
 * Parse a supervisor-pin record, refusing anything that is not completely one arm.
 *
 * A partial record is not repaired with defaults: every field here is an identity, and a guessed identity
 * would scope the depth guard onto the wrong session. A blank workspace id is refused too: it is the key a pin
 * move forgets the record by, so a record carrying none could never be invalidated and would vouch for its
 * session as the chair forever. The cmux arm reads exactly as it did before the app arm existed, legacy
 * `claudeSessionId` included. The app arm needs the canonical `session`, a bare app session id and no workspace
 * field; a record carrying an app id beside either workspace field is refused rather than resolved by precedence.
 *
 * @param text the file's contents
 * @returns the record, or `undefined` when the text is absent, malformed, incomplete or mixes two shapes
 */
export function parseSupervisorPin({ text }: { text: string }): SupervisorPinRecord | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) {
    return undefined;
  }
  const pinnedAtIso = parsed["pinnedAtIso"];
  if (typeof pinnedAtIso !== "string") {
    return undefined;
  }
  if (parsed["appSessionId"] !== undefined) {
    return parseAppArm({ parsed, pinnedAtIso });
  }
  const session = recordedSupervisorSession({ record: parsed });
  const workspaceId = parsed["workspaceId"];
  const workspaceRef = parsed["workspaceRef"];
  if (
    session === undefined ||
    typeof workspaceId !== "string" ||
    typeof workspaceRef !== "string" ||
    workspaceId.trim().length === 0
  ) {
    return undefined;
  }
  return { pinnedAtIso, session, workspaceId, workspaceRef };
}

/**
 * Whether a given session is the one recorded as holding the supervisor pin.
 *
 * @param record the parsed registration, or `undefined` when none exists
 * @param session the caller — a hook payload's Claude session, or the detected visible session
 * @returns true only on an exact host-and-id match; a blank id never matches, so a payload missing it is inert
 */
export function isRegisteredSupervisor({
  record,
  session,
}: {
  record: SupervisorPinRecord | undefined;
  session: SupervisorSession;
}): boolean {
  if (record === undefined || session.id.trim().length === 0) {
    return false;
  }
  return sameSupervisorSession({ left: record.session, right: session });
}
