import { isAbsolute } from "node:path";

import { isBareSessionId } from "../sessions/liveSessionStore.js";

/**
 * The environment variables the supported visible supervisor hosts expose.
 *
 * Measured on a real machine: `CLAUDE_CODE_SESSION_ID`'s value was byte-identical to the
 * `sessionId` the fleet driver had recorded in the `launched` entry for the run that session was executing.
 * That correspondence is the whole mechanism — without it the variable would be an identifier for nothing.
 */
export const CLAUDE_CODE_SESSION_ID_ENV = "CLAUDE_CODE_SESSION_ID";
export const CODEX_THREAD_ID_ENV = "CODEX_THREAD_ID";
/**
 * The Codex account home a Codex process runs under — where its thread's rollout is written. Recorded on a Codex
 * chair's pin and chain link so the owner-turn reader opens THAT home's rollout, never a guessed `~/.codex`.
 */
export const CODEX_HOME_ENV = "CODEX_HOME";
/**
 * A visible host that can own a Slopweaver turn.
 *
 * `explicit` is the NAMED boundary: a session reference supplied rather than detected, with no model behind
 * it. Two live shapes reach it — `turn`'s `--session-url`, which names the session by hand
 * (`cli/commands/turn/postAnswer.ts`, `cardGates.ts`), and a verb acting as itself rather than as a session
 * (`turn dispatch --sweep` in `abandoned.ts`, the no-response and ignore indicators).
 */
export type SupervisorHost = "claude-code" | "codex" | "explicit";

/**
 * The two REAL model-backed hosts a fresh visible session or a native subagent can run on — narrower than
 * {@link SupervisorHost}, which also carries `explicit` for a boundary that has no model behind it at all.
 */
export type VisibleSessionHost = "claude-code" | "codex";

/** Opaque supervisor identity. It proves a visible session exists; it is not a shareable deep link. */
export interface SupervisorSession {
  readonly host: SupervisorHost;
  readonly id: string;
}

/**
 * A {@link SupervisorSession} with a model behind it — a Claude Code session or a Codex thread, never `explicit`.
 * What a pin, a chain link or an owner-turn receipt is keyed by: each names a session whose transcript exists.
 */
export type VisibleSupervisorSession = SupervisorSession & { readonly host: VisibleSessionHost };

/**
 * Whether two sessions are the same one. The HOST is half the identity: a Claude session id and a Codex thread id
 * are both opaque strings, and the same string under two hosts names two different sessions — so a Claude hook
 * payload can never vouch for a Codex chair by coincidence of id.
 *
 * @param left one session
 * @param right the other
 * @returns true only when both the host and the exact id match
 */
export function sameSupervisorSession({ left, right }: { left: SupervisorSession; right: SupervisorSession }): boolean {
  return left.host === right.host && left.id === right.id;
}

/**
 * The one string a map keys a session by. Reversible, so collision-free: the host is a closed set none of whose
 * members contains `:`, so everything after the FIRST colon is the id, whatever the id itself contains.
 *
 * @param session the session to key
 * @returns `<host>:<id>`
 */
export function supervisorSessionKey({ session }: { session: SupervisorSession }): string {
  return `${session.host}:${session.id}`;
}

/**
 * How a session reads in a printed line: a Claude session by its bare id, exactly as every line printed before a
 * chair could be Codex named it, and any other host by its {@link supervisorSessionKey}, so a Codex thread id can
 * never pass for a Claude session's.
 *
 * @param session the session to print
 * @returns the bare id for Claude Code, else `<host>:<id>`
 */
export function supervisorSessionLabel({ session }: { session: SupervisorSession }): string {
  if (session.host === "claude-code") {
    return session.id;
  }
  return supervisorSessionKey({ session });
}

/**
 * The id a Claude Code registry, transcript or `claude --resume` can be handed, which only a Claude session has: a
 * Codex thread id handed to one of those would match whichever Claude session happens to share the string.
 *
 * @param session the recorded session, or none
 * @returns the id when the session is Claude Code's, else `undefined`
 */
export function claudeSessionIdOf({ session }: { session: SupervisorSession | undefined }): string | undefined {
  return session?.host === "claude-code" ? session.id : undefined;
}

/**
 * Narrow a session to a visible one.
 *
 * An id outside a UUID's letters, digits and dashes is refused here, where every pin, chain line and receipt is
 * decoded, so no reader downstream can join a recorded id into a path that leaves `~/.claude/projects` (an unchecked
 * `cmux reseat` would join a pin's id straight into a transcript path).
 *
 * @param value an unknown value read from disk
 * @returns the session when it is `{ host: "claude-code" | "codex", id: <bare id> }`, else undefined
 */
export function parseVisibleSession({ value }: { value: unknown }): VisibleSupervisorSession | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const host: unknown = Reflect.get(value, "host");
  const id: unknown = Reflect.get(value, "id");
  if ((host !== "claude-code" && host !== "codex") || typeof id !== "string" || !isBareSessionId({ sessionId: id })) {
    return undefined;
  }
  return { host, id };
}

/**
 * The holder a persisted record names — the pin, a chain line, a receipt: the canonical `session`, or a record
 * written before the chair could be Codex, whose `claudeSessionId` reads as the Claude session it always named.
 *
 * A record carrying BOTH shapes is refused rather than resolved by precedence: picking one could attribute it to
 * the wrong holder. Nothing is rewritten here — the next canonical write replaces an old record.
 *
 * @param record the decoded record
 * @returns the session, or undefined when neither shape is complete or both are present
 */
export function recordedSupervisorSession({
  record,
}: {
  record: Readonly<Record<string, unknown>>;
}): VisibleSupervisorSession | undefined {
  const claudeSessionId = record["claudeSessionId"];
  const canonical = record["session"];
  if (claudeSessionId !== undefined && canonical !== undefined) {
    return undefined;
  }
  if (canonical !== undefined) {
    return parseVisibleSession({ value: canonical });
  }
  if (typeof claudeSessionId !== "string" || !isBareSessionId({ sessionId: claudeSessionId })) {
    return undefined;
  }
  return { host: "claude-code", id: claudeSessionId };
}

/**
 * The result of inspecting the current process for a visible supervisor. A Codex session carries the absolute
 * `CODEX_HOME` it runs under when the process names one; with none (or a relative one) it is absent, so a pin
 * recorded from it reads as a chair whose home is unrecorded rather than one a reader would guess.
 */
export type SupervisorSessionDetection =
  | { readonly kind: "active"; readonly session: VisibleSupervisorSession; readonly codexHome?: string }
  | { readonly kind: "missing" }
  | { readonly kind: "ambiguous"; readonly sessions: readonly [VisibleSupervisorSession, VisibleSupervisorSession] };

function nonBlank({ value }: { value: string | undefined }): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}

/**
 * Detect the visible supervisor without guessing when two harnesses have leaked into one process.
 *
 * @param env the process environment
 * @returns one active host, no host, or both hosts as an ambiguity the caller must refuse
 */
export function detectSupervisorSession({
  env,
}: {
  env: Readonly<Record<string, string | undefined>>;
}): SupervisorSessionDetection {
  const claudeId = nonBlank({ value: env[CLAUDE_CODE_SESSION_ID_ENV] });
  const codexId = nonBlank({ value: env[CODEX_THREAD_ID_ENV] });
  if (claudeId !== undefined && codexId !== undefined) {
    return {
      kind: "ambiguous",
      sessions: [
        { host: "claude-code", id: claudeId },
        { host: "codex", id: codexId },
      ],
    };
  }
  if (claudeId !== undefined) {
    return { kind: "active", session: { host: "claude-code", id: claudeId } };
  }
  if (codexId !== undefined) {
    const codexHome = nonBlank({ value: env[CODEX_HOME_ENV] });
    const recorded = codexHome !== undefined && isAbsolute(codexHome) ? { codexHome } : {};
    return { kind: "active", session: { host: "codex", id: codexId }, ...recorded };
  }
  return { kind: "missing" };
}

/**
 * Whether a recorded Codex home is one a reader may open: a non-blank absolute path. A relative one would resolve
 * against whichever directory the reader happened to run in.
 *
 * @param value the recorded value
 * @returns true for a non-blank absolute path string
 */
export function isRecordableCodexHome({ value }: { value: unknown }): boolean {
  return typeof value === "string" && value.trim() === value && value.length > 0 && isAbsolute(value);
}

/**
 * The session a `--session` flag names: a bare id is a Claude Code session, as every flag typed before a chair could
 * be Codex meant, and `claude-code:<id>` or `codex:<id>` names the host outright — the same spelling
 * {@link supervisorSessionLabel} prints.
 *
 * @param text the flag's value
 * @returns the session, or `undefined` for an unknown host prefix or an id that is not a bare session id
 */
export function parseSupervisorSessionLabel({ text }: { text: string }): VisibleSupervisorSession | undefined {
  const trimmed = text.trim();
  const colon = trimmed.indexOf(":");
  if (colon === -1) {
    return isBareSessionId({ sessionId: trimmed }) ? { host: "claude-code", id: trimmed } : undefined;
  }
  return parseVisibleSession({ value: { host: trimmed.slice(0, colon), id: trimmed.slice(colon + 1) } });
}

/**
 * The provenance label Slack renders for a turn composed by this visible session.
 *
 * @param session the visible session that composed the turn
 * @returns a host-specific label without exposing its opaque id
 */
export function supervisorModelLabel({ session }: { session: SupervisorSession }): string {
  if (session.host === "claude-code") {
    return "the supervisor session (Claude Code, in-turn)";
  }
  if (session.host === "codex") {
    return "the supervisor session (Codex, in-turn)";
  }
  return "the supervisor session (explicit, in-turn)";
}

/**
 * The provenance label Slack renders for a turn composed by a DISPATCHED WORKER — the session `turn dispatch`
 * opened for one ask, which is the session that actually did the work.
 *
 * {@link supervisorModelLabel} is not that. It is derived from whichever host's session variable is set in
 * the current process, and it says "the supervisor session" whoever that is — so a card posted by a worker
 * read as though the pinned supervisor chat had composed it. Measured on a posted card: the
 * loop had dispatched a worker, and the card named the supervisor. The label is a
 * provenance claim, and a provenance claim naming the wrong session is simply false.
 *
 * The workspace ref is what makes it checkable — it is the same ref `turn dispatch` printed, the same one the
 * reviewer packet names the author by (`live/turn/review.ts`'s `reviewPartyName`), and it can be opened.
 *
 * @param host which visible CLI the worker was booted onto
 * @param workspaceRef the worker's own cmux workspace ref
 * @returns the provenance label naming that worker
 */
export function dispatchedWorkerLabel({
  host,
  workspaceRef,
}: {
  host: VisibleSessionHost;
  workspaceRef: string;
}): string {
  return `the dispatched worker in ${workspaceRef} (${host === "codex" ? "Codex" : "Claude Code"}, in-turn)`;
}

/**
 * Human-readable refusal for the two non-active detector outcomes.
 *
 * @param detection the missing or ambiguous result to explain
 * @returns the actionable refusal text
 */
export function supervisorSessionProblem({
  detection,
}: {
  detection: Exclude<SupervisorSessionDetection, { kind: "active" }>;
}): string {
  if (detection.kind === "ambiguous") {
    return (
      `both ${CLAUDE_CODE_SESSION_ID_ENV} and ${CODEX_THREAD_ID_ENV} are set, so the visible supervisor is ambiguous. ` +
      "Run from one host without inheriting the other host's session variable."
    );
  }
  return (
    `neither ${CLAUDE_CODE_SESSION_ID_ENV} nor ${CODEX_THREAD_ID_ENV} is set, so no visible supervisor session was found. ` +
    "Start this command inside Claude Code or Codex."
  );
}
