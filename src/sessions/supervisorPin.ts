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
import {
  recordedSupervisorSession,
  type SupervisorSession,
  sameSupervisorSession,
  type VisibleSupervisorSession,
} from "../supervisor/session.js";

/** The last workspace a Slopweaver verb pinned as the supervisor, and the visible session inside it. */
export interface SupervisorPinRecord {
  /** The session holding the pin — a Claude Code session or a Codex thread, matched on host and id together. */
  readonly session: VisibleSupervisorSession;
  /** cmux's own id for the pinned workspace. */
  readonly workspaceId: string;
  /** The addressable ref (`workspace:936`), so a human reading the file can open it. */
  readonly workspaceRef: string;
  /** When the pin was recorded. */
  readonly pinnedAtIso: string;
}

/** A pin a Claude Code session holds — the only kind whose id a Claude registry, transcript or resume can take. */
export type ClaudeSupervisorPin = SupervisorPinRecord & { readonly session: { readonly host: "claude-code" } };

/**
 * The pin narrowed to a Claude Code holder, so a path that resumes or matches a Claude session by id cannot be
 * handed a Codex thread's.
 *
 * @returns the pin when a Claude Code session holds it, else `undefined`
 */
export function claudeHeldPin({ pin }: { pin: SupervisorPinRecord }): ClaudeSupervisorPin | undefined {
  const { session } = pin;
  return session.host === "claude-code" ? { ...pin, session: { host: session.host, id: session.id } } : undefined;
}

/**
 * Parse a supervisor-pin record, refusing anything that is not completely one.
 *
 * A partial record is not repaired with defaults: every field here is an identity, and a guessed identity
 * would scope the depth guard onto the wrong session. A blank workspace id is refused too: it is the key a pin
 * move forgets the record by, so a record carrying none could never be invalidated and would vouch for its
 * session as the chair forever.
 *
 * @param text the file's contents
 * @returns the record, or `undefined` when the text is absent, malformed, incomplete or carries both shapes
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
  const session = recordedSupervisorSession({ record: parsed });
  const workspaceId = parsed["workspaceId"];
  const workspaceRef = parsed["workspaceRef"];
  const pinnedAtIso = parsed["pinnedAtIso"];
  if (
    session === undefined ||
    typeof workspaceId !== "string" ||
    typeof workspaceRef !== "string" ||
    typeof pinnedAtIso !== "string" ||
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
