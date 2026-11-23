/**
 * Read everything `fleet health` judges, WITHOUT cmux and WITHOUT the network.
 *
 * The desktop app runs this from outside cmux, where cmux refuses every connection (measured), and it
 * polls it every 30 seconds (`FLEET_INTERVAL_MS`, `desktop/src/fleetPollingShell.ts`), so neither a socket nor a provider probe may sit on its path. What it reads instead:
 *
 * - Claude Code's live-session registry and the process table — a walled seat registers like any other (measured);
 * - what each live session BOOTED on, off its own process (`../claude/seatBootRead.ts`, `ps`/`lsof`);
 * - whether each plan's own store holds a credential at all, off the local store (`../claude/keychain.ts`) — no
 *   request is made;
 * - the supervisor pin, the session ledger and the board docs, for who is the chair and which row each seat runs;
 * - the tail of the supervisor tick ledger, for the newest sweep the chair's workspace closed;
 * - the Slack loop's and the keep-alive's own records, exactly as `session standing` reads them;
 * - the console's run record, and the recovery journal the in-cmux pass writes.
 */
import { join } from "node:path";

import { installedTreeRoot } from "#lib/pluginRoot.js";

import { holderIsAlive } from "../admit/lockHolder.js";
import { readConsoleBuild } from "../checkouts/consoleBuildRead.js";
import { loginHintFor } from "../claude/accountBinding.js";
import { readAssertions } from "../claude/assertionStore.js";
import type { ClaudeAccount } from "../claude/contracts.js";
import { credentialHasAccessToken, readClaudeCredential } from "../claude/credentialDocument.js";
import { readCredentialDocument } from "../claude/keychain.js";
import { readSpawnAccounts } from "../claude/spawnAccounts.js";
import { cmuxFleetState } from "../cmux/hang.js";
import { readProcessSnapshot } from "../live/standing/inspect.js";
import { keepAliveLiveness, loopLiveness } from "../live/standing/sessionLiveness.js";
import type { CodexThreadObserver } from "../measurement/codexSessions.js";
import type { PlanRegisterPort } from "../plans/port.js";
import { scanSessions } from "../sessions/liveSessionStore.js";
import { claudeHomeDir } from "../supervisor/chairRead.js";
import { mainCheckoutRoot } from "../worktree/shell.js";
import type { FleetConfig } from "./config.js";
import type { FleetEvidence } from "./evidence.js";
import { foldNewestAttempt, reorientationsBySession } from "./journal.js";
import { isLiveSeat } from "./liveSeat.js";
import type { FleetPort } from "./port.js";
import { readProcessStarts } from "./processStarts.js";
import { chairEvidenceOf } from "./readChair.js";
import { liveSessionsOf } from "./readSessions.js";
import type { FleetAccountNames } from "./refusals.js";
import type { FleetHealthDocument } from "./types.js";

/** The plans whose own store holds no credential to present — signed out, read locally with no request. */
function signedOutStoresOf({ accounts }: { accounts: readonly ClaudeAccount[] | undefined }): ReadonlySet<string> {
  const signedOut = new Set<string>();
  if (accounts === undefined) {
    return signedOut;
  }
  for (const account of accounts) {
    const slice = readClaudeCredential({ document: readCredentialDocument({ storeDir: account.storeDir }) });
    if (!credentialHasAccessToken({ slice })) {
      signedOut.add(account.alias);
    }
  }
  return signedOut;
}

/** The console the installed checkout serves, read from its run record. */
function consoleOf({ nowMs }: { nowMs: number }): FleetHealthDocument["console"] {
  const root = mainCheckoutRoot({ cwd: installedTreeRoot({ importMetaUrl: import.meta.url }) });
  if (root === undefined) {
    return { state: "unmeasured" };
  }
  const served = readConsoleBuild({ cwd: root, nowMs }).served;
  if (served.kind === "none" || !served.live) {
    return { state: "down" };
  }
  return { port: served.port, state: "serving" };
}

/** Each plan's email, from its enrollment or its labelled cache. */
function accountNamesOf({
  accounts,
  home,
}: {
  accounts: readonly ClaudeAccount[] | undefined;
  home: string;
}): FleetAccountNames {
  const assertions = readAssertions({ home });
  return {
    emailFor: ({ alias }) => {
      const account = accounts?.find((candidate) => candidate.alias === alias);
      if (account === undefined) {
        return undefined;
      }
      return loginHintFor({ account, assertions })?.address;
    },
  };
}

/**
 * Whether the newest attempt is unfinished and its pass still runs — that process, not whatever reused its pid. An
 * attempt journalled with no start stamp cannot be told apart from a stranger on its pid, so it is not running: every
 * pass stamps its start, since the lock it holds refuses a process `ps` gave no stamp for.
 */
function attemptRunning({
  attempt,
  starts,
}: {
  attempt: FleetEvidence["attempt"];
  starts: ReadonlyMap<number, string>;
}): boolean {
  if (attempt === undefined || attempt.finished !== undefined || attempt.pidStart === undefined) {
    return false;
  }
  // The listing must SHOW the pass's own start: a pid whose start `ps` could not print is no proof.
  // `holderIsAlive` then refuses a zombie, which keeps its start stamp after it exits.
  return starts.get(attempt.pid) === attempt.pidStart && holderIsAlive({ pid: attempt.pid, start: attempt.pidStart });
}

/** cmux itself, off the revive journal the desktop's `cmux revive` writes; a journal that would not read joins `problems`. */
async function cmuxOf({
  fleet,
  home,
  nowMs,
  problems,
}: {
  fleet: FleetPort;
  home: string;
  nowMs: number;
  problems: string[];
}): Promise<FleetEvidence["cmux"]> {
  const revive = await fleet.readCmuxReviveJournal({ home });
  if (revive.isErr()) {
    problems.push(revive.error.message);
    return { kind: "unmeasured" };
  }
  return cmuxFleetState({ events: revive.value.events, nowIso: new Date(nowMs).toISOString() });
}

/** What `readFleetEvidence` could not read, beside what it did. */
export interface FleetEvidenceRead {
  readonly evidence: FleetEvidence;
  readonly problems: readonly string[];
}

/** The Slack loop and the keep-alive as seats, in fixed copy, and why the loop's liveness could not be read. */
function servicesOf({
  home,
  nowMs,
  snapshot,
}: {
  home: string;
  nowMs: number;
  snapshot: ReturnType<typeof readProcessSnapshot>;
}): Pick<FleetEvidence, "keepAlive" | "loop"> & { problems: readonly string[] } {
  const loop = loopLiveness({ home, nowMs });
  const keepAlive = keepAliveLiveness({ home, nowMs, snapshot });
  // Fixed copy, like the loop's: `watchLivenessLine` is an operator's diagnostic (pids, paths), never the owner's words.
  return {
    keepAlive: {
      detail: keepAlive.live ? "Keeping every plan signed in." : "The credential keep-alive is not running.",
      live: keepAlive.live,
    },
    loop: {
      detail: loop.live ? "Listening for Slack." : "The Slack loop is not listening — its listener has not re-armed.",
      live: loop.live,
    },
    problems: loop.problems,
  };
}

/**
 * What `readFleetEvidence` reads off the MACHINE rather than off a home: the process table, every process's start,
 * the session records still live by them, and the console the installed checkout serves. None of it depends on the
 * home, the plan register or the fleet store, so one reading can stand for several reads taken together.
 */
export interface FleetMachineRead {
  readonly liveRecords: ReturnType<typeof scanSessions>["records"];
  readonly snapshot: ReturnType<typeof readProcessSnapshot>;
  readonly starts: ReadonlyMap<number, string>;
  readonly console: FleetHealthDocument["console"];
  /** Every machine read that failed, as a sentence, in the order the evidence names them. */
  readonly problems: readonly string[];
}

/** The machine half bar the console: what a read taken without a caller's machine half reads up front. */
type FleetProcessesRead = Omit<FleetMachineRead, "console">;

/**
 * Read the machine half of the fleet: the process table, every process's start, the session records still live by
 * them, and the console's run record. Every read that fails becomes a problem and costs only its own field.
 *
 * @param nowMs the instant to judge the console's liveness against, epoch milliseconds
 * @returns the machine's reading
 * @internal
 */
export function readFleetMachine({ nowMs }: { nowMs: number }): FleetMachineRead {
  return { ...readFleetProcesses(), console: consoleOf({ nowMs }) };
}

/** The process table, every process's start and the session records still live by them. */
function readFleetProcesses(): FleetProcessesRead {
  const problems: string[] = [];
  const snapshot = readProcessSnapshot();
  if (snapshot.kind === "unreadable") {
    problems.push(`the process table could not be read: ${snapshot.problem}`);
  }
  const startsRead = readProcessStarts();
  if ("why" in startsRead) {
    problems.push(`no process start could be read, so no session reads as running: ${startsRead.why}`);
  }
  const starts = "why" in startsRead ? new Map<number, string>() : startsRead.starts;
  const registry = scanSessions({ sessionsDir: join(claudeHomeDir(), "sessions") });
  if (registry.unreadable !== undefined) {
    problems.push(registry.unreadable);
  }
  return {
    liveRecords: registry.records.filter((record) => isLiveSeat({ record, starts })),
    problems,
    snapshot,
    starts,
  };
}

/** The processes of the machine half a caller already read, or a fresh read when it passed none — absence by design. */
function processesHalf({ machine }: { machine: FleetMachineRead | undefined }): FleetProcessesRead {
  if (machine !== undefined) {
    return machine;
  }
  return readFleetProcesses();
}

/**
 * The console of the machine half a caller already read, or a fresh read NOW when it passed none. Called where the
 * evidence is assembled, after the plan register and the fleet store, so a read with no machine half observes the
 * console at the same point it always has, because a port's own effects must still be seen.
 */
function consoleHalf({
  machine,
  nowMs,
}: {
  machine: FleetMachineRead | undefined;
  nowMs: number;
}): FleetHealthDocument["console"] {
  if (machine !== undefined) {
    return machine.console;
  }
  return consoleOf({ nowMs });
}

/**
 * Read the fleet, offline.
 *
 * @param home the state home
 * @param config the configuration already read
 * @param nowMs the instant to judge against, epoch milliseconds
 * @param port where the plan register naming the Claude plans is read; a store outage is a named problem and
 *   costs the account field only
 * @param fleet where the recovery and revive journals are read; a store outage is a named problem too
 * @param codexThread what Codex's open files say about a Codex chair's thread, asked only when the records name one
 * @param machine the machine half already read ({@link readFleetMachine}), for a caller reading several homes against
 *   one machine, its console included as the caller read it; read here, the console where it always was, when absent
 * @returns the evidence, and every read that failed — a failed read costs its own field and nothing else
 */
export async function readFleetEvidence({
  codexThread,
  home,
  config,
  fleet,
  machine,
  nowMs,
  port,
}: {
  home: string;
  config: FleetConfig;
  fleet: FleetPort;
  machine?: FleetMachineRead;
  nowMs: number;
  port: PlanRegisterPort;
  codexThread: CodexThreadObserver;
}): Promise<FleetEvidenceRead> {
  const machineRead = processesHalf({ machine });
  const problems: string[] = [...machineRead.problems];
  const { liveRecords, snapshot, starts } = machineRead;
  const accountsRead = await readSpawnAccounts({ home, port });
  if (accountsRead.isErr()) {
    problems.push(`the plan register could not be read: ${accountsRead.error.message}`);
  }
  const accounts = accountsRead.isOk() ? accountsRead.value : undefined;
  const sessions = liveSessionsOf({ accounts, home, liveRecords });
  const journal = await fleet.readResumeJournal({ home });
  if (journal.isErr()) {
    problems.push(journal.error.message);
  }
  const events = journal.isOk() ? journal.value.events : [];
  const attempt = foldNewestAttempt({ events });
  const services = servicesOf({ home, nowMs, snapshot });
  const accountNames = accountNamesOf({ accounts, home });
  // In the order the evidence names them, so `problems` reads in that order too.
  const chair = chairEvidenceOf({ codexThread, home, problems });
  const cmux = await cmuxOf({ fleet, home, nowMs, problems });
  return {
    evidence: {
      accounts: accountNames,
      attempt,
      attemptRunning: attemptRunning({ attempt, starts }),
      ...chair,
      cmux,
      config,
      console: consoleHalf({ machine, nowMs }),
      keepAlive: services.keepAlive,
      loop: services.loop,
      nowIso: new Date(nowMs).toISOString(),
      reorientations: reorientationsBySession({ events }),
      sessions,
      signedOutStores: signedOutStoresOf({ accounts }),
    },
    problems: [...problems, ...services.problems],
  };
}
