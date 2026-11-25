/**
 * The effectful edge of the chair gate: find the pinned supervisor workspace, the Claude sessions live inside
 * it, and the tail of each one's transcript.
 *
 * The route is the one `session standing` already walks for the supervisor's plugin-dir — pin and exact title,
 * then the workspace's process tree — joined to Claude Code's own session registry (`~/.claude/sessions/<pid>.json`)
 * by pid, then to the transcript by session id. Only the tail is read: the newest assistant turn is what decides,
 * and `DEPTH_TAIL_BYTES` is the margin `session depth` measured for finding one. The registry join is
 * `./chairRecords.ts`; this file is the cmux walk and the caller's own read.
 *
 * Every judgement is in `./chairModel.ts` and `./chairGate.ts`.
 */
import { homedir } from "node:os";
import { join } from "node:path";

import type { CmuxError } from "../cmux/errors.js";
import { readProcessStarts } from "../fleet/processStarts.js";
import { resolveSupervisorWorkspace } from "../live/standing/supervisor.js";
import { verifyAppSessionOrigin } from "../sessionHarness/appSessionOrigin.js";
import { APP_SOCKET_ROOT, type AppTransport, socketAppTransport } from "../sessionHarness/appSocketTransport.js";
import { type CmuxHostSurface, withCmuxSessionHost } from "../sessionHarness/cmuxHost.js";
import type { SessionHarnessError } from "../sessionHarness/errors.js";
import { reportedTabPids } from "../sessions/liveInTab.js";
import { readTail, transcriptPathFor } from "../sessions/liveSessionStore.js";
import {
  type AppSupervisorPinRecord,
  appHeldPin,
  isRegisteredSupervisor,
  type SupervisorPinRecord,
  supervisorPinLabel,
} from "../sessions/supervisorPin.js";
import { DEPTH_TAIL_BYTES } from "../sessions/tokenDepth.js";
import type { CallerChairReading, CallerPinBinding, ChairRead, ChairUnresolvedCause } from "./chairGate.js";
import { judgeChairTranscript } from "./chairModel.js";
import {
  type ChairSessionIds,
  type ReadProcessStarts,
  readBoundChairSessionIds,
  readBoundChairSessions,
} from "./chairRecords.js";
import { readRecordedChairHost, UNRESOLVED_CHAIR_RECORD } from "./recordedChairHost.js";
import { supervisorSessionLabel } from "./session.js";

/** Why a Codex-held chair reads no Claude chair: no Claude tab in the pinned workspace is the chair then. */
export const CODEX_PIN_HAS_NO_CLAUDE_CHAIR =
  "the recorded chair is a Codex thread, so no Claude session in the pinned workspace is the chair";

/**
 * Claude Code's own config directory: `CLAUDE_CONFIG_DIR` when set, else `~/.claude`.
 *
 * The variable moves the session registry with it — MEASURED on Claude Code
 * 2.1.289: a seat booted with `CLAUDE_CONFIG_DIR=<dir>` wrote `<dir>/sessions/<pid>.json` and nothing under
 * `~/.claude/sessions`, so a reader pinned to `~/.claude` called that live seat dead (`cmux reseat` refused it
 * `NO_LIVE_SESSION`). Fleet seats are booted without it, so for them this is `~/.claude` exactly as before.
 *
 * @returns its absolute path
 */
export function claudeHomeDir(): string {
  const configured = process.env["CLAUDE_CONFIG_DIR"];
  if (configured !== undefined && configured.trim() !== "") {
    return configured.trim();
  }
  return join(homedir(), ".claude");
}

/**
 * Judge the CALLER's own Claude session by its id, through its transcript alone — no cmux call, no registry.
 *
 * The chair gate's read when cmux itself does not answer (`./chairGate.ts` § "When cmux does not answer"): the
 * pinned workspace cannot be listed then, but the session asking can still be read, because Claude Code hands
 * it its own id and the transcript is a file. The supervisor-pin record is what binds that id to the chair.
 *
 * @param sessionId the caller's `CLAUDE_CODE_SESSION_ID`
 * @param claudeHome the resolved `~/.claude`
 * @param pin the supervisor-pin record, undefined when none is recorded or it would not read
 * @returns the caller's verdict, unreadable when no transcript was found or it would not read, and whether the pin
 *   record names it
 */
export function readCallerChairSession({
  sessionId,
  claudeHome,
  pin,
}: {
  sessionId: string;
  claudeHome: string;
  pin: SupervisorPinRecord | undefined;
}): CallerChairReading {
  const binding = callerPinBinding({ pin, sessionId });
  const path = transcriptPathFor({ projectsDir: join(claudeHome, "projects"), sessionId });
  if (path === undefined) {
    return {
      pin: binding,
      sessionId,
      verdict: { kind: "unreadable", why: "no transcript was found for this session" },
    };
  }
  try {
    return {
      pin: binding,
      sessionId,
      verdict: judgeChairTranscript({ text: readTail({ maxBytes: DEPTH_TAIL_BYTES, path }) }),
    };
  } catch (error: unknown) {
    return {
      pin: binding,
      sessionId,
      verdict: { kind: "unreadable", why: `its transcript could not be read (${String(error)})` },
    };
  }
}

/**
 * Whether the supervisor-pin record names this session.
 *
 * @param pin the record, undefined when none is recorded
 * @param sessionId the caller's own session id
 * @returns holder on an exact match, else the session the record names, else unrecorded
 */
function callerPinBinding({
  pin,
  sessionId,
}: {
  pin: SupervisorPinRecord | undefined;
  sessionId: string;
}): CallerPinBinding {
  if (pin === undefined) {
    return { kind: "unrecorded" };
  }
  if (isRegisteredSupervisor({ record: pin, session: { host: "claude-code", id: sessionId } })) {
    return { kind: "holder" };
  }
  return {
    holderSessionId: supervisorSessionLabel({ session: pin.session }),
    kind: "other",
    seatLabel: supervisorPinLabel({ pin }),
  };
}

/** The pinned workspace and every pid cmux reports for it, attributed or listed, or why there was none to read. */
type PinnedChairPids =
  | {
      readonly kind: "resolved";
      readonly workspaceId: string;
      readonly workspaceCwd: string;
      readonly pids: readonly number[];
    }
  | { readonly kind: "unresolved"; readonly cause: ChairUnresolvedCause; readonly why: string };

/**
 * Whether a failed cmux call was SILENCE or an answer.
 *
 * Only a timeout or an unreachable socket is cmux not answering. An error frame, a malformed reply or a
 * transient screen-read refusal is cmux answering, so the chair stays unresolved for a reason the caller's own
 * transcript cannot stand in for. A harness failure (the inventory, read through the seam) carries cmux's own
 * code as `causeCode`, so the same two codes decide it.
 *
 * @param error the cmux call's, or the harness's, typed failure
 * @returns the unresolved read's cause
 */
function unresolvedCauseOf({ error }: { error: CmuxError | SessionHarnessError }): ChairUnresolvedCause {
  let code: string = error.code;
  if (error.code === "HARNESS_UNAVAILABLE" || error.code === "HARNESS_OPERATION_FAILED") {
    code = error.causeCode;
  }
  if (code === "TIMEOUT" || code === "SOCKET_UNAVAILABLE") {
    return "cmux-unanswered";
  }
  return "cmux-error";
}

/**
 * Find the pinned supervisor workspace and its pids through the two cmux calls it needs — the walk every chair
 * read shares, whatever it then asks of the sessions it finds.
 *
 * The pids are every one cmux REPORTED for the tab, attributed or listed (`reportedTabPids`): cmux 0.65.2 can
 * attribute nothing to a tab whose session runs and list its processes in `unattributed_tty_process_pids` instead.
 * MEASURED (`SLOPWEAVER_ALLOW_RAW=1 cmux rpc system.top '{"include_processes":true,"workspace_id":"<pinned
 * ref>"}'`): the pinned chair read `processes: []` and listed `[login, -zsh, -zsh, claude, trajectory]`, the chair's
 * own pid among them, so the attributed tree alone printed "chair plan UNREAD" on every gauge and tick while it ran
 * A listed `login` or shell joins no registry record, so only Claude sessions survive.
 *
 * @param client the cmux workspace listing and workspace-top calls
 * @returns the pinned workspace and its pids, or why there was none to read
 */
async function readPinnedPidsThrough({
  client,
}: {
  client: Pick<CmuxHostSurface, "listWorkspaces" | "workspaceTop">;
}): Promise<PinnedChairPids> {
  const listed = await client.listWorkspaces();
  if (listed.isErr()) {
    return {
      cause: unresolvedCauseOf({ error: listed.error }),
      kind: "unresolved",
      why: `cmux workspaces could not be listed (${listed.error.message})`,
    };
  }
  const pinned = resolveSupervisorWorkspace({ workspaces: listed.value });
  if (pinned.value === undefined) {
    return { cause: "no-chair", kind: "unresolved", why: pinned.problems.join("; ") };
  }
  const top = await client.workspaceTop({ workspaceId: pinned.value.workspaceId });
  if (top.isErr()) {
    return {
      cause: unresolvedCauseOf({ error: top.error }),
      kind: "unresolved",
      why: `the pinned workspace's process tree could not be read (${top.error.message})`,
    };
  }
  return {
    kind: "resolved",
    pids: [...reportedTabPids({ report: top.value })],
    workspaceCwd: pinned.value.currentDirectory,
    workspaceId: pinned.value.workspaceId,
  };
}

/**
 * Read the pinned supervisor chair through the two cmux calls it needs — split from the connection so a test
 * passes a plain fake client.
 *
 * @param client the cmux workspace listing and workspace-top calls
 * @param claudeHome the resolved `~/.claude`
 * @param readStarts the process table's start stamp per pid, read once the workspace resolves; `readProcessStarts`
 *   in production, a plain fake in a test
 * @returns the pinned workspace's sessions and their verdicts, or why there was no workspace to read
 */
export async function readChairThrough({
  client,
  claudeHome,
  readStarts,
}: {
  client: Pick<CmuxHostSurface, "listWorkspaces" | "workspaceTop">;
  claudeHome: string;
  readStarts: ReadProcessStarts;
}): Promise<ChairRead> {
  const pinned = await readPinnedPidsThrough({ client });
  if (pinned.kind === "unresolved") {
    return pinned;
  }
  const judged = readBoundChairSessions({ claudeHome, pids: pinned.pids, readStarts });
  if (judged.kind === "unresolved") {
    return judged;
  }
  return {
    directory: pinned.workspaceCwd,
    kind: "resolved",
    location: { kind: "cmux", workspaceId: pinned.workspaceId },
    sessions: judged.sessions,
  };
}

/**
 * List the pinned chair's live Claude sessions over one cmux connection, for a reader that needs each session's
 * pid rather than its transcript — `claude gauge`'s chair mark reads the process, never the model.
 *
 * A recorded Codex chair (`readRecordedChairHost`), or records too damaged to name one, is unread, never resolved:
 * the pinned workspace's Claude tabs are not the chair then, and reporting one's plan would read a Codex chair
 * through an unrelated Claude session.
 *
 * @param claudeHome the resolved `~/.claude`
 * @param home the Slopweaver home whose pin or chain journal names the chair's host
 * @returns the sessions, or why the chair could not be read
 */
export async function readPinnedChairSessionIds({
  claudeHome,
  home,
}: {
  claudeHome: string;
  home: string;
}): Promise<ChairSessionIds> {
  const host = readRecordedChairHost({ home });
  if (host === "codex") {
    return { kind: "unresolved", why: CODEX_PIN_HAS_NO_CLAUDE_CHAIR };
  }
  if (host === "unresolved") {
    return { kind: "unresolved", why: UNRESOLVED_CHAIR_RECORD };
  }
  try {
    return await withCmuxSessionHost<ChairSessionIds>({
      body: async ({ host: client }) => {
        const pinned = await readPinnedPidsThrough({ client });
        if (pinned.kind === "unresolved") {
          return { kind: "unresolved", why: pinned.why };
        }
        return readBoundChairSessionIds({ claudeHome, pids: pinned.pids, readStarts: readProcessStarts });
      },
    });
  } catch (error: unknown) {
    return { kind: "unresolved", why: `cmux could not be reached (${String(error)})` };
  }
}

/**
 * Read a chair the desktop app hosts: the app vouches that the pinned app session is live, is Claude's, and runs
 * exactly the vendor session the pin names (`session.origin`, the same binding `cmux pin` checks), and then that
 * session's own transcript is judged. One app session is one vendor session, so the cmux rule of judging every tab in
 * the workspace has nothing to apply to here.
 *
 * Every way this cannot see is `app-chair-unread` and refuses. It is never `cmux-unanswered`: that cause alone opens
 * the caller-only pass, and an app that does not answer must not open it.
 *
 * @param pin the app arm of the supervisor-pin record
 * @param claudeHome the resolved `~/.claude`
 * @param transport the app's control-plane channel: the socket in production, a plain fake in a test
 * @returns the one session and its verdict, or why the app chair could not be read
 */
export async function readAppChairThrough({
  pin,
  claudeHome,
  transport,
}: {
  pin: AppSupervisorPinRecord;
  claudeHome: string;
  transport: AppTransport;
}): Promise<ChairRead> {
  const label = supervisorPinLabel({ pin });
  if (pin.session.host !== "claude-code") {
    return { cause: "codex-chair", kind: "unresolved", why: `${label}: ${CODEX_PIN_HAS_NO_CLAUDE_CHAIR}` };
  }
  const vouched = await verifyAppSessionOrigin({
    claim: { appSessionId: pin.appSessionId, session: pin.session },
    transport,
  });
  if (vouched.isErr()) {
    return {
      cause: "app-chair-unread",
      kind: "unresolved",
      why: `the desktop app did not vouch for the pinned chair ${label} (${vouched.error.message})`,
    };
  }
  const caller = readCallerChairSession({ claudeHome, pin, sessionId: pin.session.id });
  if (caller.verdict.kind === "unreadable") {
    return {
      cause: "app-chair-unread",
      kind: "unresolved",
      why: `the pinned chair ${label} is live, but ${caller.verdict.why}`,
    };
  }
  return {
    directory: vouched.value.session.directory,
    kind: "resolved",
    location: { appSessionId: pin.appSessionId, kind: "app" },
    sessions: [{ pid: undefined, sessionId: pin.session.id, verdict: caller.verdict }],
  };
}

/**
 * Read the chair wherever the supervisor-pin record says it is hosted: the app arm through the desktop app, anything
 * else — a cmux pin, or no record at all — through the cmux walk exactly as before the app arm existed.
 *
 * @param claudeHome the resolved `~/.claude`
 * @param pin the supervisor-pin record, `undefined` when none is recorded or it would not read
 * @returns the chair read
 */
export async function readChairForPin({
  claudeHome,
  pin,
}: {
  claudeHome: string;
  pin: SupervisorPinRecord | undefined;
}): Promise<ChairRead> {
  const app = pin === undefined ? undefined : appHeldPin({ pin });
  if (app === undefined) {
    return readPinnedChair({ claudeHome });
  }
  return readAppChairThrough({ claudeHome, pin: app, transport: socketAppTransport({ root: APP_SOCKET_ROOT }) });
}

/**
 * Read the pinned supervisor chair over one cmux connection.
 *
 * @param claudeHome the resolved `~/.claude`
 * @returns the pinned workspace's sessions and their verdicts, or why there was no workspace to read
 */
async function readPinnedChair({ claudeHome }: { claudeHome: string }): Promise<ChairRead> {
  try {
    return await withCmuxSessionHost<ChairRead>({
      body: ({ host }) => readChairThrough({ claudeHome, client: host, readStarts: readProcessStarts }),
    });
  } catch (error: unknown) {
    // A socket that will not open comes back as a typed SOCKET_UNAVAILABLE above; a throw is a fault, not silence.
    return { cause: "cmux-error", kind: "unresolved", why: `cmux could not be reached (${String(error)})` };
  }
}
