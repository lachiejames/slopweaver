/**
 * The recording decorator's shared fixtures: a launch spec and the session it opens, a ledger collecting what it was
 * handed (or failing on cue), a ledger whose every throw is hostile, and a launcher answering a scripted outcome.
 */
import type { Result } from "../../../lib/result.js";
import type { SessionLaunchFailedError } from "../../../sessionHarness/errors.js";
import type { HarnessLaunchSpec, HarnessOpenedSession, SessionLauncher } from "../../../sessionHarness/launch.js";
import type { SessionLedgerDeps } from "../../../sessionHarness/recordingHarness.js";
import type { SessionEvent } from "../../../sessions/session.js";

export const NOW = "2026-11-07T03:00:00.000Z";

export const SPEC: HarnessLaunchSpec = {
  baseBranch: undefined,
  branch: "a-branch",
  directory: "/work/tree-7",
  directoryExists: true,
  host: "claude-code",
  initialMessage: "read the doc, then start it",
  launchKey: "a-doc",
  ledgerKey: "a-doc",
  model: "opus",
  openedAtIso: "2026-11-07T02:59:00.000Z",
  registeredName: undefined,
  repoRoot: "/work/repo",
  respondingToHandle: undefined,
  slug: "a-doc",
  template: "code",
  title: "a-doc",
};

export const OPENED: HarnessOpenedSession = {
  bootEvidence: { by: "event", confirmed: true },
  delivery: { kind: "witnessed", witness: { by: "submitted-message", confirmed: true } },
  endpointHandle: "surface:7",
  endpointId: "surface-id-7",
  handle: "workspace:7",
  initialMessage: "read the doc, then start it",
  sessionId: "id-7",
};

/**
 * A ledger collecting every event, answering an open row keyed `a-doc` for any session (none when `untracked`), and
 * stamping when each append landed. `warnFails` makes the warning sink itself throw, as a broken stderr would;
 * `clockFails` makes the clock throw.
 *
 * @returns the ledger, and what it collected: the events, when each landed, and the warnings
 */
export function collectingLedger({
  untracked = false,
  failWith,
  unreadable,
  clock = () => 0,
  warnFails,
  clockFails,
}: {
  untracked?: boolean;
  failWith?: string;
  unreadable?: string;
  clock?: () => number;
  warnFails?: string;
  clockFails?: string;
}): { ledger: SessionLedgerDeps; events: SessionEvent[]; at: number[]; warnings: string[] } {
  let key: string | undefined = "a-doc";
  if (untracked) {
    key = undefined;
  }
  const events: SessionEvent[] = [];
  const at: number[] = [];
  const warnings: string[] = [];
  const ledger: SessionLedgerDeps = {
    append: ({ event }) => {
      if (failWith !== undefined) {
        throw new Error(failWith);
      }
      events.push(event);
      at.push(clock());
    },
    nowIso: () => {
      if (clockFails !== undefined) {
        throw new Error(clockFails);
      }
      return NOW;
    },
    openSessionKey: () => {
      if (unreadable !== undefined) {
        throw new Error(unreadable);
      }
      return key;
    },
    warn: ({ message }) => {
      if (warnFails !== undefined) {
        throw new Error(warnFails);
      }
      warnings.push(message);
    },
  };
  return { at, events, ledger, warnings };
}

/** A value whose every string conversion throws, as a hostile dependency could throw. */
const HOSTILE_THROWN = {
  toString: (): string => {
    throw new Error("stringify failed");
  },
};

/**
 * A ledger whose every read and write throws {@link HOSTILE_THROWN}, collecting the warnings that survive.
 *
 * @returns the ledger and the warnings it was handed
 */
export function hostileLedger(): { ledger: SessionLedgerDeps; warnings: string[] } {
  const warnings: string[] = [];
  const hostile = (): never => {
    // A non-Error throw IS the fixture: the decorator must survive a dependency that throws one.
    // oxlint-disable-next-line typescript/only-throw-error
    throw HOSTILE_THROWN;
  };
  return {
    ledger: {
      append: hostile,
      nowIso: hostile,
      openSessionKey: hostile,
      warn: ({ message }) => {
        warnings.push(message);
      },
    },
    warnings,
  };
}

/**
 * A launcher whose every act answers `outcome`, logging which act was called.
 *
 * @returns the launcher and the acts called on it, in order
 */
export function scriptedLauncher({ outcome }: { outcome: Result<HarnessOpenedSession, SessionLaunchFailedError> }): {
  launcher: SessionLauncher;
  acts: string[];
} {
  const acts: string[] = [];
  const answer =
    ({ act }: { act: string }): SessionLauncher["open"] =>
    async ({ resolveInitialMessage }) => {
      acts.push(act);
      // Like a real launcher, resolve the initial message just before the send.
      if (resolveInitialMessage !== undefined) {
        resolveInitialMessage();
      }
      return outcome;
    };
  return { acts, launcher: { open: answer({ act: "open" }), resume: answer({ act: "resume" }) } };
}
