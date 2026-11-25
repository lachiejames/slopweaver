/**
 * The desktop app as a Recovery pass reaches it (`./recoveryPass.ts`): throwaway sessions opened, listed and closed
 * through the app session harness, each with its ledger row, and no cmux connection anywhere — the check has to work
 * when cmux is the thing that is down.
 *
 * A session passes every gate a spawned app seat passes: the Claude credential gate, judged on the plan this check
 * chose, and the Codex browser door, judged on the app's own Codex binary. No hatch is read, so a plan the gate would
 * refuse is reported as refused.
 */
import { errorMessage } from "#lib/errorMessage.js";
import { err, ok, type Result } from "#lib/result.js";

import type { ClaudePlanProbesPort } from "../claude/planProbes.js";
import { codexBrowserDoorFor, credentialGateFor } from "../cmux/spawnDeps.js";
import type { PlanRegisterPort } from "../plans/port.js";
import { absentAppClose, absentAppCloseTarget } from "../sessionHarness/absentAppClose.js";
import { appHarnessAmbientCredential } from "../sessionHarness/appCredentialContext.js";
import { appSessionHarnessOver } from "../sessionHarness/appHarness.js";
import { type AppLaunchDeps, appSessionLauncherOver } from "../sessionHarness/appLaunch.js";
import { APP_SESSION_HANDLE_PREFIX, type AppSessionSnapshot } from "../sessionHarness/appProtocol.js";
import type { AppTransport } from "../sessionHarness/appSocketTransport.js";
import type { SessionHarnessError } from "../sessionHarness/errors.js";
import type { HarnessLaunchSpec } from "../sessionHarness/launch.js";
import {
  recordingSessionHarness,
  recordingSessionLauncher,
  type SessionLedgerDeps,
} from "../sessionHarness/recordingHarness.js";
import type { HarnessSession } from "../sessionHarness/sessionHarness.js";
import { foldSessions, parseSessionLog, type SessionItem } from "../sessions/session.js";
import { readSessionLogTextStrict } from "../sessions/sessionStore.js";
import { FleetErrors } from "./errors.js";
import { RECOVERY_KEY_PREFIX, type RecoveryCandidate } from "./recoveryCheck.js";
import type { RecoveryHost, RecoveryOpenFailure, RecoverySession } from "./recoveryPassDeps.js";

/** A list is one read of the app's memory; a slow one is a look missed, and the pass looks again. */
const LIST_TIMEOUT_MS = 10_000;

/** The harness a Recovery session's ledger row names. */
const APP_HARNESS = "app";

/** The tier a Claude check boots on: the turn proves the plan, so it spends the cheaper one. */
const CLAUDE_MODEL = "sonnet";

/** The branch name a row carries. A check runs in an empty directory, so it names no branch of anybody's work. */
const RECOVERY_BRANCH = "fleet-recovery";

/** The card's title: which vendor and plan it is checking. */
function titleOf({ candidate }: { candidate: RecoveryCandidate }): string {
  return `Recovery check: ${candidate.vendor} on ${candidate.alias}`;
}

/** The host and the login a candidate boots on, in the launch spec's own fields. */
function loginFields({
  candidate,
}: {
  candidate: RecoveryCandidate;
}): Pick<HarnessLaunchSpec, "codexHome" | "credentialStoreDir" | "host" | "model"> {
  if (candidate.vendor === "claude") {
    return { credentialStoreDir: candidate.storeDir, host: "claude-code", model: CLAUDE_MODEL };
  }
  return { codexHome: candidate.codexHome, host: "codex", model: undefined };
}

/**
 * The launch spec for one throwaway session.
 *
 * @param candidate the plan it opens on
 * @param directory the empty directory it runs in
 * @param ledgerKey the key its row and its card carry
 * @param openedAtIso when it was decided
 * @param prompt the one message it is sent
 * @param repoRoot the checkout serving this verb, which the spec must name and no session of a check works in
 * @returns the spec
 */
export function recoveryLaunchSpec({
  candidate,
  directory,
  ledgerKey,
  openedAtIso,
  prompt,
  repoRoot,
}: {
  candidate: RecoveryCandidate;
  directory: string;
  ledgerKey: string;
  openedAtIso: string;
  prompt: string;
  repoRoot: string;
}): HarnessLaunchSpec {
  return {
    ...loginFields({ candidate }),
    baseBranch: undefined,
    branch: RECOVERY_BRANCH,
    directory,
    directoryExists: true,
    initialMessage: prompt,
    launchKey: ledgerKey,
    ledgerKey,
    openedAtIso,
    registeredName: undefined,
    repoRoot,
    respondingToHandle: undefined,
    role: "session",
    template: "research",
    title: titleOf({ candidate }),
  };
}

/**
 * The launch effects of a throwaway session: the app's own gates, and no worktree.
 *
 * @param home the state home whose plan register and boot credentials the gate reads
 * @param inherited the environment this verb runs in, which the app's Claude worker drops the credentials of
 * @param pluginDir the Slopweaver plugin a Claude seat loads: the checkout serving this verb
 * @param port where the plan register is read
 * @param probesPort where the gate files each plan's probe
 * @returns the launch deps
 */
export function recoveryLaunchDeps({
  home,
  inherited,
  pluginDir,
  port,
  probesPort,
}: {
  home: string;
  inherited: Readonly<Record<string, string | undefined>>;
  pluginDir: string;
  port: PlanRegisterPort;
  probesPort: ClaudePlanProbesPort;
}): AppLaunchDeps {
  const gate = credentialGateFor({
    home,
    // The plan was chosen before the launch, so a register that stops carrying it refuses rather than boots it.
    namedPin: true,
    port,
    probesPort,
    spentPlanHatch: false,
    unreadableHatch: false,
  });
  return {
    codexBrowserDoorAt: ({ codexPath }) => codexBrowserDoorFor({ codexPath, launch: "fleet recover" }),
    ensureWorktree: () => undefined,
    gateClaudeCredential: async ({ plan }) => gate({ ambient: appHarnessAmbientCredential({ inherited }), plan }),
    resolvePluginDir: () => pluginDir,
  };
}

/** The ledger rows as they stand now, or why the log could not be read. */
function ledgerRows({ home }: { home: string }): Result<readonly SessionItem[], string> {
  try {
    return ok(foldSessions({ events: parseSessionLog({ text: readSessionLogTextStrict({ home }) }).events }));
  } catch (error: unknown) {
    return err(errorMessage({ error }));
  }
}

/** Whether an open app row is a Recovery check's own: its key is one, and it ran inside this home's scratch. */
function isRecoveryRow({
  holds,
  row,
}: {
  holds: (options: { directory: string }) => boolean;
  row: SessionItem;
}): boolean {
  return (
    row.status === "open" &&
    row.harness === APP_HARNESS &&
    row.sessionKey.startsWith(RECOVERY_KEY_PREFIX) &&
    row.cwd !== undefined &&
    holds({ directory: row.cwd })
  );
}

/** A row's session, for a close. A row with no session id names nothing a close could end, so it is left out. */
function sessionOfRow({ row }: { row: SessionItem }): readonly RecoverySession[] {
  if (row.sessionId === undefined) {
    return [];
  }
  return [{ handle: `${APP_SESSION_HANDLE_PREFIX}${row.sessionId}`, sessionId: row.sessionId }];
}

/** A session as the harness's park addresses it: the id and handle are what it acts on. */
function parkTarget({ session }: { session: RecoverySession }): HarnessSession {
  return {
    description: undefined,
    directory: "",
    groupId: APP_HARNESS,
    handle: session.handle,
    id: session.sessionId,
    latestConversationMessage: undefined,
    latestSubmittedAtIso: undefined,
    latestSubmittedMessage: undefined,
    pinned: false,
    selected: false,
    title: undefined,
  };
}

/** Everything the production host is built over. */
export interface RecoveryHostDeps {
  readonly home: string;
  /**
   * Whether a directory is inside this home's scratch.
   *
   * @param options the directory
   * @returns true inside it
   */
  readonly holds: (options: { directory: string }) => boolean;
  readonly launch: AppLaunchDeps;
  readonly ledger: SessionLedgerDeps;
  readonly repoRoot: string;
  readonly transport: AppTransport;
}

/** Every session the app knows, straight off its control plane: the harness's own list leaves the ended ones out. */
async function listApp({
  transport,
}: {
  transport: AppTransport;
}): Promise<Result<readonly AppSessionSnapshot[], string>> {
  const answered = await transport({ request: { kind: "list" }, timeoutMs: LIST_TIMEOUT_MS });
  if (answered.isErr()) {
    return err(answered.error.message);
  }
  if (answered.value.kind !== "sessions") {
    return err(FleetErrors.appAnswerUnexpected({ kind: answered.value.kind, request: "list" }).message);
  }
  return ok(answered.value.sessions);
}

/** After a close the app refused as unknown: end the one open row that names the session, or say there is none. */
function closeAbsent({
  deps,
  error,
  session,
}: {
  deps: RecoveryHostDeps;
  error: SessionHarnessError;
  session: RecoverySession;
}): Result<void, string> {
  if (error.code !== "SESSION_NOT_FOUND") {
    return err(error.message);
  }
  const rows = ledgerRows({ home: deps.home });
  if (rows.isErr()) {
    return err(rows.error);
  }
  const row = absentAppCloseTarget({ error, handle: session.handle, harness: "app", rows: rows.value });
  if (row !== undefined) {
    deps.ledger.append({ event: absentAppClose({ row, tsIso: deps.ledger.nowIso() }).event });
  }
  // The app answered that it has no such session: it is gone, with or without a row to end.
  return ok(undefined);
}

/** The session a failed launch left standing, when it named one, or that the app never answered it. */
function openFailure({
  message,
  opened,
  prepareUnanswered,
}: {
  message: string;
  opened: { readonly handle: string; readonly sessionId?: string } | undefined;
  prepareUnanswered: true | undefined;
}): RecoveryOpenFailure {
  if (opened?.sessionId !== undefined) {
    return { left: { handle: opened.handle, sessionId: opened.sessionId }, message };
  }
  if (prepareUnanswered === true) {
    return { message, unanswered: true };
  }
  return { message };
}

/**
 * The desktop app as a Recovery pass reaches it.
 *
 * @param deps the state home, its scratch, the launch effects, the ledger, the serving checkout and the app's transport
 * @returns the host
 */
export function appRecoveryHost({ deps }: { deps: RecoveryHostDeps }): RecoveryHost {
  const launcher = recordingSessionLauncher({
    implementation: APP_HARNESS,
    launcher: appSessionLauncherOver({ deps: deps.launch, ledgerHome: deps.home, transport: deps.transport }),
    ledger: deps.ledger,
  });
  const harness = recordingSessionHarness({
    callerSessionId: undefined,
    harness: appSessionHarnessOver({ transport: deps.transport }),
    ledger: deps.ledger,
  });
  return {
    close: async ({ session }) => {
      const parked = await harness.park({ mode: "force", target: { session: parkTarget({ session }) } });
      return parked.isOk() ? ok(undefined) : closeAbsent({ deps, error: parked.error, session });
    },
    leftOpen: () =>
      ledgerRows({ home: deps.home }).map((rows) =>
        rows
          .filter((row) => isRecoveryRow({ holds: deps.holds, row }))
          .flatMap((row): readonly RecoverySession[] => sessionOfRow({ row })),
      ),
    list: async () => listApp({ transport: deps.transport }),
    open: async ({ candidate, directory, ledgerKey, openedAtIso, prompt }) => {
      const spec = recoveryLaunchSpec({
        candidate,
        directory,
        ledgerKey,
        openedAtIso,
        prompt,
        repoRoot: deps.repoRoot,
      });
      const opened = await launcher.open({ spec });
      return opened
        .map(({ handle, sessionId }) => ({ handle, sessionId }))
        .mapErr(({ message, opened: left, prepareUnanswered }) =>
          openFailure({ message, opened: left, prepareUnanswered }),
        );
    },
  };
}
