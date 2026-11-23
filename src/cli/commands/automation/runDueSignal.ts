/**
 * A `automation run-due` killed while its effect ran says so ON THE LEDGER, before it exits.
 *
 * `./runDue.ts` runs a run-here row's effect in THIS process under an attempt it took with its own pid. A
 * caller's `timeout 900` can SIGTERM one mid-`store backup`: the process died holding the attempt,
 * and the firing was only read abandoned on the NEXT tick — through holder liveness — and dead-lettered
 * `OUTCOME_UNKNOWN` with nothing on the record naming what had killed it.
 *
 * So SIGHUP, SIGINT and SIGTERM are trapped from the first run-here effect of a tick (or the first verb child, which
 * a seated row launches unarmed) to the end of the process. A row's verb runs in a CHILD with default signal
 * disposition (`./runDueVerbProcess.ts` says why: a handler cannot run while a synchronous call holds the loop), so
 * this process only awaits it and its handlers always run; each one first SIGKILLs that child's process group,
 * then acts. A signal dispatched while an effect is still running retires that exact attempt through the one dead-letter
 * path (`./slotDeadLetter.ts#deadLetter`, a compare-and-set on the attempt and its token) as
 * `KILLED_BY_SIGNAL`, naming the signal and the rule the caller broke, writes the settlement line to stderr,
 * and exits `128 + n`. A second signal while that retirement still writes never starts another — that would
 * register a second board row for the same firing — but exits at once: the caller is insisting, and a board
 * registration that never settles must not hold a signalled process hostage.
 *
 * A signal dispatched once the effect has RESOLVED is a different case: the effect finished and its outcome is
 * real — a `spawnSync` child ran to completion, or reports the signal it died of — so the ordinary settlement
 * is written, and the process then exits `128 + n` saying why. A signal between rows ends the process the same
 * way. The handlers never come down, deliberately: Node dispatches a signal on a LATER poll phase, and a
 * listener removed before that phase stops the watcher and DROPS the signal — the process then neither
 * retires nor dies, and a signal can always arrive in the last turn before a removal. A handler that stays
 * installed has no such window. The one signal it can miss lands after the tick's last loop turn, while the
 * CLI exits synchronously: every settlement is already written and the process is
 * ending as asked, only with its own exit code. No read can close that — some last read always precedes exit.
 *
 * What this cannot cover, stated rather than discovered: SIGKILL, a power cut, and the few instructions
 * between the ledger take completing and {@link RunDueSignalTrap.arm} installing its handlers. Each of those
 * still falls back to the holder-liveness judgement on the next tick. So does a ledger that cannot be written
 * when the signal lands — its lock busy past every wait: the compare-and-set never ran,
 * the settlement line says nothing was retired, and the process exits anyway, because a signal is an order to
 * stop and outwaiting another holder's lock is exactly the hang the caller's deadline exists to end. And the exit is SYNCHRONOUS, as every
 * verb's is in `cli/main.ts`: stderr lines still queued behind a backpressured pipe can be lost with it. An
 * exit that waited for the pipe would let the tick admit its next row meanwhile, which is the worse failure;
 * the ledger's `KILLED_BY_SIGNAL` record is what survives either way.
 */
import { errorMessage } from "#lib/errorMessage.js";

import type { RecipeDefinition } from "../../../live/automation/definition.js";
import type { RecipeSlotAttempt } from "../../../live/automation/slotAttempt.js";
import { killActiveVerbGroup } from "./runDueVerbProcess.js";
import { type RunDueVerbTermination, terminationClause } from "./runDueVerbProcessPure.js";
import { type DeadLetterDeps, deadLetter, refusedLine, type SlotSettlement } from "./slotDeadLetter.js";

/** The catchable termination signals a caller's deadline or interruption arrives as. */
export type RunDueStopSignal = "SIGHUP" | "SIGINT" | "SIGTERM";

/** Every trapped signal, in the order handlers are installed. */
const RUN_DUE_STOP_SIGNALS: readonly RunDueStopSignal[] = ["SIGHUP", "SIGINT", "SIGTERM"];

/** The rule a killed run-due broke, carried verbatim onto the record and the board row. */
export const RUN_DUE_NO_DEADLINE_RULE =
  "automation run-due must never be wrapped in a deadline — run it in the background with the Bash tool's timeout at its 7200000 maximum";

/** The process edge the trap reaches, injected so a test drives it with a plain fake. */
export interface RunDueSignalProcess {
  readonly on: (input: { readonly signal: RunDueStopSignal; readonly handler: () => void }) => void;
  readonly exit: (input: { readonly code: number }) => void;
  readonly writeDiagnostic: (line: string) => void;
  /** SIGKILL the verb child running now, if any — `./runDueVerbProcess.ts#killActiveVerbGroup` in production. */
  readonly endVerbChild: () => RunDueVerbTermination;
}

/** One armed guard: commit to the ordinary settlement, or take the retirement a signal already started. */
export interface RunDueSignalGuard {
  /**
   * The retirement a signal already started, or `null` — and a `null` COMMITS this guard to the ordinary
   * settlement, so a signal from then on waits for it and ends the process at {@link RunDueSignalGuard.disarm}.
   */
  readonly chooseSettlement: () => Promise<SlotSettlement> | null;
  /** The effect and its settlement are over: a signal that waited on them now ends the process. */
  readonly disarm: () => void;
}

/** One `automation run-due` process's trap, armed around each run-here effect in turn. */
export interface RunDueSignalTrap {
  /**
   * The signal retirement already started anywhere in this process, or `null`. A tick waits on it before
   * taking another firing: the process has decided to exit, and that promise ends in the exit.
   */
  readonly retiring: () => Promise<SlotSettlement> | null;
  /**
   * Install the handlers now if no arm has yet. A verb child launches through this first, so a seated row's child,
   * whose attempt is never armed, still dies with this process rather than outliving it.
   */
  readonly install: () => void;
  /** Arm for one admitted run-here effect. The first arm installs the handlers, which never come down. */
  readonly arm: (input: {
    readonly attempt: RecipeSlotAttempt;
    readonly definition: RecipeDefinition;
    readonly deps: DeadLetterDeps;
    readonly home: string;
  }) => RunDueSignalGuard;
}

/** The POSIX number of each trapped signal. */
const SIGNAL_NUMBER: Readonly<Record<RunDueStopSignal, number>> = { SIGHUP: 1, SIGINT: 2, SIGTERM: 15 };

/** The shell convention for a process a signal ended: 128 plus the signal's number. */
const SIGNAL_EXIT_BASE = 128;

/**
 * The exit code a run-due killed by this signal answers, as a shell would report the same death. PURE.
 *
 * @returns 129 for SIGHUP, 130 for SIGINT, 143 for SIGTERM
 */
export function runDueSignalExitCode({ signal }: { readonly signal: RunDueStopSignal }): number {
  return SIGNAL_EXIT_BASE + SIGNAL_NUMBER[signal];
}

/**
 * The words a signal death carries onto the ledger and the board row. PURE.
 *
 * @param attempt the attempt the signal interrupted
 * @param signal which one arrived
 * @param termination what the handler's kill did to the verb child, so the record says whether the work stopped
 * @returns the record's detail and the operator-facing tail of the settlement line
 */
export function signalDeath({
  attempt,
  signal,
  termination,
}: {
  readonly attempt: RecipeSlotAttempt;
  readonly signal: RunDueStopSignal;
  readonly termination: RunDueVerbTermination;
}): { readonly detail: string; readonly what: string } {
  const code = String(runDueSignalExitCode({ signal }));
  return {
    detail:
      `attempt ${String(attempt.attempt)} under ${attempt.holder} received ${signal} while its effect ran and ` +
      `was killed before it could record an outcome; ${terminationClause({ termination })} — a caller deadline or ` +
      `interruption caused this; ` +
      RUN_DUE_NO_DEADLINE_RULE,
    what:
      `KILLED BY ${signal} · attempt ${String(attempt.attempt)} was retired as its process exits ${code} — ` +
      RUN_DUE_NO_DEADLINE_RULE,
  };
}

/**
 * The stderr line for a signal that arrived with no run-here effect left to retire — between rows, after an
 * effect resolved and its own settlement was written, or while a SEATED row runs, whose attempt belongs to its
 * seat and is judged by its lease exactly as a default signal death left it. PURE.
 *
 * @param signal which one arrived
 * @returns the line printed before the process exits `128 + n`
 */
export function lateSignalLine({ signal }: { readonly signal: RunDueStopSignal }): string {
  return (
    `automation run-due · ${signal} arrived with no run-here effect running · every settlement this process wrote stands · ` +
    `exiting ${String(runDueSignalExitCode({ signal }))} — ${RUN_DUE_NO_DEADLINE_RULE}`
  );
}

/**
 * The stderr line for a signal that arrived while this process was still writing after an earlier one — a
 * signal retirement or an ordinary settlement whose board registration never settles, say. The process exits on it at once rather than outwaiting that write:
 * a second signal is the caller insisting. PURE.
 *
 * @param signal which one arrived second
 * @returns the line printed before the process exits `128 + n`
 */
export function insistedSignalLine({ signal }: { readonly signal: RunDueStopSignal }): string {
  return (
    `automation run-due · ${signal} arrived while this process was still writing after an earlier signal · exiting ` +
    `${String(runDueSignalExitCode({ signal }))} now — whatever the ledger and the board already hold stands, and ` +
    `an attempt not yet settled is judged by holder liveness on the next tick — ${RUN_DUE_NO_DEADLINE_RULE}`
  );
}

/** The real process edge: Node's own signal listeners, stderr, exit and the running verb child. */
function nodeRunDueSignalProcess(): RunDueSignalProcess {
  return {
    endVerbChild: killActiveVerbGroup,
    exit: ({ code }) => {
      process.exit(code);
    },
    on: ({ signal, handler }) => {
      process.on(signal, handler);
    },
    writeDiagnostic: (line) => {
      process.stderr.write(`${line}\n`);
    },
  };
}

/**
 * Retire the interrupted attempt, say so on stderr, and exit — the whole of what an in-effect signal does.
 *
 * It never rejects: a throw from the retirement is written as a diagnostic and the process still exits,
 * because a run-due that swallowed its caller's signal would be the stall this guard exists to end.
 */
async function retireOnSignal({
  attempt,
  definition,
  deps,
  home,
  signal,
  signalProcess,
  termination,
}: {
  attempt: RecipeSlotAttempt;
  definition: RecipeDefinition;
  deps: DeadLetterDeps;
  home: string;
  signal: RunDueStopSignal;
  signalProcess: RunDueSignalProcess;
  termination: RunDueVerbTermination;
}): Promise<SlotSettlement> {
  const death = signalDeath({ attempt, signal, termination });
  let settlement: SlotSettlement;
  try {
    const letter = await deadLetter({
      definition,
      deps,
      detail: death.detail,
      home,
      judged: { attempt: attempt.attempt, holderToken: attempt.holderToken },
      observedBy: attempt.holder,
      reason: "KILLED_BY_SIGNAL",
      slotIso: attempt.slotIso,
      what: death.what,
    });
    settlement = letter.settlement;
  } catch (error: unknown) {
    settlement = {
      failed: true,
      line: refusedLine({
        recipeId: definition.recipeId,
        slotIso: attempt.slotIso,
        what: `${signal} arrived and retiring attempt ${String(attempt.attempt)} THREW (${errorMessage({ error })}) — the next tick judges it by holder liveness`,
      }),
    };
  }
  deps.writeDiagnostic(settlement.line);
  signalProcess.exit({ code: runDueSignalExitCode({ signal }) });
  return settlement;
}

/** Where the trap stands: between effects, around a running one, or waiting on an ordinary settlement. */
type TrapPhase =
  | { readonly kind: "idle" }
  | {
      readonly kind: "running";
      readonly retire: (input: {
        readonly signal: RunDueStopSignal;
        readonly termination: RunDueVerbTermination;
      }) => Promise<SlotSettlement>;
      pending: Promise<SlotSettlement> | null;
    }
  | { readonly kind: "settling"; waiting: RunDueStopSignal | null };

/** One trap's mutable state, shared by the handlers it installs and the guards it hands out. */
interface TrapState {
  phase: TrapPhase;
  installed: boolean;
  /** The retirement a signal started, once one has — trap-wide, so a nested tick sees it too. */
  retirement: Promise<SlotSettlement> | null;
  /**
   * Whether the trap has requested its one exit. `process.exit` never returns, so this only binds an edge
   * whose exit does — but it is also what keeps a retirement that finishes after an insisted exit from
   * exiting twice.
   */
  exited: boolean;
}

/** Write `line` and request `128 + n` for `signal`, unless the trap already requested its one exit. */
function exitSaying({
  edge,
  line,
  signal,
  state,
}: {
  edge: RunDueSignalProcess;
  line: string;
  signal: RunDueStopSignal;
  state: TrapState;
}): void {
  if (state.exited) {
    return;
  }
  edge.writeDiagnostic(line);
  edge.exit({ code: runDueSignalExitCode({ signal }) });
}

/** What one delivered signal does, read off the trap's phase. */
function dispatchSignal({
  edge,
  signal,
  state,
}: {
  edge: RunDueSignalProcess;
  signal: RunDueStopSignal;
  state: TrapState;
}): void {
  const phase = state.phase;
  if (state.exited) {
    return;
  }
  if (phase.kind === "idle") {
    // A seated row's verb child runs with no armed attempt, and it must not outlive this exit.
    const termination = edge.endVerbChild();
    const line =
      termination.kind === "none-running"
        ? lateSignalLine({ signal })
        : `${lateSignalLine({ signal })} · ${terminationClause({ termination })}`;
    exitSaying({ edge, line, signal, state });
    return;
  }
  if (phase.kind === "settling" && phase.waiting === null) {
    phase.waiting = signal;
    return;
  }
  if (phase.kind === "running" && phase.pending === null) {
    // The child first, synchronously, so the work has stopped before the retirement says it did.
    phase.pending = phase.retire({ signal, termination: edge.endVerbChild() });
    state.retirement = phase.pending;
    return;
  }
  // A SECOND signal while a retirement or an ordinary settlement is still writing — almost always a board
  // registration, since the ledger half is synchronous. Never a second write: the caller insisted, so exit now.
  exitSaying({ edge, line: insistedSignalLine({ signal }), signal, state });
}

/** Arm the trap around one run-here attempt's effect — the body of {@link RunDueSignalTrap.arm}. */
function armTrap({
  attempt,
  definition,
  deps,
  edge,
  home,
  state,
}: {
  attempt: RecipeSlotAttempt;
  definition: RecipeDefinition;
  deps: DeadLetterDeps;
  edge: RunDueSignalProcess;
  home: string;
  state: TrapState;
}): RunDueSignalGuard {
  if (state.phase.kind !== "idle") {
    // A second arm while one is live. A row's verb runs in a child now (`./runDueVerbProcess.ts`), so a nested
    // `automation run-due` arms its OWN trap in its own process and this branch has no production caller; it stays
    // so that a second arm can never start a second retirement. The live arm owns the signal and this one is left
    // to holder liveness; once a retirement has started, this guard hands it back rather than `null`, so the
    // caller waits on it and its exit instead of settling.
    return { chooseSettlement: () => state.retirement, disarm: () => undefined };
  }
  const running: Extract<TrapPhase, { readonly kind: "running" }> = {
    kind: "running",
    pending: null,
    retire: ({ signal, termination }) =>
      retireOnSignal({ attempt, definition, deps, home, signal, signalProcess: edge, termination }),
  };
  state.phase = running;
  return {
    chooseSettlement: () => {
      if (running.pending !== null) {
        return running.pending;
      }
      state.phase = { kind: "settling", waiting: null };
      return null;
    },
    disarm: () => {
      const ended = state.phase;
      if (ended.kind === "running" && ended.pending !== null) {
        // The retirement is still writing and exits when it finishes, or on a second signal.
        return;
      }
      state.phase = { kind: "idle" };
      if (ended.kind === "settling" && ended.waiting !== null) {
        exitSaying({ edge, line: lateSignalLine({ signal: ended.waiting }), signal: ended.waiting, state });
      }
    },
  };
}

/**
 * Open the one trap a `automation run-due` process arms around each of its run-here effects.
 *
 * Nothing is installed until the first {@link RunDueSignalTrap.arm}, so a tick that runs no run-here row
 * traps nothing. From then on, one handler per signal stays installed for the life of the process and reads
 * the phase: a RUNNING effect's first signal starts exactly one retirement; a SETTLING guard keeps the first
 * signal until {@link RunDueSignalGuard.disarm}, which exits with it; a second signal during either exits at
 * once; with no run-here effect armed — a seated row's included — a signal exits at once. Every one of those
 * first SIGKILLs the running verb child's group, if any. An arm made while another is live gets an inert guard:
 * the live arm owns the signal.
 *
 * @param signalProcess where handlers are installed, diagnostics written and the exit requested
 * @returns the trap
 */
export function openRunDueSignalTrap({
  signalProcess,
}: {
  readonly signalProcess: RunDueSignalProcess;
}): RunDueSignalTrap {
  const state: TrapState = { exited: false, installed: false, phase: { kind: "idle" }, retirement: null };
  const edge: RunDueSignalProcess = {
    ...signalProcess,
    exit: ({ code }) => {
      if (!state.exited) {
        state.exited = true;
        signalProcess.exit({ code });
      }
    },
  };
  const install = (): void => {
    if (state.installed) {
      return;
    }
    state.installed = true;
    RUN_DUE_STOP_SIGNALS.forEach((signal) => {
      edge.on({
        handler: () => {
          dispatchSignal({ edge, signal, state });
        },
        signal,
      });
    });
  };
  return {
    install,
    retiring: () => state.retirement,
    arm: ({ attempt, definition, deps, home }) => {
      install();
      return armTrap({ attempt, definition, deps, edge, home, state });
    },
  };
}

/** The one trap over Node's own signals in this PROCESS. */
let processTrap: RunDueSignalTrap | null = null;

/**
 * The process's one trap over Node's own signals, opened on first use and never taken down.
 *
 * @returns the trap over the real process
 */
export function productionRunDueSignalTrap(): RunDueSignalTrap {
  // Signals are process-wide, so the trap is too: two traps in one process would each install handlers, and one
  // signal would retire two attempts and race two exits. A nested run-due row runs in its own child process, which
  // has its own trap; this process SIGKILLs that child's group before it retires, so the child's trap never fires.
  if (processTrap !== null) {
    return processTrap;
  }
  const opened = openRunDueSignalTrap({ signalProcess: nodeRunDueSignalProcess() });
  processTrap = opened;
  return opened;
}
