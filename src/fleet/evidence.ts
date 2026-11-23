/**
 * What `fleet health` reads, already decoded: the input `./judge.ts` folds into the sessions page's document.
 * `./read.ts` is the one producer. Pure types.
 */
import type { CmuxFleetState } from "../cmux/hang.js";
import type { BoardPriority } from "../handover/rowKind.js";
import type { CodexThreadObservation } from "../measurement/codexSessions.js";
import type { FleetConfig } from "./config.js";
import type { FleetAttemptFold } from "./journal.js";
import type { FleetAccountNames } from "./refusals.js";
import type { FleetHealthDocument } from "./types.js";

/** What one live session booted on, as `../claude/seatBoot.ts` reads it. */
export type FleetBoot =
  | { readonly kind: "token" | "store"; readonly alias: string }
  | { readonly kind: "off-plan" | "unresolved"; readonly why: string };

/** The board row a seat runs. */
export interface FleetSeatRow {
  readonly id: string;
  readonly title: string;
  readonly priority: BoardPriority;
}

/** One live interactive Claude session. */
export interface FleetLiveSession {
  readonly sessionId: string;
  readonly cwd: string;
  /**
   * When its process started, epoch milliseconds to the whole second of the `procStart` liveness verified — what a
   * reorientation must postdate. 0 when that stamp does not parse: the start is unknown.
   */
  readonly startedAtMs: number;
  readonly boot: FleetBoot;
  /** The cmux workspace the ledger recorded for its cwd, when one did. */
  readonly workspaceRef: string | undefined;
  readonly row: FleetSeatRow | undefined;
}

/**
 * A standing service's own liveness, from its own record.
 *
 * @internal
 */
export interface FleetService {
  readonly live: boolean;
  readonly detail: string;
}

/**
 * The newest sweep the pinned chair's workspace closed, from the tick ledger's tail: a sweep, none in the tail, or
 * why the tail could not be read — a read that failed is never the same as a chair that did not sweep.
 */
export type FleetChairSweep =
  | { readonly kind: "swept"; readonly tickId: string; readonly startedIso: string; readonly finalisedIso: string }
  | { readonly kind: "none" }
  | { readonly kind: "unreadable"; readonly why: string };

/** Everything `fleet health` read, already decoded. */
export interface FleetEvidence {
  readonly config: FleetConfig;
  readonly nowIso: string;
  readonly console: FleetHealthDocument["console"];
  /**
   * The Claude Code session the supervisor pin names, when one is recorded — matched against the Claude session
   * registry, so a Codex pin never fills it.
   */
  readonly chairSessionId: string | undefined;
  /**
   * The Codex thread the records name instead, and what Codex's open files say about it: `live` is positive proof a
   * Codex process holds its rollout or lock, `not-observed` proves nothing either way.
   */
  readonly chairCodex?: { readonly threadId: string; readonly observation: CodexThreadObservation };
  /** Why the pin and chain could not be trusted to name the chair's host — then no Claude session is judged as it. */
  readonly chairUnresolved?: string;
  /** When that session took the pin — a session that became the chair after it booted is judged from here. */
  readonly chairPinnedAtIso: string | undefined;
  /** The workspace the pin names — which process is the chair when one session id runs twice. */
  readonly chairWorkspaceRef: string | undefined;
  /** The chair's newest closed sweep: its other success signal beside a reorientation. */
  readonly chairSweep: FleetChairSweep;
  /** cmux itself, as `cmux revive` last heard it from outside: a hang outranks every seat it stops recovery reaching. */
  readonly cmux: CmuxFleetState;
  readonly sessions: readonly FleetLiveSession[];
  /** Plans whose own store is signed out, by alias — a store boot on one of these is walled. */
  readonly signedOutStores: ReadonlySet<string>;
  readonly loop: FleetService;
  readonly keepAlive: FleetService;
  readonly attempt: FleetAttemptFold | undefined;
  /** Whether the attempt's process is still alive and it has not finished. */
  readonly attemptRunning: boolean;
  /** Each chair session's newest reorientation. */
  readonly reorientations: ReadonlyMap<string, string>;
  readonly accounts: FleetAccountNames;
}
