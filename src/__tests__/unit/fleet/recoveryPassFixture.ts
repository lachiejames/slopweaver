/**
 * A scripted desktop app, scratch, clock and supervisor chair for driving one whole Recovery pass with plain
 * functions: shared by the pass's own cases and its chair cases. No mocks — every effect is a function that records
 * what it was asked.
 */
import type { RecoveryChairReading, RecoveryPinLook } from "../../../fleet/recoveryChair.js";
import type { RecoveryEvidence, RecoveryVendor } from "../../../fleet/recoveryCheck.js";
import type {
  RecoveryChairDeps,
  RecoveryHost,
  RecoveryPassDeps,
  RecoveryScratch,
  RecoverySession,
} from "../../../fleet/recoveryPassDeps.js";
import { err, ok } from "../../../lib/result.js";
import type { AppSessionSnapshot } from "../../../sessionHarness/appProtocol.js";

const START_MS = Date.parse("2026-11-25T10:00:00.000Z");
export const SCRATCH = "/home/sessions/recovery-scratch";

/** What a scripted plan does once its session opens. */
export type Behaviour = "answers" | "wrong" | "hangs" | "refused" | "unanswered" | "close-fails";

/** The scripted app and what it saw. */
export interface FakeApp {
  readonly host: RecoveryHost;
  /** Every session the app lists, the chair's included. */
  readonly sessions: AppSessionSnapshot[];
  /** The ledger key of every launch, in order. */
  readonly opened: string[];
  /** The id of every session closed, in order. */
  readonly closed: string[];
  readonly clock: { ms: number };
}

/** The answer a prompt asks for: its bracketed halves, joined. */
function joinedHalves({ prompt }: { prompt: string }): string {
  return [...prompt.matchAll(/\[([0-9a-f]+)\]/gu)].map((match) => match[1]!).join("");
}

/** A session as the app would list it once its turn is over, or still running for a plan that hangs. */
function snapshotOf({
  behaviour,
  directory,
  ledgerKey,
  openedAtIso,
  prompt,
  sessionId,
  vendor,
}: {
  behaviour: Behaviour;
  directory: string;
  ledgerKey: string;
  openedAtIso: string;
  prompt: string;
  sessionId: string;
  vendor: RecoveryVendor;
}): AppSessionSnapshot {
  const base = {
    directory,
    handle: `app:${sessionId}`,
    lastSubmittedText: prompt,
    ledgerKey,
    openedAtIso,
    sessionId,
    title: "Recovery check",
    vendor,
  };
  if (behaviour === "hangs") {
    return { ...base, state: "running" };
  }
  if (behaviour === "wrong") {
    return { ...base, lastAgentText: "API Error: 401", state: "idle" };
  }
  return { ...base, lastAgentText: joinedHalves({ prompt }), state: "idle" };
}

/**
 * An app whose plans behave as scripted, already holding `standing`, its ledger holding `leftOpen` open.
 *
 * @param behaviours what each plan's throwaway session does, by alias
 * @param leftOpen the rows the ledger still holds open
 * @param listFails whether every list is refused
 * @param standing the sessions the app already runs
 * @returns the app and what it records
 */
export function fakeApp({
  behaviours,
  leftOpen = [],
  listFails = false,
  standing = [],
}: {
  behaviours: Readonly<Record<string, Behaviour>>;
  leftOpen?: readonly RecoverySession[];
  listFails?: boolean;
  standing?: readonly AppSessionSnapshot[];
}): FakeApp {
  const clock = { ms: START_MS };
  const sessions: AppSessionSnapshot[] = [...standing];
  const aliases = new Map<string, string>();
  const opened: string[] = [];
  const closed: string[] = [];
  const host: RecoveryHost = {
    close: async ({ session }) => {
      const alias = aliases.get(session.sessionId);
      if (alias !== undefined && behaviours[alias] === "close-fails") {
        return err("the app did not answer close");
      }
      closed.push(session.sessionId);
      const index = sessions.findIndex((snapshot) => snapshot.sessionId === session.sessionId);
      if (index >= 0) {
        sessions[index] = { ...sessions[index]!, state: "closed" };
      }
      return ok(undefined);
    },
    leftOpen: () => ok(leftOpen),
    list: async () => {
      if (listFails) {
        return err("the desktop app is not running");
      }
      return ok([...sessions]);
    },
    open: async ({ candidate, directory, ledgerKey, openedAtIso, prompt }) => {
      opened.push(ledgerKey);
      const behaviour = behaviours[candidate.alias]!;
      if (behaviour === "refused") {
        return err({ message: `the credential gate refused ${candidate.alias}: its week is spent` });
      }
      if (behaviour === "unanswered") {
        return err({ message: "the desktop app did not answer launch.prepare within 180s", unanswered: true });
      }
      const sessionId = `s-${String(opened.length)}`;
      aliases.set(sessionId, candidate.alias);
      sessions.push(
        snapshotOf({ behaviour, directory, ledgerKey, openedAtIso, prompt, sessionId, vendor: candidate.vendor }),
      );
      return ok({ handle: `app:${sessionId}`, sessionId });
    },
  };
  return { clock, closed, host, opened, sessions };
}

/**
 * A scratch that records what it made and how often it was cleared.
 *
 * @returns the scratch, the attempts it made directories for, and its clear count
 */
export function fakeScratch(): { scratch: RecoveryScratch; made: string[]; clears: { count: number } } {
  const made: string[] = [];
  const clears = { count: 0 };
  const scratch: RecoveryScratch = {
    clear: () => {
      clears.count += 1;
      return ok(undefined);
    },
    holds: ({ directory }) => directory.startsWith(`${SCRATCH}/`),
    make: ({ attemptId }) => {
      made.push(attemptId);
      return ok(`${SCRATCH}/${attemptId}/fleet-recovery`);
    },
  };
  return { clears, made, scratch };
}

export const CLAUDE: RecoveryEvidence = {
  candidates: [
    { alias: "claude-1", storeDir: "/s/one", vendor: "claude" },
    { alias: "claude-2", storeDir: "/s/two", vendor: "claude" },
  ],
  excluded: [],
  vendor: "claude",
};

export const CODEX: RecoveryEvidence = {
  candidates: [{ alias: "codex-1", codexHome: "/c/one", vendor: "codex" }],
  excluded: [],
  vendor: "codex",
};

/** A byte source whose every call is a new fill byte, as `randomBytes` would differ. */
function countingBytes(): (size: number) => Buffer {
  let call = 0;
  return (size) => {
    call += 1;
    return Buffer.alloc(size, call);
  };
}

/** What a chair the press opens on one plan does: `takes-pin-then-ends` takes the pin and is already failed. */
export type ChairBehaviour = "takes-pin" | "takes-pin-then-ends" | "refused" | "ends" | "silent";

/** The scripted chair and what it saw. */
export interface FakeChair {
  readonly chair: RecoveryChairDeps;
  /** The plan of every chair opened, in order. */
  readonly opened: string[];
  /** The slug of every doc whose row was closed, with why. */
  readonly retired: string[];
}

/**
 * A chair read as `reading`, whose opens behave as scripted per plan, over the fake app's own session list.
 *
 * @param app the fake app the chair's sessions appear in
 * @param reading what the press reads of the supervisor
 * @param opens what a chair opened on each plan does, by alias
 * @returns the chair and what it records
 */
export function fakeChair({
  app,
  reading,
  opens = {},
}: {
  app: FakeApp;
  reading: RecoveryChairReading;
  opens?: Readonly<Record<string, ChairBehaviour>>;
}): FakeChair {
  const opened: string[] = [];
  const retired: string[] = [];
  let pin: RecoveryPinLook = { kind: "none" };
  const chair: RecoveryChairDeps = {
    open: async ({ candidate }) => {
      opened.push(candidate.alias);
      const slug = `fresh-supervisor-handoff-${String(opened.length + 9040)}`;
      const behaviour = opens[candidate.alias]!;
      if (behaviour === "refused") {
        return err({ reason: `the spawn refused ${candidate.alias}`, slug });
      }
      const sessionId = `chair-${String(opened.length)}`;
      const ends = behaviour === "ends" || behaviour === "takes-pin-then-ends";
      app.sessions.push({
        directory: "/repo",
        handle: `app:${sessionId}`,
        ledgerKey: slug,
        openedAtIso: "2026-11-25T10:01:00.000Z",
        sessionId,
        state: ends ? "failed" : "running",
        title: "Supervisor",
        vendor: candidate.vendor,
      });
      if (behaviour === "takes-pin" || behaviour === "takes-pin-then-ends") {
        pin = { appSessionId: sessionId, kind: "app" };
      }
      return ok({ sessionId, slug });
    },
    pin: () => pin,
    read: async () => reading,
    retire: ({ slug, why }) => {
      retired.push(`${slug}: ${why}`);
      return ok(undefined);
    },
  };
  return { chair, opened, retired };
}

/**
 * The pass's deps over a fake app, each moment between looks one second on its clock.
 *
 * @param app the fake app
 * @param chair the supervisor chair, a running one unless a case names another
 * @param evidence what routing says, CLAUDE and CODEX unless a case names other evidence
 * @param lockHeld whether the pass still holds the lock
 * @param scratch the fake scratch
 * @returns the deps
 */
export function passDeps({
  app,
  chair = fakeChair({ app, reading: { kind: "live", label: "app:the-chair" } }).chair,
  evidence = async ({ vendor }) => (vendor === "claude" ? CLAUDE : CODEX),
  lockHeld = () => true,
  scratch,
}: {
  app: FakeApp;
  chair?: RecoveryChairDeps;
  evidence?: RecoveryPassDeps["evidence"];
  lockHeld?: () => boolean;
  scratch: RecoveryScratch;
}): RecoveryPassDeps {
  return {
    chair,
    evidence,
    host: app.host,
    lockHeld,
    nowMs: () => app.clock.ms,
    pause: async () => {
      app.clock.ms += 1000;
    },
    randomBytes: countingBytes(),
    scratch,
  };
}
